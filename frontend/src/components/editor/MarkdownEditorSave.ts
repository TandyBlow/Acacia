import { migrateMathStrings } from '@tiptap/extension-mathematics'
import { AUTO_SAVE_DELAY_MS } from '../../constants/app'
import { parseMarkdownWithIntegrity } from './MarkdownEditorMarkdown'
import { checkDocEquivalence } from './MarkdownEditorIntegrity'
import { buildPlainTextDoc, normalizePastedText, sanitizeMarkdownSource } from './MarkdownEditorMarkdownUtil'
import type { MarkdownEditorContext } from './MarkdownEditorContext'

const MAX_SAVE_RETRIES = 3
const SAVE_RETRY_BASE_MS = 2000

/**
 * A save target carries the validation verdict of its own content, decided
 * when the draft was scheduled. Guards read the target, never the editor's
 * current state: a queued save must not sail through because the user has
 * since switched to a healthy node.
 */
export interface SaveTarget {
  nodeId: string
  content: string
  validated: boolean
}

// Save queueing is per node: a late conflict response or a retry for one
// node must never tear down or overwrite another node's queued save. The
// maps are module-level because editor instances are rebuilt on every node
// switch while in-flight requests outlive them.
const autoSaveTimers = new Map<string, number>()
const pendingSaves = new Map<string, SaveTarget>()
let saveInFlight = false
let saveInFlightNode: string | null = null
let retryCount = 0

// A save that failed without a version conflict leaves the outcome
// unknowable: the request may have committed before the connection dropped.
// Until a later save for the node confirms, lastSavedContent cannot prove
// the server state, and the same-content dedup must not skip — the store's
// conflict capture surfaces the truth when the resent draft hits a moved
// server (412), and a genuinely failed save simply lands again.
const uncertainOutcomeNodes = new Set<string>()

// Memo for draft validation. The verdict depends on the serialized content
// AND the editor document it came from, so the memo keys on the document
// identity (state.doc changes on every transaction) — keying on the output
// string alone would reuse a stale verdict after the document changed.
let lastValidation: { content: string; docNode: unknown; ok: boolean } | null = null

export function useMarkdownEditorSave(ctx: MarkdownEditorContext) {
  function clearTimerFor(nodeId: string): void {
    const timer = autoSaveTimers.get(nodeId)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      autoSaveTimers.delete(nodeId)
    }
  }

  /**
   * Cancels this node's queued save: timer and bucket entry. Used when the
   * draft has reverted to the saved content — anything queued for the node
   * is stale, while other nodes' queued work and retries must survive.
   *
   * The revert must not be forgotten when the node's server state is
   * unresolved — a save is in flight, or a failed one left the outcome
   * unknown and a retry was queued. The desired content goes back into the
   * bucket on a short reconciliation write: while in flight, the response's
   * kick or the timer carries it out; after an unknown-outcome failure, the
   * uncertainty flag keeps the dedup from skipping it, and a write landing
   * on a moved server answers 412 with the truth. Without either, the
   * revert needs nothing: the server already holds this content.
   */
  function cancelQueuedSave(nodeId: string, desired?: string): void {
    clearTimerFor(nodeId)
    pendingSaves.delete(nodeId)
    if (desired === undefined) return
    if (saveInFlightNode !== nodeId && !uncertainOutcomeNodes.has(nodeId)) return
    if (!validateContent(desired)) {
      console.error('[MarkdownEditor] revert reconcile suppressed: content failed the parse-integrity check')
      return
    }
    scheduleAutoSave(nodeId, desired, SAVE_RETRY_BASE_MS, { validated: true })
  }

  function clearAllTimers(): void {
    for (const timer of autoSaveTimers.values()) {
      window.clearTimeout(timer)
    }
    autoSaveTimers.clear()
  }

  /**
   * Round-trip check of serialized content: parse it back and compare per
   * content unit. Covers load-time corruption, serialization loss, and any
   * doc state that would not survive the next open.
   *
   * When the content is the editor's own serialization, the editor document
   * itself is compared against the re-parsed draft (checkDocEquivalence):
   * a string roundtrip cannot see serialization-stage loss, since both of
   * its sides share it.
   */
  function validateContent(content: string): boolean {
    if (ctx.isParseDegraded.value) return false
    const editor = ctx.editor.value
    if (!editor) return false
    const docNode = (editor as { state?: { doc?: unknown } }).state?.doc ?? null
    if (lastValidation && lastValidation.content === content && lastValidation.docNode === docNode) {
      return lastValidation.ok
    }
    const { doc, integrity } = parseMarkdownWithIntegrity(editor, content)
    let ok = doc !== null && integrity.ok
    if (ok && content === editor.getMarkdown()) {
      const equivalence = checkDocEquivalence(editor.getJSON(), doc!)
      if (!equivalence.ok) {
        console.error('[MarkdownEditor] draft failed doc equivalence:', equivalence.issues)
        ok = false
      }
    }
    lastValidation = { content, ok, docNode }
    return ok
  }

  function scheduleRetry(target: SaveTarget, delayMs?: number): void {
    if (retryCount >= MAX_SAVE_RETRIES) {
      console.error('[MarkdownEditor] save gave up after retries:', target.nodeId)
      return
    }
    // A newer draft may have been queued for this node while the failed save
    // was in flight. Retry that one: it supersedes the stale content, and
    // re-queueing the stale content would clobber the newer draft and its
    // timer (stale text sent twice, newer draft never).
    const retryTarget = pendingSaves.get(target.nodeId) ?? target
    retryCount += 1
    scheduleAutoSave(
      retryTarget.nodeId,
      retryTarget.content,
      delayMs ?? SAVE_RETRY_BASE_MS * 2 ** (retryCount - 1),
      // The verdict was decided for this exact content string when it was
      // scheduled. Re-running it against the editor's current state — which
      // may show another node, possibly degraded — would leak across nodes.
      { validated: retryTarget.validated },
    )
  }

  // Resolves false only when the content is known not to be persisted.
  async function enqueueSave(
    nodeId: string,
    content: string,
    options?: { force?: boolean; keepalive?: boolean; validated?: boolean; revision?: number },
  ): Promise<boolean> {
    const validated = options?.validated ?? validateContent(content)
    if (!validated) {
      // Risk detected in this content: refuse to persist it, whatever the
      // editor happens to be showing right now.
      console.error('[MarkdownEditor] save suppressed: content failed the parse-integrity check')
      return false
    }

    if (!options?.force && !uncertainOutcomeNodes.has(nodeId) && content === ctx.lastSavedContent.value) {
      return true
    }

    if (saveInFlight) {
      pendingSaves.set(nodeId, { nodeId, content, validated })
      return true
    }

    saveInFlight = true
    saveInFlightNode = nodeId
    let saved = false
    try {
      saved = await ctx.store.saveActiveNodeContent(nodeId, content, {
        keepalive: options?.keepalive,
        force: options?.force,
        revision: options?.revision,
      })
      if (saved) {
        retryCount = 0
        // The write is confirmed: the node's server state is known again.
        uncertainOutcomeNodes.delete(nodeId)
        if (ctx.activeNode.value?.id === nodeId) {
          ctx.lastSavedContent.value = content
        }
        return true
      }
      const conflict = ctx.store.lastSaveConflict
      if (conflict?.nodeId === nodeId) {
        // The store captured the server content and revision: the outcome
        // is known again, from the server's side.
        uncertainOutcomeNodes.delete(nodeId)
        // 412/428: keep the conflicting draft, pause autosave, let the user
        // decide. The banner only goes up while the conflicted node is still
        // on screen — a late response after switching nodes stays in the
        // store and never applies to the node now being edited.
        if (ctx.activeNode.value?.id === nodeId) {
          ctx.saveConflict.value = { ...conflict, draftValidated: validated }
        }
        // Pause only this node: queued work and the timer may belong to
        // another node the user has moved on to, and must survive this
        // response.
        pendingSaves.delete(nodeId)
        clearTimerFor(nodeId)
        return false
      }
      // No conflict information: the write outcome is unknown.
      uncertainOutcomeNodes.add(nodeId)
      scheduleRetry({ nodeId, content, validated })
      return false
    } finally {
      saveInFlight = false
      saveInFlightNode = null
      // Drop this node's queued duplicate only when the save succeeded with
      // the same content; anything else still needs to go out.
      const queued = pendingSaves.get(nodeId)
      if (queued && saved && queued.content === content) {
        pendingSaves.delete(nodeId)
      }
      // Kick the next queued save that has no timer of its own — a save that
      // went stale while this one was in flight. Entries armed with a timer
      // (debounce or retry backoff) fire on their own schedule.
      const nextId = [...pendingSaves.keys()].find((id) => !autoSaveTimers.has(id))
      if (nextId !== undefined) {
        const nextTarget = pendingSaves.get(nextId)!
        pendingSaves.delete(nextId)
        void enqueueSave(nextId, nextTarget.content, { force: true, validated: nextTarget.validated })
      }
    }
  }

  function scheduleAutoSave(
    nodeId: string,
    content: string,
    delayMs: number = AUTO_SAVE_DELAY_MS,
    options?: { validated?: boolean },
  ): void {
    // Parse degradation belongs to the node the editor is showing: it holds
    // back that node's saves, never another node's queued retries.
    if (nodeId === ctx.activeNode.value?.id && ctx.isParseDegraded.value) return
    // Pause per node: an open conflict holds back only its own node's
    // autosave; another node's conflict must not block this schedule.
    if (ctx.saveConflict.value?.nodeId === nodeId) return
    clearTimerFor(nodeId)

    let validated = options?.validated
    if (validated === undefined) {
      validated = validateContent(content)
    }
    if (!validated) {
      console.error('[MarkdownEditor] autosave suppressed: draft failed the parse-integrity check')
      if (!ctx.integrityIssueText.value) {
        ctx.integrityIssueText.value = ctx.t('editor.integrityDraftIssue')
      }
      return
    }

    pendingSaves.set(nodeId, { nodeId, content, validated })
    autoSaveTimers.set(nodeId, window.setTimeout(() => {
      autoSaveTimers.delete(nodeId)
      void enqueueSave(nodeId, content, { validated })
    }, delayMs))
  }

  // Writes out whatever is still pending, for every node. Call before
  // tearing down a node or the page.
  function flushPendingSave(options?: { keepalive?: boolean }): void {
    const entries = [...pendingSaves.entries()]
    pendingSaves.clear()
    if (entries.length === 0) return
    for (const [nodeId, target] of entries) {
      if (!target.validated) {
        console.error('[MarkdownEditor] flush suppressed: pending content failed the integrity check')
        continue
      }
      void enqueueSave(nodeId, target.content, { ...options, force: true, validated: target.validated })
    }
  }

  function resetAutoSave(): void {
    clearAllTimers()
    retryCount = 0
    lastValidation = null
  }

  function syncEditorContent(content: string): void {
    if (!ctx.editor.value) return

    const normalized = normalizePastedText(content)

    // Empty content: set an empty doc directly, skip the markdown parser
    if (!normalized) {
      ctx.isParseDegraded.value = false
      ctx.integrityIssueText.value = ''
      ctx.isApplyingExternalContent.value = true
      ctx.editor.value.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }, {
        emitUpdate: false,
      })
      ctx.isApplyingExternalContent.value = false
      return
    }

    const source = sanitizeMarkdownSource(normalized)
    const { doc: parsedDoc, integrity } = parseMarkdownWithIntegrity(ctx.editor.value, source)
    const degraded = parsedDoc === null || !integrity.ok
    ctx.isParseDegraded.value = degraded
    ctx.integrityIssueText.value = degraded ? ctx.t('editor.integrityLoadIssue') : ''

    ctx.isApplyingExternalContent.value = true
    ctx.editor.value.commands.setContent(parsedDoc ?? buildPlainTextDoc(source), {
      emitUpdate: false,
    })
    if (degraded) {
      // Show the flat text but make it read-only: this fallback is not the
      // real document, and saving it (now or after any edit) would destroy
      // the formatted original on the server.
      console.error('[MarkdownEditor] content failed parse integrity; editor set read-only so the server copy stays intact', integrity.issues)
      ctx.editor.value.setEditable(false)
    } else {
      ctx.editor.value.setEditable(true)
    }
    migrateMathStrings(ctx.editor.value)
    ctx.isApplyingExternalContent.value = false
  }

  /** Conflict resolution: overwrite the server with the local draft. */
  async function resolveConflictKeepMine(): Promise<boolean> {
    const conflict = ctx.saveConflict.value
    if (!conflict) return false
    // While still on the conflicted node the draft may have evolved past the
    // snapshot — save the latest, revalidated. After switching away the
    // editor draft belongs to another node and must never land here; replay
    // the snapshot captured at conflict time instead.
    const onConflictedNode = ctx.activeNode.value?.id === conflict.nodeId
    const content = onConflictedNode ? ctx.draft.value : conflict.draftContent
    const validated = onConflictedNode ? validateContent(content) : conflict.draftValidated
    const saved = await enqueueSave(conflict.nodeId, content, {
      force: true,
      validated,
      revision: conflict.serverRevision,
    })
    if (saved) {
      // Re-check after the await: the user may have switched nodes while the
      // request was in flight, so the pre-await onConflictedNode is stale —
      // another node's lastSavedContent must never be stamped with this
      // content (a later edit matching it would then be skipped as "saved").
      if (ctx.activeNode.value?.id === conflict.nodeId) {
        ctx.lastSavedContent.value = content
      }
      // Only clear the conflict that was just resolved: a take-server click
      // or a node switch may already have replaced or cleared the banner.
      if (ctx.saveConflict.value === conflict) {
        ctx.store.lastSaveConflict = null
        ctx.saveConflict.value = null
      }
    }
    return saved
  }

  /** Conflict resolution: discard the local draft, adopt the server copy. */
  function resolveConflictTakeServer(): void {
    const conflict = ctx.saveConflict.value
    if (!conflict) return
    ctx.store.lastSaveConflict = null
    ctx.saveConflict.value = null
    // Every editor mutation is bound to the conflicted node: by the time the
    // user clicks, the editor may be showing a different node whose draft
    // and content must stay untouched.
    if (ctx.activeNode.value?.id === conflict.nodeId) {
      ctx.activeNode.value = { ...ctx.activeNode.value, content: conflict.serverContent }
      ctx.draft.value = conflict.serverContent
      ctx.lastSavedContent.value = conflict.serverContent
      syncEditorContent(conflict.serverContent)
    }
  }

  return {
    syncEditorContent,
    resetAutoSave,
    clearAutoSaveTimer: clearAllTimers,
    cancelQueuedSave,
    scheduleAutoSave,
    enqueueSave,
    flushPendingSave,
    resolveConflictKeepMine,
    resolveConflictTakeServer,
  }
}

export type MarkdownEditorSave = ReturnType<typeof useMarkdownEditorSave>
