// @vitest-environment jsdom
// Regression corpus for the 2026-10-10 content-loss incident. Each sample
// failed (silent block loss or duplication) on @tiptap/markdown 3.20.4 with
// the repairEmptyBlocks workaround; on 3.21.0 with the workaround removed,
// every sample must parse losslessly. Run through the real extension stack
// plus the parse-integrity checker, exactly like production load.
import { describe, expect, it } from 'vitest';
import { makeEditor, parseDoc } from './roundtripTestUtils';
import { checkDocEquivalence, checkParseIntegrity } from './MarkdownEditorIntegrity';

const SAMPLES: Array<{ name: string; md: string }> = [
  {
    name: 'hard-break block after numbered items (production damage shape)',
    md: '10.12 未来有你二开\n\n1. 在小红书、b站查清楚规则\n2. 完善作品集和CV:  \n2.1. 完善Locus  \n2.2. 完善11days  \n2.3. 完善Jity\n3. 跟上AIGC小组作业的进度\n\n三件事情：\n\n1. 完善fork项目：Locus\n2. 利用Locus完善11days\n3. 完善Jity',
  },
  {
    name: 'ordered list followed by heading and paragraph',
    md: '1. first item\n2. second item\n\n## Section After List\n\nParagraph right after the list heading.',
  },
  {
    name: 'ordered list followed directly by block math',
    md: '1. item one\n2. item two\n\n$$\nE = mc^2\n$$\n\ntrailing paragraph',
  },
  {
    name: 'three-plus consecutive blank lines',
    md: 'alpha paragraph\n\n\n\nbeta paragraph\n\n\n\ngamma paragraph',
  },
  {
    name: 'mixed task and bullet list',
    md: '- [x] done task\n- plain bullet\n- [ ] open task\n\nafter list text',
  },
  {
    name: 'full document: list, table, inline math, blanks',
    md: '# 项目\n\n1. 完善fork项目：Locus\n2. 利用Locus完善11days\n\n需要拿出对应功能、测试结果：\n\n| 项目 | 侧重 |\n| --- | --- |\n| jity | 互动叙事 |\n| Locus | 任务规划 |\n\n公式 $E=mc^2$ 与文字。\n\n岗位摘要',
  },
];

describe('upgrade regression samples (3.20.4 → 3.21.0)', () => {
  it('parses every incident sample without loss or duplication', () => {
    const editor = makeEditor();
    const failures: string[] = [];
    for (const sample of SAMPLES) {
      const doc = parseDoc(editor, sample.md);
      const report = checkParseIntegrity(sample.md, doc);
      if (!report.ok) {
        failures.push(`${sample.name}: ${JSON.stringify(report.issues)}`);
      }
      // The parse must also survive serialization. Comparing serialized
      // string against re-parse alone is not enough: if serialization itself
      // dropped content, both sides of that check would share the loss. The
      // doc-vs-doc equivalence check pins the editor document before and
      // after the serialize/re-parse round trip.
      if (doc) {
        const reserialized = (() => {
          editor.commands.setContent(doc, { emitUpdate: false });
          return editor.getMarkdown();
        })();
        const reparsed = parseDoc(editor, reserialized);
        if (reparsed === null) {
          failures.push(`${sample.name} (reserialized): re-parse returned null`);
          continue;
        }
        const docEquivalence = checkDocEquivalence(doc, reparsed);
        if (!docEquivalence.ok) {
          failures.push(`${sample.name} (doc roundtrip): ${JSON.stringify(docEquivalence.issues)}`);
        }
        const rereport = checkParseIntegrity(reserialized, reparsed);
        if (!rereport.ok) {
          failures.push(`${sample.name} (reserialized): ${JSON.stringify(rereport.issues)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('parses link-shaped table samples without loss or duplication (round-6)', () => {
    // The production parse resolves reference links inside cells and
    // linkifies bare URLs — none of that may read as content loss or
    // injection.
    const editor = makeEditor();
    const failures: string[] = [];
    const samples: Array<{ name: string; md: string }> = [
      {
        name: 'reference link inside a table cell',
        md: 'top:\n\n[ref]: https://def.example\n\n| see [text][ref] here | x |\n| --- | --- |',
      },
      {
        name: 'bare URL inside a table cell',
        md: '| bare https://bare.example url | x |\n| --- | --- |',
      },
      {
        name: 'angle-bracket reference definition used inside a table cell',
        md: 'top:\n\n[r]: <https://example.org>\n\n| see [site][r] here | x |\n| --- | --- |',
      },
    ];
    for (const sample of samples) {
      const parsed = parseDoc(editor, sample.md);
      if (!parsed) {
        failures.push(`${sample.name}: parse returned null`);
        continue;
      }
      const report = checkParseIntegrity(sample.md, parsed);
      if (!report.ok) {
        failures.push(`${sample.name}: ${JSON.stringify(report.issues)}`);
      }
      editor.commands.setContent(parsed, { emitUpdate: false });
      const reserialized = editor.getMarkdown();
      const reparsed = parseDoc(editor, reserialized);
      if (!reparsed) {
        failures.push(`${sample.name} (reserialized): re-parse returned null`);
        continue;
      }
      const equivalence = checkDocEquivalence(parsed, reparsed);
      if (!equivalence.ok) {
        failures.push(`${sample.name} (doc roundtrip): ${JSON.stringify(equivalence.issues)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('parses a bold span inside a table cell link without checker false positives (round-6)', () => {
    // The production parse splits "[**ab**cd](url)" into a bold and a plain
    // text node, both carrying the link mark. The source side records one
    // href, the doc side set-valued per cell — no false loss or injection.
    //
    // NOTE, separate defect: the @tiptap/markdown serializer renders the
    // combination as "**[ab**cd](url)", which re-parses with the link
    // degraded (bold text + linkified bare URL). The doc-vs-doc leg
    // legitimately reports that as a loss — a serializer mark-ordering bug
    // outside this checker round.
    const editor = makeEditor();
    const md = '| [**ab**cd](https://example.org) | x |\n| --- | --- |';
    const parsed = parseDoc(editor, md);
    const report = parsed ? checkParseIntegrity(md, parsed) : { ok: false, issues: [] };
    expect(parsed).not.toBeNull();
    expect(report.ok).toBe(true);
  });
});
