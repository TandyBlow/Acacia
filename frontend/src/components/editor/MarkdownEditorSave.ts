import { migrateMathStrings } from '@tiptap/extension-mathematics'
import { AUTO_SAVE_DELAY_MS } from '../../constants/app'
import { parseMarkdownWithIntegrity } from './MarkdownEditorMarkdown'
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

let autoSaveTimer: number | null = null
let saveInFlight = false
let pendingSave: SaveTarget | null = null
let retryCount = 0

// Memo for draft validation: identical content does not need a re-parse.
let lastValidation: { content: string; ok: boolean } | null = null

export function useMarkdownEditorSave(ctx: MarkdownEditorContext) {
  function clearAutoSaveTimer(): void {
    if (autoSaveTimer !== null) {
      window.clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
  }

  /**
   * Round-trip check of serialized content: parse it back and compare per
   * content unit. Covers load-time corruption, serialization loss, and any
   * doc state that would not survive the next open.
   */
  function validateContent(content: string): boolean {
    if (ctx.isParseDegraded.value) return false
    if (lastValidation?.content === content) return lastValidation.ok
    const editor = ctx.editor.value
    if (!editor) return false
    const { doc, integrity } = parseMarkdownWithIntegrity(editor, content)
    const ok = doc !== null && integrity.ok
    lastValidation = { content, ok }
    return ok
  }

  function scheduleRetry(target: SaveTarget, delayMs?: number): void {
    if (retryCount >= MAX_SAVE_RETRIES) {
      console.error('[MarkdownEditor] save gave up after retries:', target.nodeId)
      return
    }
    retryCount += 1
    scheduleAutoSave(
      target.nodeId,
      target.content,
      delayMs ?? SAVE_RETRY_BASE_MS * 2 ** (retryCount - 1),
      { validated: target.validated, forceValidate: true },
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

    if (!options?.force && content === ctx.lastSavedContent.value) {
      return true
    }

    if (saveInFlight) {
      pendingSave = { nodeId, content, validated }
      return true
    }

    saveInFlight = true
    try {
      const saved = await ctx.store.saveActiveNodeContent(nodeId, content, {
        keepalive: options?.keepalive,
        force: options?.force,
        revision: options?.revision,
      })
      if (saved) {
        retryCount = 0
        if (ctx.activeNode.value?.id === nodeId) {
          ctx.lastSavedContent.value = content
        }
        return true
      }
      const conflict = ctx.store.lastSaveConflict
      if (conflict?.nodeId === nodeId) {
        // 412/428: keep the conflicting draft, pause autosave, let the user
        // decide. The banner only goes up while the conflicted node is still
        // on screen — a late response after switching nodes stays in the
        // store and never applies to the node now being edited.
        if (ctx.activeNode.value?.id === nodeId) {
          ctx.saveConflict.value = { ...conflict, draftValidated: validated }
        }
        pendingSave = null
        clearAutoSaveTimer()
        return false
      }
      scheduleRetry({ nodeId, content, validated })
      return false
    } finally {
      saveInFlight = false
      const queued = pendingSave
      pendingSave = null
      if (queued && queued.content !== content) {
        void enqueueSave(queued.nodeId, queued.content, { force: true, validated: queued.validated })
      }
    }
  }

  function scheduleAutoSave(
    nodeId: string,
    content: string,
    delayMs: number = AUTO_SAVE_DELAY_MS,
    options?: { validated?: boolean; forceValidate?: boolean },
  ): void {
    if (ctx.isParseDegraded.value) return
    if (ctx.saveConflict.value) return
    clearAutoSaveTimer()

    let validated = options?.validated
    if (validated === undefined || options?.forceValidate) {
      validated = validateContent(content)
    }
    if (!validated) {
      console.error('[MarkdownEditor] autosave suppressed: draft failed the parse-integrity check')
      if (!ctx.integrityIssueText.value) {
        ctx.integrityIssueText.value = ctx.t('editor.integrityDraftIssue')
      }
      return
    }

    pendingSave = { nodeId, content, validated }
    autoSaveTimer = window.setTimeout(() => {
      pendingSave = null
      void enqueueSave(nodeId, content, { validated })
    }, delayMs)
  }

  // Writes out whatever is still pending. Call before tearing down a node.
  function flushPendingSave(options?: { keepalive?: boolean }): void {
    clearAutoSaveTimer()
    const target = pendingSave
    pendingSave = null
    if (!target) return
    if (!target.validated) {
      console.error('[MarkdownEditor] flush suppressed: pending content failed the integrity check')
      return
    }
    void enqueueSave(target.nodeId, target.content, { ...options, force: true, validated: target.validated })
  }

  function resetAutoSave(): void {
    clearAutoSaveTimer()
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
      ctx.store.lastSaveConflict = null
      ctx.saveConflict.value = null
      if (onConflictedNode) {
        ctx.lastSavedContent.value = content
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
    clearAutoSaveTimer,
    scheduleAutoSave,
    enqueueSave,
    flushPendingSave,
    resolveConflictKeepMine,
    resolveConflictTakeServer,
  }
}

export type MarkdownEditorSave = ReturnType<typeof useMarkdownEditorSave>
