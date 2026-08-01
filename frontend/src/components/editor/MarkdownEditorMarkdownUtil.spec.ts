// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Editor, JSONContent } from '@tiptap/core';
import {
  buildPlainTextDoc,
  normalizePastedText,
  sanitizeMarkdownSource,
  stripUnknownNodes,
  wrapBareInlineContent,
} from './MarkdownEditorMarkdownUtil';

/**
 * Mock schema mirroring the node types registered in MarkdownEditorEditor.ts:
 * StarterKit (codeBlock disabled but re-added via CodeBlockWithUi), Image,
 * Mathematics (inlineMath/blockMath), Table (table/tableRow/tableCell/tableHeader).
 * stripUnknownNodes only reads schema.nodes[type], so a plain record is enough.
 */
const schemaNodeNames = [
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'horizontalRule',
  'hardBreak',
  'codeBlock',
  'image',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'inlineMath',
  'blockMath',
];

const mockSchema = {
  nodes: Object.fromEntries(schemaNodeNames.map(name => [name, { name }])),
} as unknown as Editor['schema'];

describe('stripUnknownNodes', () => {
  it('returns null for null, undefined, and primitive input', () => {
    expect(stripUnknownNodes(null as unknown as JSONContent, mockSchema)).toBeNull();
    expect(stripUnknownNodes(undefined as unknown as JSONContent, mockSchema)).toBeNull();
    expect(stripUnknownNodes('str' as unknown as JSONContent, mockSchema)).toBeNull();
  });

  it('returns a node without a type unchanged', () => {
    const input = { text: 'plain' } as JSONContent;
    expect(stripUnknownNodes(input, mockSchema)).toBe(input);
  });

  it('keeps known nodes and recurses into their content', () => {
    const input: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'hi' }],
        },
      ],
    };
    expect(stripUnknownNodes(input, mockSchema)).toEqual(input);
  });

  it('returns null for an unknown node with no content or text', () => {
    expect(stripUnknownNodes({ type: 'mystery' }, mockSchema)).toBeNull();
  });

  it('converts an unknown node that carries text into a text node', () => {
    expect(stripUnknownNodes({ type: 'mystery', text: 'hello' }, mockSchema)).toEqual({
      type: 'text',
      text: 'hello',
    });
  });

  it('returns null for an unknown node with empty text', () => {
    expect(stripUnknownNodes({ type: 'mystery', text: '' }, mockSchema)).toBeNull();
  });

  it('wraps an unknown node with inline children in a paragraph', () => {
    const input: JSONContent = {
      type: 'mystery',
      content: [
        { type: 'text', text: 'a' },
        { type: 'hardBreak' },
        { type: 'text', text: 'b' },
      ],
    };
    expect(stripUnknownNodes(input, mockSchema)).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'a' },
        { type: 'hardBreak' },
        { type: 'text', text: 'b' },
      ],
    });
  });

  it('drops an unknown node that has block children', () => {
    const input: JSONContent = {
      type: 'mystery',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
    };
    expect(stripUnknownNodes(input, mockSchema)).toBeNull();
  });

  it('drops an unknown node when its content is stripped to nothing', () => {
    const input: JSONContent = {
      type: 'mystery',
      content: [{ type: 'other-mystery', text: '' }],
    };
    expect(stripUnknownNodes(input, mockSchema)).toBeNull();
  });

  it('cleans unknown nodes nested inside known nodes', () => {
    const input: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'mystery', text: 'b' },
          ],
        },
      ],
    };
    expect(stripUnknownNodes(input, mockSchema)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
          ],
        },
      ],
    });
  });

  it('keeps a known node whose children are all stripped', () => {
    const input: JSONContent = {
      type: 'paragraph',
      content: [{ type: 'mystery', text: '' }],
    };
    expect(stripUnknownNodes(input, mockSchema)).toEqual({ type: 'paragraph', content: [] });
  });
});

describe('wrapBareInlineContent', () => {
  it('returns non-object input unchanged', () => {
    expect(wrapBareInlineContent(null as unknown as JSONContent)).toBeNull();
    expect(wrapBareInlineContent('x' as unknown as JSONContent)).toBe('x');
  });

  it('wraps bare text children of a listItem in a paragraph', () => {
    const input: JSONContent = {
      type: 'listItem',
      content: [{ type: 'text', text: 'hello' }],
    };
    expect(wrapBareInlineContent(input)).toEqual({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    });
  });

  it('groups consecutive inline children of a blockquote into one paragraph', () => {
    const input: JSONContent = {
      type: 'blockquote',
      content: [
        { type: 'text', text: 'a' },
        { type: 'hardBreak' },
        { type: 'text', text: 'b' },
      ],
    };
    expect(wrapBareInlineContent(input)).toEqual({
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'hardBreak' },
            { type: 'text', text: 'b' },
          ],
        },
      ],
    });
  });

  it('keeps block children as-is and wraps surrounding inline groups in listItem', () => {
    const input: JSONContent = {
      type: 'listItem',
      content: [
        { type: 'text', text: 'a' },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'text', text: 'nested' }] }],
        },
        { type: 'text', text: 'b' },
      ],
    };
    expect(wrapBareInlineContent(input)).toEqual({
      type: 'listItem',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nested' }] }],
            },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
      ],
    });
  });

  it('leaves a block wrapper whose children are already blocks unchanged', () => {
    const input: JSONContent = {
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
    };
    expect(wrapBareInlineContent(input)).toEqual(input);
  });

  it('does not wrap inline content inside a non-block node like paragraph', () => {
    const input: JSONContent = {
      type: 'paragraph',
      content: [{ type: 'text', text: 'hi' }],
    };
    expect(wrapBareInlineContent(input)).toEqual(input);
  });

  it('wraps bare inline children of the doc node in paragraphs', () => {
    const input: JSONContent = {
      type: 'doc',
      content: [{ type: 'text', text: 'a' }],
    };
    expect(wrapBareInlineContent(input)).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
    });
  });
});

describe('sanitizeMarkdownSource', () => {
  it('removes script blocks', () => {
    expect(sanitizeMarkdownSource('before<script>alert(1)</script>after')).toBe('beforeafter');
  });

  it('removes script blocks with attributes and case-insensitively', () => {
    expect(sanitizeMarkdownSource('<SCRIPT type="text/javascript">alert(1)</SCRIPT>')).toBe('');
    expect(sanitizeMarkdownSource('<script src="https://evil.example/x.js"></script>')).toBe('');
  });

  it('removes on- event handler attributes', () => {
    expect(sanitizeMarkdownSource('<img src="x.png" onerror="alert(1)">')).toBe('<img src="x.png">');
  });

  it('neutralizes javascript: href and src attributes', () => {
    expect(sanitizeMarkdownSource('<a href="javascript:alert(1)">x</a>')).toBe('<a href="#">x</a>');
    expect(sanitizeMarkdownSource("<img src='javascript:void(0)'>")).toBe('<img src="#">');
  });

  it('leaves normal markdown and safe HTML untouched', () => {
    const input = 'hello **bold** <em>em</em> <a href="https://example.com">link</a>';
    expect(sanitizeMarkdownSource(input)).toBe(input);
  });
});

describe('normalizePastedText', () => {
  it('normalizes CRLF and CR line endings to LF', () => {
    expect(normalizePastedText('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('removes zero-width space, non-joiner, joiner, and BOM code units', () => {
    expect(normalizePastedText('​hi‍')).toBe('hi');
    expect(normalizePastedText('‌')).toBe('');
    expect(normalizePastedText('﻿')).toBe('');
  });

  it('preserves CJK and other text outside the zero-width range', () => {
    expect(normalizePastedText('中文')).toBe('中文');
  });

  it('converts non-breaking spaces to regular spaces', () => {
    expect(normalizePastedText('a b')).toBe('a b');
  });
});

describe('buildPlainTextDoc', () => {
  it('returns a doc with a single empty paragraph for empty input', () => {
    expect(buildPlainTextDoc('')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
  });

  it('builds a single text node for one line', () => {
    expect(buildPlainTextDoc('hello')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    });
  });

  it('inserts hardBreak between lines', () => {
    expect(buildPlainTextDoc('a\nb\nc')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'hardBreak' },
            { type: 'text', text: 'b' },
            { type: 'hardBreak' },
            { type: 'text', text: 'c' },
          ],
        },
      ],
    });
  });

  it('skips empty lines but keeps the hardBreaks between non-empty lines', () => {
    expect(buildPlainTextDoc('a\n\nb')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'hardBreak' },
            { type: 'hardBreak' },
            { type: 'text', text: 'b' },
          ],
        },
      ],
    });
  });

  it('normalizes CRLF and non-breaking spaces before building', () => {
    expect(buildPlainTextDoc('a\r\nb c')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'hardBreak' },
            { type: 'text', text: 'b c' },
          ],
        },
      ],
    });
  });

  it('keeps a whitespace-only line as text content', () => {
    expect(buildPlainTextDoc('   ')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }],
    });
  });
});
