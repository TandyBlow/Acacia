import type { MarkdownEditorChatDoc } from './MarkdownEditorChatDoc'
import type { MarkdownEditorSave } from './MarkdownEditorSave'
import type { MarkdownEditorContext } from './MarkdownEditorContext'

const SINK_DURATION_MS = 240

export function useMarkdownEditorChatToggle(
  ctx: MarkdownEditorContext,
  doc: MarkdownEditorChatDoc,
  save: MarkdownEditorSave,
) {
  function onCinemaChatMode() {
    if (ctx.chatMode.value === 'idle') {
      toggleChat()
    }
  }

  async function toggleChat() {
    if (ctx.isAnimating.value) return
    ctx.isAnimating.value = true

    try {
      if (ctx.chatMode.value !== 'idle') {
        // @removed: 退出时保存 generatedContent 到知识点的功能已废弃。
        // 现在每轮对话都通过 appendKnowledgeNote() 实时更新知识点内容，
        // 不再需要在退出时做一次性总结保存。
        // if (generatedContent.value && activeNode.value) {
        //   const currentContent = activeNode.value.content || '';
        //   const newContent = currentContent
        //     ? currentContent + '\n\n' + generatedContent.value
        //     : generatedContent.value;
        //   try {
        //     await save.enqueueSave(activeNode.value.id, newContent);
        //     draft.value = newContent;
        //     draft.value = newContent;
        //     generatedContent.value = '';
        //   } catch { /* save failed, discard */ }
        // }
        ctx.exitChat()
        ctx.isChatSunk.value = false
        ctx.isFileSunk.value = false
        ctx.userInput.value = ''
        ctx.pendingFile.value = null
        if (ctx.activeNode.value && ctx.editor.value) {
          save.syncEditorContent(ctx.activeNode.value.content || '')
        }
      } else {
        // Open: sink button first, then start
        ctx.isChatSunk.value = true
        await new Promise(r => setTimeout(r, SINK_DURATION_MS))
        const resumed = await ctx.resumeOrStartChat()
        if (!resumed) {
          // New chat: use contextual start with adaptive opening
          if (ctx.activeNode.value) {
            const prevId = ctx.lastActiveNodeId.value
            const transType = prevId ? 'navigation' : 'initial'
            try {
              await ctx.doStartContextualChat(
                ctx.activeNode.value.id,
                ctx.activeNode.value.name,
                '',
                prevId,
                transType,
                '',
              )
              ctx.chatMode.value = 'text_input'
              doc.applyInlineChatDoc(doc.buildInlineChatDoc())
            } catch {
              console.error('[MarkdownEditor] doStartContextualChat failed, falling back to text mode')
              // Fallback to simple text mode on failure
              doc.startChatText()
            }
          } else {
            doc.startChatText()
          }
        } else {
          ctx.chatMode.value = 'text_input'
          doc.applyInlineChatDoc(doc.buildInlineChatDoc())
        }
      }
    } finally {
      ctx.isAnimating.value = false
    }
  }

  async function startChatFile() {
    if (ctx.isAnimating.value) return
    ctx.isAnimating.value = true

    // Toggle: if already in file mode, restore to idle
    if (ctx.chatMode.value === 'file_upload' || ctx.chatMode.value === 'file_uploaded') {
      ctx.isFileSunk.value = false
      ctx.pendingFile.value = null
      ctx.chatMode.value = 'idle'
      ctx.isAnimating.value = false
      return
    }

    ctx.isFileSunk.value = true
    await new Promise(r => setTimeout(r, SINK_DURATION_MS))
    ctx.setFileMode()
    ctx.isAnimating.value = false
  }

  return { toggleChat, startChatFile, onCinemaChatMode }
}
