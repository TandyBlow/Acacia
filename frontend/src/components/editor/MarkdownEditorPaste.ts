import DOMPurify from 'dompurify'
import { mathMigrationRegex, migrateMathStrings } from '@tiptap/extension-mathematics'
import type { Editor } from '@tiptap/core'
import type { EditorView } from 'prosemirror-view'
import { parseMarkdownWithIntegrity } from './MarkdownEditorMarkdown'
import { buildPlainTextDoc, normalizePastedText, sanitizeMarkdownSource } from './MarkdownEditorMarkdownUtil'
import type { MarkdownEditorContext } from './MarkdownEditorContext'

const PROSEMIRROR_SLICE_MIME = 'application/x-prosemirror-slice'

export function createMarkdownEditorHandlers(
  ctx: MarkdownEditorContext,
  chat: { sendInlineMessage: () => Promise<void> },
) {
  const editorProps = {
    attributes: {
      class: 'editor-prose',
      spellcheck: 'false',
    },
    transformPastedHTML: (html: string) =>
      DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
      }),
    transformPastedText: (text: string) => normalizePastedText(text),
    handlePaste: (_view: EditorView, event: ClipboardEvent) => {
      if (!ctx.editor.value || !event.clipboardData) {
        return false
      }

      const clipboardTypes = Array.from(event.clipboardData.types)
      if (clipboardTypes.includes(PROSEMIRROR_SLICE_MIME)) {
        return false
      }

      // Per Clipboard API spec, getData() throws DOMException for types
      // not present in clipboardData.types. We check types first so this
      // should never throw; a throw here is a real bug worth surfacing.
      const markdownText = clipboardTypes.includes('text/markdown')
        ? event.clipboardData.getData('text/markdown')
        : ''
      const plainText = clipboardTypes.includes('text/plain')
        ? event.clipboardData.getData('text/plain')
        : ''

      const source = sanitizeMarkdownSource(normalizePastedText(markdownText || plainText))
      if (!source) {
        return false
      }

      const { doc: parsedDoc, integrity } = parseMarkdownWithIntegrity(ctx.editor.value, source)
      // A parse that dropped or duplicated units falls back to plain text:
      // silent loss never enters the document through paste either.
      const safeDoc = parsedDoc !== null && integrity.ok ? parsedDoc : buildPlainTextDoc(source)
      const insertContent = Array.isArray(safeDoc.content) ? safeDoc.content : []

      event.preventDefault()
      if (insertContent.length === 0) {
        return ctx.editor.value.commands.insertContent({ type: 'paragraph' })
      }
      return ctx.editor.value.commands.insertContent(insertContent)
    },
    handleDOMEvents: {
      keydown: (_view: EditorView, event: KeyboardEvent) => {
        if (!(event instanceof KeyboardEvent)) return false
        if (ctx.chatMode.value !== 'text_input') return false
        if (ctx.isBusy.value) return false
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          void chat.sendInlineMessage()
          return true
        }
        // Prevent backspace from deleting into locked nodes
        if (event.key === 'Backspace') {
          const { state } = _view
          const { from, to } = state.selection
          if (from !== to) return false // let filterTransaction handle selections
          const $pos = state.doc.resolve(from)
          // At start of paragraph with locked node before it
          if ($pos.parentOffset === 0 && ($pos.nodeBefore?.attrs?.locked ?? false)) {
            event.preventDefault()
            return true
          }
          // In empty paragraph that follows a locked node
          if ($pos.parent.textContent === '' && ($pos.nodeBefore?.attrs?.locked ?? false)) {
            event.preventDefault()
            return true
          }
        }
        return false
      },
      click: (_view: EditorView, event: MouseEvent) => {
        if (!(event instanceof MouseEvent)) {
          return false
        }

        const target = event.target
        if (!(target instanceof HTMLElement)) {
          return false
        }

        const link = target.closest('a')
        if (!(link instanceof HTMLAnchorElement)) {
          return false
        }

        const href = link.getAttribute('href')
        if (!href) {
          return true
        }

        if (!(event.ctrlKey || event.metaKey)) {
          return false
        }

        event.preventDefault()
        window.open(href, '_blank', 'noopener,noreferrer')
        return true
      },
    },
  }

  const onUpdate = ({ editor: instance }: { editor: Editor }) => {
    if (ctx.isApplyingExternalContent.value) {
      return
    }

    // Don't mark user-edited or auto-save during chat modes
    if (ctx.chatMode.value !== 'idle') {
      return
    }

    if (!ctx.hasUserEdited.value && instance.state.doc.textContent.length > 0) {
      ctx.hasUserEdited.value = true
    }

    if (!ctx.isMigratingMath.value) {
      const textContent = instance.state.doc.textContent
      mathMigrationRegex.lastIndex = 0
      if (mathMigrationRegex.test(textContent)) {
        ctx.isMigratingMath.value = true
        migrateMathStrings(instance)
        ctx.isMigratingMath.value = false
      }
    }

    ctx.draft.value = instance.getMarkdown()
  }

  return { editorProps, onUpdate }
}

export type MarkdownEditorHandlers = ReturnType<typeof createMarkdownEditorHandlers>
