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
import { ListItemWithBlockMath } from './extensions/listItemWithBlockMath';
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

describe('block math survives a roundtrip', () => {
  it('keeps a multi-line $$ block as blockMath instead of collapsing it inline', () => {
    const editor = makeEditor();
    const md = 'Formula:\n$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$\n\ndone';

    const doc = parseDoc(editor, md);
    expect(doc?.content?.map(n => n.type)).toEqual(['paragraph', 'blockMath', 'paragraph']);
    expect(doc?.content?.[1]?.attrs?.latex).toContain('\\int_0^1');

    // The serialized form must parse back to blockMath, not inline math.
    const out = serialize(editor, doc!);
    const reparsed = parseDoc(editor, out);
    expect(reparsed?.content?.[1]?.type).toBe('blockMath');
    editor.destroy();
  });

  it('accepts a $$ block as the first node of a list item', () => {
    const editor = makeEditor();
    const doc = parseDoc(editor, '- $$x$$\n- plain item');

    const firstItem = doc?.content?.[0]?.content?.[0];
    expect(firstItem?.type).toBe('listItem');
    expect(firstItem?.content?.[0]?.type).toBe('blockMath');
    editor.destroy();
  });

  it('leaves $$ inside a code fence untouched', () => {
    const editor = makeEditor();
    const doc = parseDoc(editor, '```\ncost=$$X$$\n```');

    expect(doc?.content?.[0]?.type).toBe('codeBlock');
    const out = serialize(editor, doc!);
    expect(out).toContain('cost=$$X$$');
    expect(out).not.toContain('$cost');
    editor.destroy();
  });

  it('still parses single-$ inline math', () => {
    const editor = makeEditor();
    const doc = parseDoc(editor, 'energy is $E=mc^2$ here');

    const paragraph = doc?.content?.[0];
    const math = paragraph?.content?.find(n => n.type === 'inlineMath');
    expect(math?.attrs?.latex).toBe('E=mc^2');
    editor.destroy();
  });

  it('preserves < inside a multi-line $$ block', () => {
    const editor = makeEditor();
    const md = '$$\na < b\nc = d\n$$';

    const doc = parseDoc(editor, md);
    expect(doc?.content?.[0]?.type).toBe('blockMath');
    expect(doc?.content?.[0]?.attrs?.latex).toContain('a < b');
    editor.destroy();
  });
});

describe('angle brackets round-trip', () => {
  function inlineTexts(doc: JSONContent | null): string[] {
    return (doc?.content ?? []).flatMap(node =>
      (node.content ?? []).map(child => child.text ?? ''),
    );
  }

  it('keeps a bare comparison operator as literal text instead of &lt;', () => {
    const editor = makeEditor();
    const md = 'if a < b then done';

    const doc = parseDoc(editor, md);
    const out = serialize(editor, doc!);
    expect(out).toContain('a < b');
    expect(out).not.toContain('&lt;');

    const reparsed = parseDoc(editor, out);
    expect(serialize(editor, reparsed!)).toBe(out);
    editor.destroy();
  });

  it('keeps < inside inline code spans', () => {
    const editor = makeEditor();
    const md = 'use `code with <angle>` here';

    const doc = parseDoc(editor, md);
    const codeText = (doc?.content?.[0]?.content ?? []).find(n =>
      (n.marks ?? []).some(m => m.type === 'code'),
    );
    expect(codeText?.text).toBe('code with <angle>');

    const out = serialize(editor, doc!);
    expect(out).toContain('`code with <angle>`');
    expect(out).not.toContain('&lt;');
    editor.destroy();
  });

  it('keeps < inside fenced code blocks', () => {
    const editor = makeEditor();
    const md = '```\nif (a < b) return;\n```';

    const doc = parseDoc(editor, md);
    expect(doc?.content?.[0]?.type).toBe('codeBlock');
    const out = serialize(editor, doc!);
    expect(out).toContain('a < b');
    expect(out).not.toContain('&lt;');
    editor.destroy();
  });

  it('turns <scheme://...> autolinks into links and round-trips them', () => {
    const editor = makeEditor();
    const md = 'go to <https://x.com> now';

    const doc = parseDoc(editor, md);
    const linkNode = (doc?.content?.[0]?.content ?? []).find(n =>
      (n.marks ?? []).some(m => m.type === 'link'),
    );
    expect(linkNode?.text).toBe('https://x.com');

    const out = serialize(editor, doc!);
    expect(out).not.toContain('&lt;');
    const reparsed = parseDoc(editor, out);
    const stillLink = (reparsed?.content?.[0]?.content ?? []).find(n =>
      (n.marks ?? []).some(m => m.type === 'link'),
    );
    expect(stillLink).toBeDefined();
    editor.destroy();
  });

  it('keeps CJK angle-bracket text literal', () => {
    const editor = makeEditor();
    const md = 'see <中文> tag';

    const doc = parseDoc(editor, md);
    expect(inlineTexts(doc).join('')).toContain('<中文>');
    const out = serialize(editor, doc!);
    expect(out).toContain('<中文>');
    expect(out).not.toContain('&lt;');
    editor.destroy();
  });

  it('still neutralizes tag-shaped HTML as literal text', () => {
    const editor = makeEditor();
    const md = 'plain <b>bold</b> text';

    const doc = parseDoc(editor, md);
    const out = serialize(editor, doc!);
    // Only `<` is escaped (as before); the tag stays inert literal text.
    expect(out).toContain('&lt;b>');
    expect(out).not.toContain('<b>');

    const reparsed = parseDoc(editor, out);
    expect(serialize(editor, reparsed!)).toBe(out);
    editor.destroy();
  });
});
