import { migrateMathStrings } from '@tiptap/extension-mathematics'
import { AUTO_SAVE_DELAY_MS } from '../../constants/app'
import {
  adoptServerContent,
  beginNodeAdoption,
  cancelNodeTask,
  clearNodeConflictIf,
  configureSaveSession,
  enqueueNodeSave,
  flushAllSaveTasks,
  getNodeConflict,
  invalidateNodeConflict,
  isNodeSaving,
  prepareNodeView,
  reconcileNodeContent,
  runNodeResolution,
  setNodeDraft,
  whenNodeIdle,
  endNodeAdoption,
} from '../../services/saveSession'
import type { ConflictedSave, SaveTaskHandle } from '../../services/saveSession'
import { parseMarkdownWithIntegrity } from './MarkdownEditorMarkdown'
import { checkDocEquivalence } from './MarkdownEditorIntegrity'
import { buildPlainTextDoc, normalizePastedText, sanitizeMarkdownSource } from './MarkdownEditorMarkdownUtil'
import type { MarkdownEditorContext } from './MarkdownEditorContext'

// Memo for draft validation. The verdict depends on the serialized content
// AND the editor document it came from, so the memo keys on the document
// identity (state.doc changes on every transaction) — keying on the output
// string alone would reuse a stale verdict after the document changed.
let lastValidation: { content: string; docNode: unknown; ok: boolean } | null = null

export function useMarkdownEditorSave(ctx: MarkdownEditorContext) {
  // The registry's network edge is the store this editor instance was
  // created with. Re-configuring per instance is safe: in production every
  // instance sees the same pinia store, and the closures read the store at
  // call time, so background retries survive the instance that configured
  // them.
  configureSaveSession({
    performWrite: (request) => ctx.store.saveNodeContent(request.nodeId, request.content, {
      keepalive: request.keepalive,
      expectedRevision: request.expectedRevision,
    }),
    resolveRevision: (nodeId) => ctx.store.resolveNodeRevision(nodeId),
  })

  /**
   * THE validation entry: every save path goes through here (directly or
   * via the verdict captured when its content was scheduled). Round-trip
   * check of serialized content: parse it back and compare per content
   * unit. Covers load-time corruption, serialization loss, and any doc
   * state that would not survive the next open.
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

  /**
   * Autosave scheduling for the node being edited. Degradation belongs to
   * the node on screen, and an open conflict pauses only its own node —
   * other nodes' queued work and retries are never touched.
   */
  function scheduleAutoSave(
    nodeId: string,
    content: string,
    delayMs: number = AUTO_SAVE_DELAY_MS,
    options?: { validated?: boolean },
  ): void {
    if (nodeId === ctx.activeNode.value?.id && ctx.isParseDegraded.value) return
    if (getNodeConflict(nodeId)) return

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
    enqueueNodeSave(nodeId, content, { validated, delayMs })
  }

  /**
   * Queues a save and returns a task handle: a task id and a promise that
   * always settles — saved, conflict, unknown, refused (this content
   * failed validation), superseded, cancelled, or session-ended. Queueing
   * has no side effects: confirmed content and conflict hints change only
   * when a write settles.
   */
  function enqueueSave(
    nodeId: string,
    content: string,
    options?: { force?: boolean; keepalive?: boolean; validated?: boolean; revision?: number },
  ): SaveTaskHandle {
    const validated = options?.validated ?? validateContent(content)
    if (!validated) {
      console.error('[MarkdownEditor] save refused: content failed the parse-integrity check')
    }
    return enqueueNodeSave(nodeId, content, {
      validated,
      force: options?.force,
      keepalive: options?.keepalive,
      revision: options?.revision,
    })
  }

  /**
   * Cancels this node's queued save. When a desired content is given and
   * the node's server state is unresolved (a save in flight, or a failed
   * one whose outcome is unknown), the desired content goes back as a
   * short reconciliation write — otherwise the server already holds it.
   */
  function cancelQueuedSave(nodeId: string, desired?: string): void {
    const validated = desired !== undefined ? validateContent(desired) : false
    if (desired !== undefined && !validated) {
      console.error('[MarkdownEditor] revert reconcile suppressed: content failed the parse-integrity check')
    }
    reconcileNodeContent(nodeId, desired ?? '', validated)
  }

  /** Writes out whatever is still queued, for every node. */
  function flushPendingSave(options?: { keepalive?: boolean }): void {
    flushAllSaveTasks(options)
  }

  /** Conflict resolution: overwrite the server with the local draft. */
  async function resolveConflictKeepMine(): Promise<boolean> {
    const conflict = ctx.saveConflict.value
    if (!conflict) return false
    const nodeId = conflict.nodeId
    return runNodeResolution(nodeId, async () => {
      const current = getNodeConflict(nodeId)
      if (current == null) return true
      // Matched by the stable id: an invalidated copy (the write may have
      // committed) is still this conflict; only a fresh capture revokes.
      if (current.conflictId !== conflict.conflictId) return false
      // While still on the conflicted node the draft may have evolved past
      // the snapshot — save the latest, revalidated. After switching away
      // the editor draft belongs to another node and must never land here;
      // replay the snapshot captured at conflict time instead.
      const onConflictedNode = ctx.activeNode.value?.id === nodeId
      const content = onConflictedNode ? ctx.draft.value : conflict.draftContent
      const validated = onConflictedNode ? validateContent(content) : conflict.draftValidated
      if (!validated) {
        console.error('[MarkdownEditor] keep-mine refused: snapshot failed the parse-integrity check')
        return false
      }
      // The write carries the captured server revision AND the conflict id
      // as its write license: a moved server answers 412 again, and a
      // fresher capture (new id) revokes the grant before anything is
      // sent. While the write is queued or in flight the banner stays —
      // the conflict is not resolved until the server confirms.
      const { done } = enqueueNodeSave(nodeId, content, {
        force: true,
        validated,
        revision: conflict.serverRevision,
        conflictLicense: conflict.conflictId,
      })
      const outcome = await done
      if (outcome.status === 'saved') {
        // The registry retired the conflict when the write confirmed.
        return true
      }
      if (outcome.status === 'unknown') {
        // The write may have committed: the earlier server copy can no
        // longer be trusted, so take-server must re-read before adopting.
        invalidateNodeConflict(nodeId)
      }
      return false
    })
  }

  /** Conflict resolution: discard the local draft, adopt the server copy. */
  async function resolveConflictTakeServer(): Promise<boolean> {
    const conflict = ctx.saveConflict.value
    if (!conflict) return false
    const nodeId = conflict.nodeId
    return runNodeResolution(nodeId, async () => {
      const current = getNodeConflict(nodeId)
      if (current == null) return true
      if (current.conflictId !== conflict.conflictId) return false
      // The whole operation pauses sends for this node: a failing request
      // must not re-arm a retry into the middle of the adoption. The hold
      // is taken with a session-bound credential — a stale finally from an
      // old operation can never release a newer hold.
      const hold = beginNodeAdoption(nodeId)
      try {
        // Cancel queued work first, then wait out anything already on the
        // wire — logout ends the wait instead of answering "idle".
        cancelNodeTask(nodeId)
        const raced = isNodeSaving(nodeId)
        if (await whenNodeIdle(nodeId) === 'session-ended') return false
        cancelNodeTask(nodeId)

        const latest = getNodeConflict(nodeId)
        if (latest == null) {
          // A raced write settled the conflict by writing itself: the
          // server state changed under us. Sync the draft to what the
          // server actually holds — do not return on an empty conflict.
          const fresh = await ctx.store.readNodeContent(nodeId)
          if (!fresh) return false
          adoptServerContent(nodeId, fresh.content, fresh.revision)
          if (ctx.activeNode.value?.id === nodeId) {
            ctx.activeNode.value = { ...ctx.activeNode.value, content: fresh.content }
            ctx.draft.value = fresh.content
            syncEditorContent(fresh.content)
          }
          return true
        }
        if (latest.conflictId !== conflict.conflictId) return false

        // Judge by the record's CURRENT state: an invalidated copy (a raced
        // write may have committed) must be re-read even though the
        // capture was live when taken.
        let target = latest
        if (!latest.serverVerified || raced) {
          // The captured copy is not enough when it was never live or a
          // raced write may have moved the server: re-read with the
          // identity guard — a stale response neither updates the cache
          // nor the open conflict. On failure the banner and the draft
          // stay for a retry.
          const fresh = await ctx.store.refreshConflictCopy(nodeId)
          if (!fresh) return false
          target = fresh as ConflictedSave
        }
        const serverContent = target.serverContent
        clearNodeConflictIf(nodeId, target)
        // The adopted copy becomes the node's confirmed state and draft —
        // for the record even when the user has since switched away; the
        // editor itself is only touched when this node is on screen.
        adoptServerContent(nodeId, serverContent, target.serverRevision)
        if (ctx.activeNode.value?.id === nodeId) {
          ctx.activeNode.value = { ...ctx.activeNode.value, content: serverContent }
          ctx.draft.value = serverContent
          syncEditorContent(serverContent)
        }
        return true
      } finally {
        endNodeAdoption(nodeId, hold)
      }
    })
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

  return {
    syncEditorContent,
    prepareNodeView,
    setNodeDraft,
    cancelQueuedSave,
    scheduleAutoSave,
    enqueueSave,
    flushPendingSave,
    resolveConflictKeepMine,
    resolveConflictTakeServer,
  }
}

export type MarkdownEditorSave = ReturnType<typeof useMarkdownEditorSave>
