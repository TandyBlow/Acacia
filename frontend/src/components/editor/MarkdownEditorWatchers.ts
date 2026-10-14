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
      // The outgoing node's last editor state is already mirrored into its
      // save record; the record keeps its queued work, retry, and conflict.
      const previousId = oldVal?.[1]
      if (previousId) {
        deps.save.setNodeDraft(previousId, ctx.draft.value)
      }

      const content = ctx.activeNode.value?.content ?? ''
      // Restore the incoming node's preserved draft (or seed its record on
      // first touch — content AND the revision it was loaded at, which
      // becomes the write base of drafts edited on top of it). Confirmed
      // content and an open conflict come back through the derived views —
      // nothing is cleared on a switch.
      const restored = deps.save.prepareNodeView(
        ctx.activeNode.value?.id ?? '',
        content,
        ctx.activeNode.value?.revision ?? null,
      )
      ctx.draft.value = restored

      ctx.integrityIssueText.value = ''

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
        deps.save.syncEditorContent(restored)
      }

      if (ctx.activeNode.value) {
        void refreshSameNameTree()
      }
    },
    { immediate: true },
  )

  watch(ctx.draft, (value) => {
    const nodeId = ctx.activeNode.value?.id
    // No active node: this watcher manages no timers at all — other nodes'
    // queued retries must survive.
    if (!nodeId) return

    // Mirror the live draft into the node's record, so a switch preserves it.
    deps.save.setNodeDraft(nodeId, value)

    if (value === ctx.lastSavedContent.value) {
      // The draft reverted to the saved content: only this node's queued
      // work is stale. Clearing globally here would cancel another node's
      // armed retry; dropping the node's in-flight save without recording
      // the revert would leave the server on content the user took back.
      deps.save.cancelQueuedSave(nodeId, value)
      return
    }

    // An open conflict pauses autosave for its own node only: the user must
    // choose keep-mine or take-server before anything else is sent there.
    if (ctx.saveConflict.value?.nodeId === nodeId) {
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
    // Flushing sends the queued work now; the save session itself survives
    // the component — in-flight requests, retries, and open conflicts keep
    // running without an editor instance.
    deps.save.flushPendingSave()
    ctx.unregisterRegion('content-editor')
    deps.editor.value?.destroy()
    window.removeEventListener('cinema:chat-mode', deps.onCinemaChatMode)
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })
}
