import { migrateMathStrings } from '@tiptap/extension-mathematics'
import { AUTO_SAVE_DELAY_MS } from '../../constants/app'
import { parseMarkdownDoc } from './MarkdownEditorMarkdown'
import { buildPlainTextDoc, normalizePastedText, sanitizeMarkdownSource } from './MarkdownEditorMarkdownUtil'
import type { MarkdownEditorContext } from './MarkdownEditorContext'

const MAX_SAVE_RETRIES = 3
const SAVE_RETRY_BASE_MS = 2000

interface SaveTarget {
  nodeId: string
  content: string
}

let autoSaveTimer: number | null = null
let saveInFlight = false
let pendingSave: SaveTarget | null = null
let retryCount = 0

export function useMarkdownEditorSave(ctx: MarkdownEditorContext) {
  function clearAutoSaveTimer(): void {
    if (autoSaveTimer !== null) {
      window.clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
  }

  function scheduleRetry(nodeId: string, content: string): void {
    if (retryCount >= MAX_SAVE_RETRIES) {
      console.error('[MarkdownEditor] save gave up after retries:', nodeId)
      return
    }
    retryCount += 1
    scheduleAutoSave(nodeId, content, SAVE_RETRY_BASE_MS * 2 ** (retryCount - 1))
  }

  // Resolves false only when the content is known not to be persisted.
  async function enqueueSave(
    nodeId: string,
    content: string,
    options?: { force?: boolean; keepalive?: boolean },
  ): Promise<boolean> {
    if (!options?.force && content === ctx.lastSavedContent.value) {
      return true
    }

    if (saveInFlight) {
      pendingSave = { nodeId, content }
      return true
    }

    saveInFlight = true
    try {
      const saved = await ctx.store.saveActiveNodeContent(nodeId, content, options)
      if (saved) {
        retryCount = 0
        if (ctx.activeNode.value?.id === nodeId) {
          ctx.lastSavedContent.value = content
        }
      } else {
        scheduleRetry(nodeId, content)
      }
      return saved
    } finally {
      saveInFlight = false
      const queued = pendingSave
      pendingSave = null
      if (queued && queued.content !== content) {
        void enqueueSave(queued.nodeId, queued.content, { force: true })
      }
    }
  }

  function scheduleAutoSave(
    nodeId: string,
    content: string,
    delayMs: number = AUTO_SAVE_DELAY_MS,
  ): void {
    clearAutoSaveTimer()
    pendingSave = { nodeId, content }
    autoSaveTimer = window.setTimeout(() => {
      pendingSave = null
      void enqueueSave(nodeId, content)
    }, delayMs)
  }

  // Writes out whatever is still pending. Call before tearing down a node.
  function flushPendingSave(options?: { keepalive?: boolean }): void {
    clearAutoSaveTimer()
    const target = pendingSave
    pendingSave = null
    if (!target) return
    void enqueueSave(target.nodeId, target.content, { ...options, force: true })
  }

  function resetAutoSave(): void {
    clearAutoSaveTimer()
    retryCount = 0
  }

  function syncEditorContent(content: string): void {
    if (!ctx.editor.value) return

    const normalized = normalizePastedText(content)

    // Empty content: set an empty doc directly, skip the markdown parser
    if (!normalized) {
      ctx.isApplyingExternalContent.value = true
      ctx.editor.value.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }, {
        emitUpdate: false,
      })
      ctx.isApplyingExternalContent.value = false
      return
    }

    const source = sanitizeMarkdownSource(normalized)
    const parsedDoc = parseMarkdownDoc(ctx.editor.value, source)

    ctx.isApplyingExternalContent.value = true
    ctx.editor.value.commands.setContent(parsedDoc ?? buildPlainTextDoc(source), {
      emitUpdate: false,
    })
    migrateMathStrings(ctx.editor.value)
    ctx.isApplyingExternalContent.value = false
  }

  return {
    syncEditorContent,
    resetAutoSave,
    clearAutoSaveTimer,
    scheduleAutoSave,
    enqueueSave,
    flushPendingSave,
  }
}

export type MarkdownEditorSave = ReturnType<typeof useMarkdownEditorSave>
