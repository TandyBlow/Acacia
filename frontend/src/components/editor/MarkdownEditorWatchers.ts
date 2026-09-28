import { onBeforeUnmount, onMounted, watch } from 'vue'
import type { Ref } from 'vue'
import type { Editor } from '@tiptap/core'
import type { MarkdownEditorSave } from './MarkdownEditorSave'
import type { MarkdownEditorContext } from './MarkdownEditorContext'

export function useMarkdownEditorWatchers(
  ctx: MarkdownEditorContext,
  deps: {
    save: MarkdownEditorSave
    editor: Ref<Editor | undefined>
    onCinemaChatMode: () => void
  },
) {
  async function refreshSameNameTree(): Promise<void> {
    try {
      await ctx.store.refreshTree()
    } catch (error) {
      console.error('[MarkdownEditor] Failed to refresh tree for same-name paths:', error)
    }
  }

  // Watch for file_upload mode with a pending file — switch to choice UI
  watch(ctx.pendingFile, async (file) => {
    if (file && ctx.chatMode.value === 'file_upload' && ctx.activeNode.value) {
      ctx.chatMode.value = 'file_uploaded'
    }
  })

  watch(
    [() => ctx.editor.value, () => ctx.activeNode.value?.id],
    (val, oldVal) => {
      deps.save.flushPendingSave()
      deps.save.resetAutoSave()

      const content = ctx.activeNode.value?.content ?? ''
      ctx.lastSavedContent.value = content
      ctx.draft.value = content

      ctx.hasUserEdited.value = false
      ctx.isChatSunk.value = false
      ctx.isFileSunk.value = false
      ctx.userInput.value = ''
      ctx.pendingFile.value = null
      ctx.setEditor(ctx.editor.value || null)

      // Handle node switching: exit active chat, check if new node has resumable session
      const newId = val?.[1]
      const oldId = oldVal?.[1]
      if (newId !== oldId) {
        if (oldId) {
          ctx.lastActiveNodeId.value = oldId
        }
        if (ctx.chatMode.value !== 'idle') {
          ctx.exitChat()
        }
        ctx.resetForNewNode()
        if (newId) {
          ctx.setNodeId(newId)
          if (ctx.hasResumableSession.value) {
            ctx.chatMode.value = 'idle'
          }
        }
      }

      if (ctx.activeNode.value && ctx.editor.value) {
        deps.save.syncEditorContent(content)
      }

      if (ctx.activeNode.value) {
        void refreshSameNameTree()
      }
    },
    { immediate: true },
  )

  watch(ctx.draft, (value) => {
    const nodeId = ctx.activeNode.value?.id
    if (!nodeId) {
      deps.save.clearAutoSaveTimer()
      return
    }

    if (value === ctx.lastSavedContent.value) {
      deps.save.clearAutoSaveTimer()
      return
    }

    // Don't auto-save during chat modes
    if (ctx.chatMode.value !== 'idle') {
      return
    }

    deps.save.scheduleAutoSave(nodeId, value)
  })

  onMounted(() => {
    ctx.registerRegion({
      id: 'content-editor',
      type: 'glass',
      element: ctx.editorRef,
      shouldShow: (state) => {
        return state.isAuthenticated &&
               state.activeNode !== null &&
               state.viewState === 'display'
      },
      parent: 'content',
    })

    window.addEventListener('cinema:chat-mode', deps.onCinemaChatMode)
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
  })

  // Last-chance flush for tab close / backgrounding.
  function onPageHide(): void {
    deps.save.flushPendingSave({ keepalive: true })
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      onPageHide()
    }
  }

  onBeforeUnmount(() => {
    deps.save.flushPendingSave()
    ctx.unregisterRegion('content-editor')
    deps.save.clearAutoSaveTimer()
    deps.editor.value?.destroy()
    window.removeEventListener('cinema:chat-mode', deps.onCinemaChatMode)
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })
}
