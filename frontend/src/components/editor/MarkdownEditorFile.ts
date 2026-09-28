import { apiFetch } from '../../utils/api'
import type { MarkdownEditorChatDoc } from './MarkdownEditorChatDoc'
import type { MarkdownEditorSave } from './MarkdownEditorSave'
import type { MarkdownEditorContext, UploadedFile } from './MarkdownEditorContext'

export function useMarkdownEditorFile(
  ctx: MarkdownEditorContext,
  doc: MarkdownEditorChatDoc,
  save: MarkdownEditorSave,
) {
  function onFileUploaded(file: UploadedFile) {
    ctx.pendingFile.value = file
  }
  function onFileRemoved() {
    ctx.pendingFile.value = null
  }

  async function fillContentFromFile() {
    if (!ctx.pendingFile.value || !ctx.activeNode.value) return
    ctx.isBusy.value = true
    ctx.errorMessage.value = ''
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:7860'

      // Use pipeline-formatted text directly (already processed during upload)
      let fullText = ctx.pendingFile.value.formatted_text || ''

      if (!fullText.trim()) {
        ctx.errorMessage.value = ctx.t('editor.emptyContentWarning')
        return
      }

      // Rewrite image URLs to absolute backend URLs so they load in the editor
      fullText = fullText.replace(/\/file-images\//g, `${backendUrl}/file-images/`)

      const saved = await save.enqueueSave(ctx.activeNode.value.id, fullText)
      if (!saved) {
        ctx.errorMessage.value = ctx.t('editor.fillContentFailed')
        return
      }
      ctx.draft.value = fullText
      if (ctx.activeNode.value) {
        ctx.activeNode.value.content = fullText
      }
      save.syncEditorContent(fullText)
      // Clean up temp files on server after file content is consumed
      if (ctx.pendingFile.value?.file_id) {
        apiFetch('/cleanup-file', {
          method: 'POST',
          body: JSON.stringify({ file_id: ctx.pendingFile.value.file_id }),
        }).catch(() => { /* fire-and-forget */ })
      }
      // Exit back to idle
      ctx.chatMode.value = 'idle'
      ctx.pendingFile.value = null
      ctx.isFileSunk.value = false
    } catch (e) {
      ctx.errorMessage.value = e instanceof Error ? e.message : ctx.t('editor.fillContentFailed')
    } finally {
      ctx.isBusy.value = false
    }
  }

  async function startLineByLineChat() {
    if (!ctx.pendingFile.value || !ctx.activeNode.value) return
    ctx.isBusy.value = true
    ctx.errorMessage.value = ''
    try {
      const prevId = ctx.lastActiveNodeId.value
      const transType = prevId ? 'navigation' : 'initial'
      await ctx.doStartLineByLine(
        ctx.activeNode.value.id,
        ctx.activeNode.value.name,
        ctx.pendingFile.value.file_id,
        ctx.pendingFile.value.filename,
        prevId,
        transType,
        '',
      )
      ctx.pendingFile.value = null
      ctx.isFileSunk.value = false
      ctx.isChatSunk.value = true
      ctx.chatMode.value = 'text_input'
      doc.applyInlineChatDoc(doc.buildInlineChatDoc())
    } catch (e) {
      console.error('[MarkdownEditor] resumeOrStartChat contextual start failed:', e)
    } finally {
      ctx.isBusy.value = false
    }
  }

  function cancelFileUpload() {
    ctx.pendingFile.value = null
    ctx.chatMode.value = 'idle'
    ctx.isFileSunk.value = false
  }

  return { onFileUploaded, onFileRemoved, fillContentFromFile, startLineByLineChat, cancelFileUpload }
}
