import type { MarkdownEditorChatDoc } from './MarkdownEditorChatDoc'
import type { MarkdownEditorContext } from './MarkdownEditorContext'
import type { MarkdownEditorSave } from './MarkdownEditorSave'

export function useMarkdownEditorChat(
  ctx: MarkdownEditorContext,
  doc: MarkdownEditorChatDoc,
  save: MarkdownEditorSave,
) {
  async function appendKnowledgeNote(note: string): Promise<void> {
    if (!ctx.activeNode.value || !note.trim()) return
    const nodeId = ctx.activeNode.value.id
    const currentContent = ctx.activeNode.value.content || ''
    const newContent = currentContent
      ? currentContent + '\n\n' + note
      : note
    const saved = await save.enqueueSave(nodeId, newContent)
    if (!saved) {
      console.error('[MarkdownEditor] appendKnowledgeNote save failed:', nodeId)
      return
    }
    ctx.draft.value = newContent
    if (ctx.activeNode.value) {
      ctx.activeNode.value.content = newContent
    }
  }

  async function sendInlineMessage() {
    if (ctx.chatMode.value !== 'text_input' || !ctx.editor.value || !ctx.activeNode.value) return
    if (ctx.isBusy.value) return

    const msg = doc.getLastInputParagraphText()
    if (!msg) return

    if (msg === '/clear') {
      await ctx.compressAndClear()
      // Reset editor to fresh chat prompt state, not exit to node content
      doc.startChatText()
      return
    }

    const isFirstMessage = !ctx.sessionId.value

    try {
      // Show pending state immediately
      doc.applyInlineChatDoc(doc.buildInlineChatDoc(msg))

      if (isFirstMessage) {
        const result = await ctx.doStartTextChat(ctx.activeNode.value.id, ctx.activeNode.value.name, msg)
        // startTextChat overwrites messages with only AI response, prepend user msg
        ctx.messages.value = [
          { role: 'user' as const, content: msg },
          ...ctx.messages.value,
        ]
        if (result?.knowledge_note) {
          await appendKnowledgeNote(result.knowledge_note)
        }
      } else {
        const result = await ctx.sendMessage(msg, { skipInsertContent: true })
        if (result?.knowledge_note) {
          await appendKnowledgeNote(result.knowledge_note)
        }
        // Auto-end: replace incremental appends with LLM-consolidated content
        if (result?.consolidated_content && ctx.activeNode.value) {
          const nodeId = ctx.activeNode.value.id
          const saved = await save.enqueueSave(nodeId, result.consolidated_content)
          if (!saved) {
            console.error('[MarkdownEditor] consolidation save failed:', nodeId)
          } else {
            ctx.draft.value = result.consolidated_content
            if (ctx.activeNode.value) {
              ctx.activeNode.value.content = result.consolidated_content
            }
          }
        }
      }

      // Revert mode from 'conversing' back to 'text_input'
      ctx.chatMode.value = 'text_input'

      // Rebuild with final data
      doc.applyInlineChatDoc(doc.buildInlineChatDoc())

    } catch {
      console.error('[MarkdownEditor] sendInlineMessage failed')
      ctx.chatMode.value = 'text_input'
      doc.applyInlineChatDoc(doc.buildInlineChatDoc())
    }
  }

  // ── @deprecated conversing textarea 模式专用函数 ──────────────────
  // 当前交互流程始终走 text_input 内联模式 (sendInlineMessage)。
  // 修改 AI 对话功能时请改 sendInlineMessage()，不要在这里改。
  async function sendAnswer() {
    if (!ctx.canSend.value || ctx.isBusy.value || ctx.isCompleted.value) return
    const answer = ctx.userInput.value.trim()
    ctx.userInput.value = ''

    if (answer === '/clear') {
      await ctx.compressAndClear()
      doc.startChatText()
      return
    }
    const result = await ctx.sendMessage(answer)
    if (result) {
      doc.rebuildTranscriptFromMessages()
    }
  }

  async function onSkipTurn() {
    if (ctx.isBusy.value || ctx.isCompleted.value) return
    const result = await ctx.skipTurn()
    if (result) {
      doc.rebuildTranscriptFromMessages()
    }
  }

  async function onEndConversation() {
    if (ctx.isBusy.value || ctx.isCompleted.value) return
    const result = await ctx.endConversation()
    if (result) {
      doc.rebuildTranscriptFromMessages()
      // Replace incremental knowledge_note appends with LLM-consolidated version
      if (result.consolidated_content && ctx.activeNode.value) {
        const nodeId = ctx.activeNode.value.id
        const saved = await save.enqueueSave(nodeId, result.consolidated_content)
        if (!saved) {
          console.error('[MarkdownEditor] onEndConversation save failed:', nodeId)
        } else {
          ctx.draft.value = result.consolidated_content
          if (ctx.activeNode.value) {
            ctx.activeNode.value.content = result.consolidated_content
          }
        }
      }
    }
  }

  // @deprecated 仅被上方废弃的 conversing textarea 的 @keydown 使用
  function onConvKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault()
      void sendAnswer()
    }
  }

  return { sendInlineMessage, sendAnswer, onSkipTurn, onEndConversation, onConvKeydown, appendKnowledgeNote }
}
