// Shared test harness for markdown roundtrip specs. Mirrors the extension
// stack of MarkdownEditorEditor.ts so the tests exercise the production
// parse pipeline. The Locked* extensions only affect editing interactions,
// not parsing, and are left out.
import { ref } from 'vue';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { BlockMath } from '@tiptap/extension-mathematics';
import { Markdown } from '@tiptap/markdown';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { all, createLowlight } from 'lowlight';
import { CodeBlockWithUi } from './extensions/codeBlockWithUi';
import { ListItemWithBlockMath } from './extensions/listItemWithBlockMath';
import { StrongSpanGuard, TightInlineMath } from './extensions/markdownMathTokenizers';
import { MarkdownBold, MarkdownItalic, MarkdownStrike } from './extensions/markdownInputRules';
import { createMarkdownEditorExtensions } from './MarkdownEditorExtensions';
import { parseMarkdownDoc } from './MarkdownEditorMarkdown';
import type { JSONContent } from '@tiptap/core';
import type { MarkdownEditorContext } from './MarkdownEditorContext';

export function makeEditor(): Editor {
  const lowlight = createLowlight(all);
  const ctxStub = {
    chatMode: ref('idle'),
    isApplyingExternalContent: ref(false),
  } as unknown as MarkdownEditorContext;
  const { TableMarkdownParser } = createMarkdownEditorExtensions(ctxStub);

  return new Editor({
    content: '',
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        bold: false,
        italic: false,
        strike: false,
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
      StrongSpanGuard,
      BlockMath.configure({
        katexOptions: {
          throwOnError: true,
          strict: false,
          trust: false,
        },
      }),
      TightInlineMath.configure({
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
    ],
  });
}

export function parseDoc(editor: Editor, md: string): JSONContent | null {
  return parseMarkdownDoc(editor, md);
}

export function serialize(editor: Editor, doc: JSONContent): string {
  editor.commands.setContent(doc, { emitUpdate: false });
  return editor.getMarkdown();
}

export function blockTypes(doc: JSONContent | null): string[] | null {
  return doc ? (doc.content ?? []).map(n => n.type ?? '') : null;
}

/** One-line summary of each block's inline content for assertions. */
export function dumpInline(doc: JSONContent | null): unknown {
  return (doc?.content ?? []).map(node => ({
    type: node.type,
    children: (node.content ?? []).map(child => ({
      type: child.type,
      text: child.text,
      marks: (child.marks ?? []).map(m => m.type),
      latex: child.attrs?.latex,
    })),
  }));
}
