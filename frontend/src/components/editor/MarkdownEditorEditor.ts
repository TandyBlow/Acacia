import { useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Mathematics } from '@tiptap/extension-mathematics'
import { Markdown } from '@tiptap/markdown'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { all, createLowlight } from 'lowlight'
import { CodeBlockWithUi } from './extensions/codeBlockWithUi'
import { ListItemWithBlockMath } from './extensions/listItemWithBlockMath'
import { MarkdownBold, MarkdownItalic, MarkdownStrike } from './extensions/markdownInputRules'
import { createMarkdownEditorExtensions } from './MarkdownEditorExtensions'
import type { MarkdownEditorHandlers } from './MarkdownEditorPaste'
import type { MarkdownEditorContext } from './MarkdownEditorContext'

export function createMarkdownEditorEditor(
  ctx: MarkdownEditorContext,
  handlers: MarkdownEditorHandlers,
): ReturnType<typeof useEditor> {
  const lowlight = createLowlight(all)
  const { TableMarkdownParser, LockedParagraphAttr, LockedNodes } = createMarkdownEditorExtensions(ctx)

  const editor = useEditor({
    content: '',
    contentType: 'markdown',
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        bold: false,
        italic: false,
        strike: false,
        // Replaced by ListItemWithBlockMath so list items can start with a
        // $$-math block without failing schema validation.
        listItem: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          HTMLAttributes: {
            target: '_blank',
            rel: 'noopener noreferrer nofollow',
          },
        },
      }),
      ListItemWithBlockMath,
      LockedParagraphAttr,
      Markdown.configure({
        markedOptions: {
          gfm: true,
          breaks: true,
        },
      }),
      Image.configure({
        allowBase64: false,
        HTMLAttributes: {
          loading: 'lazy',
        },
      }),
      CodeBlockWithUi.configure({
        lowlight,
      }),
      MarkdownBold,
      MarkdownItalic,
      MarkdownStrike,
      Mathematics.configure({
        katexOptions: {
          throwOnError: true,
          strict: false,
          trust: false,
        },
      }),
      Table.configure({
        resizable: false,
        HTMLAttributes: {
          class: 'md-table',
        },
      }),
      TableRow,
      TableCell,
      TableHeader,
      TableMarkdownParser,
      LockedNodes,
    ],
    editorProps: handlers.editorProps,
    onUpdate: handlers.onUpdate,
  })

  ctx.editor = editor
  return editor
}
