// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Mathematics } from '@tiptap/extension-mathematics';
import { Markdown } from '@tiptap/markdown';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { all, createLowlight } from 'lowlight';
import { CodeBlockWithUi } from './extensions/codeBlockWithUi';
import { MarkdownBold, MarkdownItalic, MarkdownStrike } from './extensions/markdownInputRules';
import { createMarkdownEditorExtensions } from './MarkdownEditorExtensions';
import { parseMarkdownDoc } from './MarkdownEditorMarkdown';
import type { JSONContent } from '@tiptap/core';
import type { MarkdownEditorContext } from './MarkdownEditorContext';

/**
 * Mirrors the extension stack of MarkdownEditorEditor.ts so the tests exercise
 * the production parse pipeline. The Locked* extensions only affect editing
 * interactions, not parsing, and are left out.
 */
function makeEditor(): Editor {
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
    ],
  });
}

function parseDoc(editor: Editor, md: string): JSONContent | null {
  return parseMarkdownDoc(editor, md);
}

function blockTypes(editor: Editor, md: string): string[] | null {
  const doc = parseDoc(editor, md);
  return doc ? (doc.content ?? []).map(n => n.type ?? '') : null;
}

function serialize(editor: Editor, doc: JSONContent): string {
  editor.commands.setContent(doc, { emitUpdate: false });
  return editor.getMarkdown();
}

describe('image notes survive a roundtrip', () => {
  // The exact trigger from docs/tasks/2026-09-29-format-roundtrip-corruption.md.
  const triggerInput = [
    '# Title',
    '',
    'Some **bold** text with $E=mc^2$.',
    '',
    '![Figure 1](http://x/y.png)',
    '',
    '- list a',
    '- list b',
  ].join('\n');

  it('parses the diagnostic trigger input into block structure instead of failing', () => {
    const editor = makeEditor();
    expect(blockTypes(editor, triggerInput)).toEqual([
      'heading',
      'paragraph',
      'image',
      'bulletList',
    ]);
    editor.destroy();
  });

  it('splits a paragraph around a nested image, keeping text order', () => {
    const editor = makeEditor();
    const doc = parseDoc(editor, 'before the image\n![img](http://x/y.png)\nafter the image');

    expect(doc?.content?.map(n => n.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(doc?.content?.[0]?.content?.[0]?.text).toBe('before the image');
    expect(doc?.content?.[2]?.content?.[0]?.text).toBe('after the image');
    editor.destroy();
  });

  it('keeps an image nested in a list item as a block sibling of the paragraph', () => {
    const editor = makeEditor();
    const doc = parseDoc(editor, '- item text\n  ![img](http://x/y.png)');
    const item = doc?.content?.[0]?.content?.[0];

    expect(item?.type).toBe('listItem');
    expect(item?.content?.map(n => n.type)).toEqual(['paragraph', 'image']);
    editor.destroy();
  });

  it('is idempotent across serialize/parse cycles (no trailing-space growth)', () => {
    const editor = makeEditor();
    const firstDoc = parseDoc(editor, triggerInput);
    expect(firstDoc).not.toBeNull();

    const firstOut = serialize(editor, firstDoc!);
    const secondDoc = parseDoc(editor, firstOut);
    expect(secondDoc).not.toBeNull();
    const secondOut = serialize(editor, secondDoc!);

    expect(secondOut).toBe(firstOut);
    // The image must come back as a block line, not a flattened paragraph.
    expect(firstOut).toContain('![Figure 1](http://x/y.png)');
    expect(firstOut).toContain('# Title');
    editor.destroy();
  });
});
