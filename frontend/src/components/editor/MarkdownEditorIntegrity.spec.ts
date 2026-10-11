import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { checkDocEquivalence, checkParseIntegrity } from './MarkdownEditorIntegrity';

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

  it('checks table row shapes and compares cell text as prose', () => {
    const source = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    const cell = (text: string) => ({
      type: 'tableCell',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    const ok = checkParseIntegrity(
      source,
      doc([
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('a'), cell('b')] },
            { type: 'tableRow', content: [cell('1'), cell('2')] },
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
          content: [{ type: 'tableRow', content: [cell('a'), cell('b')] }],
        },
      ]),
    );
    expect(truncated.ok).toBe(false);

    // Cells emptied out entirely: the row shape still matches, the text is gone.
    const emptied = checkParseIntegrity(
      source,
      doc([
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('a'), cell('b')] },
            { type: 'tableRow', content: [cell(''), cell('')] },
          ],
        },
      ]),
    );
    expect(emptied.ok).toBe(false);
    expect(emptied.issues.some((i) => i.kind === 'lost' && i.unit === 'prose' && (i.sample === '1' || i.sample === '2'))).toBe(true);
  });

  it('preserves code block whitespace exactly', () => {
    const source = 'before\n\n```\nline1\n\n\nline3\n```\n\nafter';
    const ok = checkParseIntegrity(
      source,
      doc([
        paragraph('before'),
        // Real parses keep the fenced content as one text node, newlines included.
        { type: 'codeBlock', content: [{ type: 'text', text: 'line1\n\n\nline3' }] },
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

  // ── Acceptance-review counterexamples (2026-10-10) ────────────────────

  it('flags swapped paragraph order with identical content counts', () => {
    const source = 'first paragraph comes first\n\nsecond paragraph comes second';
    const report = checkParseIntegrity(
      source,
      doc([paragraph('second paragraph comes second'), paragraph('first paragraph comes first')]),
    );
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.kind === 'reordered')).toBe(true);
  });

  it('flags a brand-new paragraph injected into the document', () => {
    const source = 'original paragraph stays';
    const report = checkParseIntegrity(
      source,
      doc([paragraph('original paragraph stays'), paragraph('a brand new injected paragraph')]),
    );
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.kind === 'injected' && i.sample.includes('brand new'))).toBe(true);
  });

  it('flags a table whose cell text was emptied', () => {
    const source = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    const cell = (text: string) => ({
      type: 'tableCell',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    const report = checkParseIntegrity(
      source,
      doc([
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('a'), cell('b')] },
            { type: 'tableRow', content: [cell(''), cell('')] },
          ],
        },
      ]),
    );
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.kind === 'lost' && i.unit === 'prose')).toBe(true);
  });

  it('keeps the plus sign so "a+b" losing into "ab" is caught', () => {
    const report = checkParseIntegrity('the sum is a+b here', doc([paragraph('the sum is ab here')]));
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.kind === 'lost' && i.sample.includes('a+b'))).toBe(true);
  });

  it('accepts a real plus sign that round-trips', () => {
    const report = checkParseIntegrity('1+1=2 is arithmetic', doc([paragraph('1+1=2 is arithmetic')]));
    expect(report.ok).toBe(true);
  });

  // ── Round-2 acceptance: false positives fixed ──────────────────────────

  it('accepts a normal inline link with its text', () => {
    const source = 'see [the docs](https://example.com) for details';
    const report = checkParseIntegrity(
      source,
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'see ' },
            { type: 'text', text: 'the docs', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
            { type: 'text', text: ' for details' },
          ],
        },
      ]),
    );
    expect(report.ok).toBe(true);
  });

  it('accepts a bare autolink', () => {
    const report = checkParseIntegrity(
      'visit <https://example.com> now',
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'visit ' },
            { type: 'text', text: 'https://example.com', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
            { type: 'text', text: ' now' },
          ],
        },
      ]),
    );
    expect(report.ok).toBe(true);
  });

  it('accepts a fenced code block whose first line is indented', () => {
    const report = checkParseIntegrity(
      'run this:\n\n```\n    return 1\n```\n\ndone',
      doc([
        paragraph('run this:'),
        { type: 'codeBlock', content: [{ type: 'text', text: '    return 1' }] },
        paragraph('done'),
      ]),
    );
    expect(report.ok).toBe(true);
  });

  it('accepts a standalone block-level image with alt text', () => {
    const report = checkParseIntegrity(
      'before\n\n![a diagram](https://example.com/d.png)\n\nafter',
      doc([
        paragraph('before'),
        { type: 'image', attrs: { src: 'https://example.com/d.png', alt: 'a diagram' } },
        paragraph('after'),
      ]),
    );
    expect(report.ok).toBe(true);
  });

  // ── Round-2 acceptance: comparison gaps closed ─────────────────────────

  it('flags table text moving between columns within a row', () => {
    const cell = (text: string) => ({
      type: 'tableCell',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    // Source row "x | y z"; parsed row merged the cells differently.
    const report = checkParseIntegrity(
      '| x | y z |\n| --- | --- |',
      doc([
        {
          type: 'table',
          content: [{ type: 'tableRow', content: [cell('x y'), cell('z')] }],
        },
      ]),
    );
    expect(report.ok).toBe(false);
  });

  it('flags two table cells swapping places', () => {
    const cell = (text: string) => ({
      type: 'tableCell',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    const report = checkParseIntegrity(
      '| a | b |\n| --- | --- |',
      doc([
        {
          type: 'table',
          content: [{ type: 'tableRow', content: [cell('b'), cell('a')] }],
        },
      ]),
    );
    expect(report.ok).toBe(false);
  });

  it('flags two formulas swapping places', () => {
    const source = 'first $a^2$ then $b^2$';
    const swapped = checkParseIntegrity(
      source,
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'first ' },
            { type: 'inlineMath', attrs: { latex: 'b^2' } },
            { type: 'text', text: ' then ' },
            { type: 'inlineMath', attrs: { latex: 'a^2' } },
          ],
        },
      ]),
    );
    expect(swapped.ok).toBe(false);
    expect(swapped.issues.some((i) => i.kind === 'reordered' && i.unit === 'math order')).toBe(true);

    const inOrder = checkParseIntegrity(
      source,
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'first ' },
            { type: 'inlineMath', attrs: { latex: 'a^2' } },
            { type: 'text', text: ' then ' },
            { type: 'inlineMath', attrs: { latex: 'b^2' } },
          ],
        },
      ]),
    );
    expect(inOrder.ok).toBe(true);
  });

  // ── Round-3 acceptance fixes ───────────────────────────────────────────

  it('accepts inline math appearing before a block formula', () => {
    // Source extraction must keep document order in a single pass; pulling
    // all block math first reported this normal document as reordered.
    const source = 'first $x$ then block:\n\n$$\ny\n$$\n\ndone';
    const report = checkParseIntegrity(
      source,
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'first ' },
            { type: 'inlineMath', attrs: { latex: 'x' } },
            { type: 'text', text: ' then block:' },
          ],
        },
        { type: 'blockMath', attrs: { latex: 'y' } },
        paragraph('done'),
      ]),
    );
    expect(report.ok).toBe(true);
  });

  it('flags text moving into a neighboring empty cell', () => {
    const cell = (text: string) => ({
      type: 'tableCell',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    const emptyCell = { type: 'tableCell', content: [{ type: 'paragraph' }] };
    const report = checkParseIntegrity(
      '| a | |\n| --- | --- |',
      doc([
        {
          type: 'table',
          content: [{ type: 'tableRow', content: [emptyCell, cell('a')] }],
        },
      ]),
    );
    expect(report.ok).toBe(false);
  });

  it('accepts bold text directly followed by plain text inside a cell', () => {
    const source = '| **ab**cd |\n| --- |';
    const report = checkParseIntegrity(
      source,
      doc([
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{
                    type: 'paragraph',
                    content: [
                      { type: 'text', text: 'ab', marks: [{ type: 'bold' }] },
                      { type: 'text', text: 'cd' },
                    ],
                  }],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(report.ok).toBe(true);
  });

  // ── Round-4 acceptance fixes ───────────────────────────────────────────

  it('accepts a formula preserved inside a table cell', () => {
    const source = '| 文本 | $x^2$ |\n| --- | --- |';
    const report = checkParseIntegrity(
      source,
      doc([
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [paragraph('文本')] },
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: 'x^2' } }] }],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(report.ok).toBe(true);
  });

  it('flags a formula deleted from a table cell (doc-vs-doc)', () => {
    const cellWithMath = {
      type: 'tableCell',
      content: [{ type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: 'x^2' } }] }],
    };
    const emptyCell = { type: 'tableCell', content: [{ type: 'paragraph' }] };
    const report = checkDocEquivalence(
      doc([{ type: 'table', content: [{ type: 'tableRow', content: [cellWithMath, emptyCell] }] }]),
      doc([{ type: 'table', content: [{ type: 'tableRow', content: [emptyCell, emptyCell] }] }]),
    );
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.unit === 'math')).toBe(true);
  });

  it('flags a cell link address changed (doc-vs-doc)', () => {
    const linkCell = (href: string) => ({
      type: 'tableCell',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href } }] }],
      }],
    });
    const report = checkDocEquivalence(
      doc([{ type: 'table', content: [{ type: 'tableRow', content: [linkCell('https://old.example')] }] }]),
      doc([{ type: 'table', content: [{ type: 'tableRow', content: [linkCell('https://new.example')] }] }]),
    );
    expect(report.ok).toBe(false);
  });

  it('accepts inline code inside a table cell without splitting the row', () => {
    const source = '| a `c` b | d |\n| --- | --- |';
    const report = checkParseIntegrity(
      source,
      doc([
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{
                    type: 'paragraph',
                    content: [
                      { type: 'text', text: 'a ' },
                      { type: 'text', text: 'c', marks: [{ type: 'code' }] },
                      { type: 'text', text: ' b' },
                    ],
                  }],
                },
                { type: 'tableCell', content: [paragraph('d')] },
              ],
            },
          ],
        },
      ]),
    );
    expect(report.ok).toBe(true);
  });

  it('accepts a link inside a table cell', () => {
    const source = '| see [docs](https://example.com) | x |\n| --- | --- |';
    const report = checkParseIntegrity(
      source,
      doc([
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{
                    type: 'paragraph',
                    content: [
                      { type: 'text', text: 'see ' },
                      { type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
                    ],
                  }],
                },
                { type: 'tableCell', content: [paragraph('x')] },
              ],
            },
          ],
        },
      ]),
    );
    expect(report.ok).toBe(true);
  });

  // ── Round-5 acceptance fixes ───────────────────────────────────────────

  const mathCell = (latex: string) => ({
    type: 'tableCell',
    content: [{ type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex } }] }],
  });
  const codeCell = (code: string) => ({
    type: 'tableCell',
    content: [{
      type: 'paragraph',
      content: [{ type: 'text', text: code, marks: [{ type: 'code' }] }],
    }],
  });
  const plainCell = (text: string) => ({
    type: 'tableCell',
    content: [paragraph(text)],
  });
  const linkCell = (text: string, href: string) => ({
    type: 'tableCell',
    content: [{
      type: 'paragraph',
      content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }],
    }],
  });
  const emptyCellNode = { type: 'tableCell', content: [{ type: 'paragraph' }] };
  const table = (rows: JSONContent[][]) => ({
    type: 'table',
    content: rows.map((cells) => ({ type: 'tableRow', content: cells })),
  });

  it('flags a formula moved into a neighboring empty cell', () => {
    const source = '| $x^2$ | |\n| --- | --- |';
    // Global counts and the prose sequence are identical on both sides —
    // only the positional per-cell comparison can see the move.
    const report = checkParseIntegrity(
      source,
      doc([table([[emptyCellNode, mathCell('x^2')]])]),
    );
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.kind === 'lost' && issue.unit === 'table cell')).toBe(true);

    const equivalent = checkDocEquivalence(
      doc([table([[mathCell('x^2'), emptyCellNode]])]),
      doc([table([[emptyCellNode, mathCell('x^2')]])]),
    );
    expect(equivalent.ok).toBe(false);
    expect(equivalent.issues.some((issue) => issue.kind === 'lost' && issue.unit === 'table cell')).toBe(true);
  });

  it('flags code moved between columns', () => {
    const source = '| `c` | d |\n| --- | --- |';
    const report = checkParseIntegrity(
      source,
      doc([table([[plainCell('d'), codeCell('c')]])]),
    );
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.unit === 'table cell')).toBe(true);
  });

  it('flags two cell link addresses swapped with the text unchanged', () => {
    const report = checkDocEquivalence(
      doc([table([[linkCell('t', 'https://one.example'), linkCell('t', 'https://two.example')]])]),
      doc([table([[linkCell('t', 'https://two.example'), linkCell('t', 'https://one.example')]])]),
    );
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.unit === 'table cell')).toBe(true);
  });

  it('accepts cells whose content matches positionally', () => {
    const source = '| `c` x | $y^2$ |\n| --- | --- |\n| z | |';
    const codeAndTextCell = {
      type: 'tableCell',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'c', marks: [{ type: 'code' }] },
          { type: 'text', text: ' x' },
        ],
      }],
    };
    const report = checkParseIntegrity(
      source,
      doc([table([
        [codeAndTextCell, mathCell('y^2')],
        [plainCell('z'), emptyCellNode],
      ])]),
    );
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });
});
