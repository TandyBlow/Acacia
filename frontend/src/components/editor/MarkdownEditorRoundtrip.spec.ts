// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { makeEditor, makeEditorWithMath, parseDoc, serialize, blockTypes } from './roundtripTestUtils';
import type { JSONContent } from '@tiptap/core';

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
    expect(blockTypes(parseDoc(editor, triggerInput))).toEqual([
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

describe('inline math tokenizer boundaries', () => {
  it('keeps currency spans as plain text', () => {
    const editor = makeEditor();
    const md = 'It costs $5 and $10 total.';

    const doc = parseDoc(editor, md);
    const hasMath = (doc?.content?.[0]?.content ?? []).some(n => n.type === 'inlineMath');
    expect(hasMath).toBe(false);

    const out = serialize(editor, doc!);
    expect(out).toContain('$5 and $10 total.');
    editor.destroy();
  });

  it('keeps a dollar amount inside inline code untouched', () => {
    const editor = makeEditor();
    const md = 'cost `$100` and `$200` done';

    const doc = parseDoc(editor, md);
    const codeTexts = (doc?.content?.[0]?.content ?? [])
      .filter(n => (n.marks ?? []).some(m => m.type === 'code'))
      .map(n => n.text);
    expect(codeTexts).toEqual(['$100', '$200']);
    editor.destroy();
  });

  it('parses bold-wrapped math as math without leaving literal asterisks', () => {
    const editor = makeEditor();
    const md = '**$x$** end';

    const doc = parseDoc(editor, md);
    const children = doc?.content?.[0]?.content ?? [];
    const math = children.find(n => n.type === 'inlineMath');
    expect(math?.attrs?.latex).toBe('x');

    // Known upstream limitation: @tiptap/markdown's applyMarkToContent only
    // marks text nodes, so a mark on a bare atom (inlineMath) is not
    // representable. The regression this guards against is the old tokenizer
    // silently eating the ** delimiters; text around math keeps its bold.
    const out = serialize(editor, doc!);
    expect(out).not.toContain('**');
    editor.destroy();
  });

  it('keeps bold around currency as text inside bold', () => {
    const editor = makeEditor();
    const md = '**costs $5 and $10** total';

    const doc = parseDoc(editor, md);
    const boldText = (doc?.content?.[0]?.content ?? [])
      .filter(n => (n.marks ?? []).some(m => m.type === 'bold'))
      .map(n => n.text)
      .join('');
    expect(boldText).toContain('costs $5 and $10');
    editor.destroy();
  });

  it('still parses regular inline math with digit-leading or trailing latex', () => {
    const editor = makeEditor();
    const doc = parseDoc(editor, 'so $2x$ and $E=mc^2$ work');
    const latexes = (doc?.content?.[0]?.content ?? [])
      .filter(n => n.type === 'inlineMath')
      .map(n => n.attrs?.latex);
    expect(latexes).toEqual(['2x', 'E=mc^2']);
    editor.destroy();
  });

  it('keeps currency spans as text even when the stock math tokenizers are registered', () => {
    const editor = makeEditorWithMath('stock');
    const md = 'It costs $5 and $10 total.';

    const doc = parseDoc(editor, md);
    const hasMath = (doc?.content?.[0]?.content ?? []).some(n => n.type === 'inlineMath');
    expect(hasMath).toBe(false);

    const out = serialize(editor, doc!);
    expect(out).toContain('$5 and $10 total.');
    editor.destroy();
  });
});

describe('blocks emptied after lists get repaired', () => {
  it('keeps the paragraph that follows an ordered list', () => {
    const editor = makeEditor();
    const md = '1. one\n2. two\n\ntext after';

    const doc = parseDoc(editor, md);
    expect(blockTypes(doc)).toEqual(['orderedList', 'paragraph']);
    const last = doc?.content?.[1]?.content?.[0]?.text;
    expect(last).toBe('text after');

    const out = serialize(editor, doc!);
    expect(out).toContain('text after');
    editor.destroy();
  });

  it('repairs a heading emptied by a preceding ordered list', () => {
    const editor = makeEditor();
    const md = '1. one\n2. two\n\n# Heading after list';

    const doc = parseDoc(editor, md);
    const heading = doc?.content?.[1];
    expect(heading?.type).toBe('heading');
    expect(heading?.content?.[0]?.text).toBe('Heading after list');
    editor.destroy();
  });

  it('does not leak # lines from code fences into real headings', () => {
    const editor = makeEditor();
    const md = '```\n# FAKE\n```\n\n1. x\n\n# REAL';

    const doc = parseDoc(editor, md);
    const heading = (doc?.content ?? []).find(n => n.type === 'heading');
    expect(heading?.content?.[0]?.text).toBe('REAL');
    editor.destroy();
  });

  it('leaves already-populated blocks untouched', () => {
    const editor = makeEditor();
    const md = 'intro paragraph\n\n1. one\n\noutro paragraph';

    const doc = parseDoc(editor, md);
    expect(doc?.content?.[0]?.content?.[0]?.text).toBe('intro paragraph');
    expect(doc?.content?.[2]?.content?.[0]?.text).toBe('outro paragraph');
    editor.destroy();
  });
});
