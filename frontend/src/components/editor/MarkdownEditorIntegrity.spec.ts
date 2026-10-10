import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { checkParseIntegrity } from './MarkdownEditorIntegrity';

function doc(blocks: JSONContent[]): JSONContent {
  return { type: 'doc', content: blocks };
}

function paragraph(text: string): JSONContent {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

describe('checkParseIntegrity', () => {
  it('passes a plain document that round-trips cleanly', () => {
    const source = 'first line\n\nsecond line';
    const report = checkParseIntegrity(source, doc([paragraph('first line'), paragraph('second line')]));
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('flags losing one paragraph while duplicating another at equal total length', () => {
    const source = 'first paragraph is here\n\nsecond paragraph lives on';
    // Same total character count as the source — a length check would pass.
    const report = checkParseIntegrity(
      source,
      doc([paragraph('second paragraph lives on'), paragraph('second paragraph lives on')]),
    );
    expect(report.ok).toBe(false);
    const kinds = report.issues.map((i) => i.kind).sort();
    expect(kinds).toEqual(['duplicated', 'lost']);
  });

  it('flags blocks emptied after an ordered list (the original damage)', () => {
    const source = '1. one\n2. two\n\nafter list paragraph\n\n$$\nE=mc^2\n$$';
    const report = checkParseIntegrity(
      source,
      doc([
        {
          type: 'orderedList',
          attrs: { start: 1 },
          content: [
            { type: 'listItem', content: [paragraph('one')] },
            { type: 'listItem', content: [paragraph('two')] },
          ],
        },
      ]),
    );
    expect(report.ok).toBe(false);
    const units = report.issues.filter((i) => i.kind === 'lost').map((i) => i.unit);
    expect(units).toContain('prose');
    expect(units).toContain('math');
  });

  it('flags mis-repair duplication of a paragraph', () => {
    const source = 'alpha paragraph\n\nbeta paragraph';
    const report = checkParseIntegrity(
      source,
      doc([paragraph('alpha paragraph'), paragraph('alpha paragraph'), paragraph('beta paragraph')]),
    );
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.kind === 'duplicated' && i.sample.includes('alpha'))).toBe(true);
  });

  it('accepts pre-existing legitimate repeats', () => {
    const source = 'repeat me\n\nrepeat me';
    const report = checkParseIntegrity(source, doc([paragraph('repeat me'), paragraph('repeat me')]));
    expect(report.ok).toBe(true);
  });

  it('accepts reference-style link definitions resolved doc-side', () => {
    const source = 'see [the docs][ref] for details\n\n[ref]: https://example.com/docs';
    const report = checkParseIntegrity(
      source,
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'see ' },
            { type: 'text', text: 'the docs', marks: [{ type: 'link', attrs: { href: 'https://example.com/docs' } }] },
            { type: 'text', text: ' for details' },
          ],
        },
      ]),
    );
    expect(report.ok).toBe(true);
  });

  it('flags a lost heading level but tolerates surplus doc-side headings', () => {
    const source = '# Title\n\nbody text';
    const lost = checkParseIntegrity(source, doc([paragraph('Title'), paragraph('body text')]));
    expect(lost.ok).toBe(false);
    expect(lost.issues.some((i) => i.unit === 'heading level')).toBe(true);
  });

  it('flags lost task checkbox states', () => {
    const source = '- [x] done\n- [ ] todo';
    const lost = checkParseIntegrity(
      source,
      doc([
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [paragraph('done')] },
            { type: 'taskItem', attrs: { checked: false }, content: [paragraph('todo')] },
          ],
        },
      ]),
    );
    expect(lost.ok).toBe(true);

    const flipped = checkParseIntegrity(
      source,
      doc([
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: false }, content: [paragraph('done')] },
            { type: 'taskItem', attrs: { checked: false }, content: [paragraph('todo')] },
          ],
        },
      ]),
    );
    expect(flipped.ok).toBe(false);
  });

  it('checks table row shapes and ignores cell text as prose', () => {
    const source = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    const ok = checkParseIntegrity(
      source,
      doc([
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [{ type: 'tableCell' }, { type: 'tableCell' }] },
            { type: 'tableRow', content: [{ type: 'tableCell' }, { type: 'tableCell' }] },
          ],
        },
      ]),
    );
    expect(ok.ok).toBe(true);

    const truncated = checkParseIntegrity(
      source,
      doc([
        {
          type: 'table',
          content: [{ type: 'tableRow', content: [{ type: 'tableCell' }, { type: 'tableCell' }] }],
        },
      ]),
    );
    expect(truncated.ok).toBe(false);
  });

  it('preserves code block whitespace exactly', () => {
    const source = 'before\n\n```\nline1\n\n\nline3\n```\n\nafter';
    const ok = checkParseIntegrity(
      source,
      doc([
        paragraph('before'),
        { type: 'codeBlock', content: [
          { type: 'text', text: 'line1' },
          { type: 'hardBreak' },
          { type: 'hardBreak' },
          { type: 'text', text: 'line3' },
        ] },
        paragraph('after'),
      ]),
    );
    expect(ok.ok).toBe(true);
  });

  it('flags lost inline math while tolerating currency dollar spans', () => {
    const source = 'costs $5 and $10 total\n\nformula $E=mc^2$ here';
    const ok = checkParseIntegrity(
      source,
      doc([
        paragraph('costs $5 and $10 total'),
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'formula ' },
            { type: 'inlineMath', attrs: { latex: 'E=mc^2' } },
            { type: 'text', text: ' here' },
          ],
        },
      ]),
    );
    expect(ok.ok).toBe(true);

    const lost = checkParseIntegrity(source, doc([paragraph('costs $5 and $10 total'), paragraph('formula  here')]));
    expect(lost.ok).toBe(false);
    expect(lost.issues.some((i) => i.unit === 'math')).toBe(true);
  });

  it('counts soft-wrapped prose lines as line breaks', () => {
    const source = 'wrapped line one\nwrapped line two';
    const ok = checkParseIntegrity(
      source,
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'wrapped line one' },
            { type: 'hardBreak' },
            { type: 'text', text: 'wrapped line two' },
          ],
        },
      ]),
    );
    expect(ok.ok).toBe(true);

    const merged = checkParseIntegrity(source, doc([paragraph('wrapped line one wrapped line two')]));
    expect(merged.ok).toBe(false);
  });

  it('treats a null parse as a total loss', () => {
    const report = checkParseIntegrity('anything', null);
    expect(report.ok).toBe(false);
  });
});
