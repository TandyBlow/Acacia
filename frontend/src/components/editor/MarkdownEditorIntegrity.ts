import type { JSONContent } from '@tiptap/core'
import { maskCodeRegions } from './MarkdownEditorMarkdownUtil'

/**
 * Parse-integrity checker: compares what went into the markdown parser with
 * what came out, per content unit, so a parse that silently dropped or
 * duplicated blocks can never be autosaved over the server's copy.
 *
 * The source side is extracted independently from the markdown text (never
 * from mgr.parse output), so a corrupted parse cannot hide behind itself.
 *
 * Comparison rules:
 * - prose / code / math / image units: bidirectional occurrence counts. A
 *   missing unit is a loss; an extra occurrence is duplication (the
 *   mis-repair signature). Pre-existing repeats in the source are expected
 *   on both sides and never flagged.
 * - href: loss only (reference-style definitions resolve doc-side, so a
 *   doc-side href surplus is legal).
 * - heading levels, ordered-list start numbers, task checkbox states, table
 *   row shapes, hard breaks: ordered subsequence check, loss only.
 * - Length is reported but never decides: losing one paragraph and
 *   duplicating another keeps total length stable.
 */

export interface IntegrityIssue {
  kind: 'lost' | 'duplicated' | 'injected' | 'reordered'
  /** e.g. "prose", "code", "math", "image", "href", "heading level" */
  unit: string
  /** Human-readable preview of the content unit. */
  sample: string
  expected: number
  actual: number
}

export interface IntegrityReport {
  ok: boolean
  issues: IntegrityIssue[]
}

type CountKey = string // e.g. `prose\u0000<normalized text>`

interface SourceShape {
  counts: Map<CountKey, { type: string; sample: string; count: number }>
  /** Normalized prose units in document order, repeats included. */
  proseSeq: string[]
  /** Math latex units in document order, repeats included. */
  mathSeq: string[]
  headingLevels: number[]
  listStarts: number[]
  checkboxes: boolean[]
  tableRows: number[]
  hardBreaks: number
}

/**
 * Sentinel unit for an empty table cell. Empty cells keep their position in
 * the prose sequence: text moving into a neighboring empty cell would
 * otherwise look like a no-op, since empty cells are skipped as content.
 */
const EMPTY_CELL = '\u0000empty-cell'

function unitSample(value: string): string {
  return value === EMPTY_CELL ? '(empty cell)' : value.slice(0, 60)
}

const ENTITY_DECODED: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

function decodeEntities(text: string): string {
  return text.replace(/&(?:lt|gt|amp|quot|#39|apos|nbsp);/g, (m) => ENTITY_DECODED[m] ?? m)
}

/** Normalize prose so markdown-level rewrites (marks, escapes, entities) vanish. */
function normProse(text: string): string {
  return decodeEntities(text)
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1')
    // Only emphasis markers are pure syntax here: link/image/heading/table
    // syntax is stripped at its extraction site, and characters like + and
    // | are legitimate prose ("a+b", "a | b") — dropping them would blind
    // the checker to "a+b" losing into "ab".
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normMath(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Code keeps its internal whitespace exactly (fenced blocks preserve
 * indentation on both sides); only line endings are normalized. Trimming
 * here would desynchronize the sides whenever a fenced block starts or ends
 * with an indented line.
 */
function normCode(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * Strip the fence/backtick markers from a masked code region so the unit
 * matches the doc side, whose code text never carries them: fenced blocks
 * lose their opening/closing lines, inline spans their backticks plus the
 * single CommonMark padding space on each side when present.
 */
function stripCodeFence(region: string): string {
  const withoutBlock = region
    .replace(/^\s*(`{3,}|~{3,})[^\n]*\n/, '')
    .replace(/\n\s*(`{3,}|~{3,})\s*$/, '')
  if (withoutBlock !== region) return withoutBlock
  const inline = /^(`+)([\s\S]*)\1$/.exec(region.trim())
  if (!inline) return region
  let content = inline[2] ?? ''
  if (content.length >= 2 && content.startsWith(' ') && content.endsWith(' ')) {
    content = content.slice(1, -1)
  }
  return content
}

// ── Source-side extraction ─────────────────────────────────────────────

export function extractSourceShape(source: string): SourceShape {
  const shape: SourceShape = {
    counts: new Map(),
    proseSeq: [],
    mathSeq: [],
    headingLevels: [],
    listStarts: [],
    checkboxes: [],
    tableRows: [],
    hardBreaks: 0,
  }

  const pushUnit = (type: string, raw: string): void => {
    const value = type === 'prose' ? normProse(raw) : type === 'math' ? normMath(raw) : type === 'code' ? normCode(raw) : raw.trim()
    if (!value) return
    if (type === 'prose') shape.proseSeq.push(value)
    if (type === 'math') shape.mathSeq.push(value)
    const key = `${type}\u0000${value}`
    const existing = shape.counts.get(key)
    if (existing) existing.count += 1
    else shape.counts.set(key, { type, sample: unitSample(value), count: 1 })
  }

  // 1. Pull autolinks out as hrefs before code masking hides them. The URL
  // text stays in the prose flow: the doc side renders an autolink as link
  // text, so it must appear on both sides.
  let text = source.replace(/<([A-Za-z][A-Za-z0-9+.-]*:\/\/[^<>\s]*)>/g, (_m, url: string) => {
    pushUnit('href', url)
    return url
  })

  // 2. Mask fences and inline code spans; their content becomes code units.
  const masked = maskCodeRegions(text)
  const regions = masked.protected.match(/\x00CR(\d+)\x00/g) ?? []
  for (const token of regions) {
    // token = \x00CR<digits>\x00 — digits start at index 3 (the NUL is one char).
    const index = parseInt(token.slice(3, -1), 10)
    const region = maskedRestorePeek(masked, index)
    if (region !== null) pushUnit('code', stripCodeFence(region))
  }
  text = masked.protected.replace(/\x00CR\d+\x00/g, '\n')

  // 3. Math spans in one pass so units keep source order: extracting all
  // block math before all inline math would reorder a document that has
  // inline math before a block and produce a false "reordered".
  text = text.replace(
    /\$\$([\s\S]+?)\$\$|\$(?![ \d])([^$\n]+?)\$/g,
    (_m, blockLatex: string | undefined, inlineLatex: string | undefined) => {
      if (blockLatex !== undefined) {
        pushUnit('math', blockLatex)
        return '\n'
      }
      pushUnit('math', inlineLatex ?? '')
      return ' '
    },
  )

  // 4. Images: src is a unit. The alt text becomes its own prose line:
  // TipTap images are block-level nodes, and the production parse lifts an
  // inline image out of its paragraph, so the doc side never carries an
  // image mid-line — splitting the source the same way keeps the sides
  // aligned for standalone and lifted images alike.
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt: string, src: string) => {
    pushUnit('image', src)
    return alt ? `\n${alt}\n` : '\n'
  })

  // 5. Inline links: href is a unit, the link text stays in the prose flow —
  // dropping it would flag every normal link as injected content.
  text = text.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label: string, href: string) => {
    pushUnit('href', href)
    return label
  })

  // 5b. Reference-style links [text][ref]: the label stays in prose, the
  // [ref] marker disappears (its URL resolves doc-side into a link mark).
  text = text.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')

  // 6. Reference-style definitions resolve doc-side only; drop the lines so
  // they do not masquerade as lost prose.
  text = text.replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '')

  // 7. Line-level structure: headings, ordered starts, task boxes, tables.
  // `breaks: true` turns a newline between two prose lines into a hardBreak
  // node, while block boundaries (headings, list items, blank lines) do not
  // produce one — count only prose-to-prose adjacencies.
  const lines = text.split('\n')
  const isTableRow = detectTableRows(lines)
  const lineClass: Array<'prose' | 'none'> = []

  let previousWasOrderedItem = false
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i] ?? ''
    const line = rawLine.replace(/^ {0,3}>\s?/, '')

    if (!line.trim() || /^\s*(=+|-{2,}|\*{3,}|_{3,})\s*$/.test(line)) {
      // Blank, setext underline, or thematic-break line: no prose unit either side.
      lineClass.push('none')
      continue
    }

    const heading = /^ {0,3}(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      shape.headingLevels.push((heading[1] ?? '').length)
      pushUnit('prose', heading[2] ?? '')
      lineClass.push('none')
      continue
    }

    const task = /^ {0,3}[-*+]\s+\[([xX ])\]\s*/.exec(line)
    if (task) {
      shape.checkboxes.push((task[1] ?? ' ') !== ' ')
      pushUnit('prose', line.replace(/^ {0,3}[-*+]\s+\[[xX ]\]\s*/, ''))
      lineClass.push('none')
      continue
    }

    const ordered = /^ {0,3}(\d{1,9})[.)]\s+(.*)$/.exec(line)
    if (ordered) {
      if (!previousWasOrderedItem) shape.listStarts.push(parseInt(ordered[1] ?? '1', 10))
      previousWasOrderedItem = true
      pushUnit('prose', ordered[2] ?? '')
      lineClass.push('none')
      continue
    }
    previousWasOrderedItem = false

    if (isTableRow.has(i)) {
      // The delimiter row marks the table but produces no row node doc-side.
      if (!/^\s*\|?\s*:?-{3,}[-| :]*$/.test(line)) {
        const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
        shape.tableRows.push(inner.split('|').length)
        // Each cell is its own prose unit, preserving cell boundaries: a
        // row-merged unit would let text move between columns of the same
        // row unnoticed ("x | y z" rearranged to "x y | z" joins equally).
        for (const cell of inner.split('|')) {
          // Empty cells keep their position as sentinel units, so text
          // moving into a neighboring empty cell is still detected.
          if (normProse(cell)) pushUnit('prose', cell)
          else pushUnit('prose', EMPTY_CELL)
        }
      }
      lineClass.push('none')
      continue
    }

    // Plain bullet markers are syntax, not content (task/ordered handled
    // above); the bullet line is a block boundary, never an in-paragraph
    // line break.
    const isBulletLine = /^\s*[-*+]\s+/.test(line)
    pushUnit('prose', line.replace(/^\s*[-*+]\s+/, ''))
    lineClass.push(isBulletLine ? 'none' : 'prose')
  }

  for (let i = 0; i < lineClass.length - 1; i += 1) {
    if (lineClass[i] === 'prose' && lineClass[i + 1] === 'prose') {
      shape.hardBreaks += 1
    }
  }

  return shape
}

/** Second pass to read masked regions by index (the mask only hands back the whole string). */
function maskedRestorePeek(
  masked: { protected: string; restore: (s: string) => string },
  index: number,
): string | null {
  const restored = masked.restore(`\x00CR${index}\x00`)
  return restored === `\x00CR${index}\x00` ? null : restored
}

function detectTableRows(lines: string[]): Set<number> {
  const rows = new Set<number>()
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i]!.includes('|')) continue
    // A delimiter row like | --- | --- | marks the surrounding pipe lines as a table.
    for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 1); j += 1) {
      if (/^\s*\|?\s*:?-{3,}[-| :]*$/.test(lines[j] ?? '')) {
        let start = i
        let end = i
        while (start > 0 && (lines[start - 1] ?? '').includes('|')) start -= 1
        while (end < lines.length - 1 && (lines[end + 1] ?? '').includes('|')) end += 1
        for (let k = start; k <= end; k += 1) rows.add(k)
        i = end
        break
      }
    }
  }
  return rows
}

// ── Doc-side extraction ────────────────────────────────────────────────

interface DocShape {
  counts: Map<CountKey, { type: string; sample: string; count: number }>
  /** Normalized prose units in document order, repeats included. */
  proseSeq: string[]
  /** Math latex units in document order, repeats included. */
  mathSeq: string[]
  headingLevels: number[]
  listStarts: number[]
  checkboxes: boolean[]
  tableRows: number[]
  hardBreaks: number
}

function extractDocShape(doc: JSONContent): DocShape {
  const shape: DocShape = {
    counts: new Map(),
    proseSeq: [],
    mathSeq: [],
    headingLevels: [],
    listStarts: [],
    checkboxes: [],
    tableRows: [],
    hardBreaks: 0,
  }

  const pushUnit = (type: string, value: string): void => {
    if (!value) return
    if (type === 'prose') shape.proseSeq.push(value)
    if (type === 'math') shape.mathSeq.push(value)
    const key = `${type}\u0000${value}`
    const existing = shape.counts.get(key)
    if (existing) existing.count += 1
    else shape.counts.set(key, { type, sample: unitSample(value), count: 1 })
  }

  /** Inline runs between hardBreaks become one prose line each. */
  const walkInline = (nodes: JSONContent[]): void => {
    let line = ''
    const flush = (): void => {
      // Lazily-continued list text keeps its source marker as literal text
      // ("3. followed-on line"); stripping the marker here mirrors the
      // source side, where ordered/bullet lines are stripped the same way.
      const normalized = normProse(line.replace(/^\s*(\d{1,9}[.)]\s+|[-*+]\s+)/, ''))
      if (normalized) pushUnit('prose', normalized)
      line = ''
    }
    for (const node of nodes) {
      if (node.type === 'hardBreak') {
        shape.hardBreaks += 1
        flush()
        continue
      }
      if (node.type === 'image') {
        // The alt text becomes its own prose unit, mirroring the source
        // side where image syntax splits into its own line.
        flush()
        pushUnit('image', String(node.attrs?.src ?? ''))
        const alt = String(node.attrs?.alt ?? '')
        if (alt) pushUnit('prose', normProse(alt))
        continue
      }
      if (node.type === 'inlineMath') {
        // Transparent: the latex is its own unit; surrounding text stays one line.
        const latex = String(node.attrs?.latex ?? inlineText(node))
        pushUnit('math', latex)
        continue
      }
      if (node.type === 'text' && typeof node.text === 'string') {
        // Inline code spans are code units, mirroring the source side where
        // the backticks are stripped — they must not leak into the prose line.
        if ((node.marks ?? []).some((m) => m.type === 'code')) {
          flush()
          pushUnit('code', node.text)
          continue
        }
        line += node.text
        for (const mark of node.marks ?? []) {
          if (mark.type === 'link' && mark.attrs?.href) pushUnit('href', String(mark.attrs.href))
        }
        continue
      }
      if (Array.isArray(node.content)) walkInline(node.content)
    }
    flush()
  }

  const walkBlock = (node: JSONContent): void => {
    switch (node.type) {
      case 'image': {
        // TipTap images are block-level by default: a standalone image line
        // is a direct doc child and must be extracted here.
        pushUnit('image', String(node.attrs?.src ?? ''))
        const alt = String(node.attrs?.alt ?? '')
        if (alt) pushUnit('prose', normProse(alt))
        return
      }
      case 'paragraph':
      case 'heading': {
        if (node.type === 'heading') shape.headingLevels.push(Number(node.attrs?.level ?? 1))
        walkInline(Array.isArray(node.content) ? node.content : [])
        return
      }
      case 'codeBlock': {
        const text = codeBlockText(node)
        pushUnit('code', text)
        return
      }
      case 'blockMath': {
        pushUnit('math', String(node.attrs?.latex ?? inlineText(node)))
        return
      }
      case 'orderedList': {
        shape.listStarts.push(Number(node.attrs?.start ?? 1))
        for (const child of node.content ?? []) walkBlock(child)
        return
      }
      case 'taskItem': {
        shape.checkboxes.push(node.attrs?.checked === true)
        for (const child of node.content ?? []) walkBlock(child)
        return
      }
      case 'table': {
        for (const row of node.content ?? []) {
          if (row.type === 'tableRow') {
            const cells = (row.content ?? []).filter(c => c.type === 'tableCell' || c.type === 'tableHeader')
            shape.tableRows.push(cells.length)
            // Each cell is its own prose unit, preserving cell boundaries —
            // a row-merged unit would let text move between columns of the
            // same row unnoticed. Empty cells keep their position as
            // sentinel units, mirroring the source side.
            for (const cell of cells) {
              const text = normProse(collectCellText(cell))
              if (text) pushUnit('prose', text)
              else pushUnit('prose', EMPTY_CELL)
            }
          }
        }
        return
      }
      default: {
        for (const child of node.content ?? []) walkBlock(child)
      }
    }
  }

  for (const child of doc.content ?? []) walkBlock(child)
  return shape
}

function inlineText(node: JSONContent): string {
  return (node.content ?? []).map(c => c.text ?? '').join('')
}

/**
 * All text inside a table cell. Inline runs concatenate directly — a bold
 * span followed by plain text is "abcd", never "ab cd" — while separate
 * block children of the cell (multiple paragraphs) join with a space.
 */
function collectCellText(node: JSONContent): string {
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : ''
  if (node.type === 'hardBreak') return ' '
  if (node.type === 'paragraph' || node.type === 'heading') {
    return (node.content ?? []).map(collectCellText).join('')
  }
  return (node.content ?? []).map(collectCellText).join(' ')
}

function codeBlockText(node: JSONContent): string {
  let out = ''
  for (const child of node.content ?? []) {
    if (child.type === 'hardBreak') out += '\n'
    else if (typeof child.text === 'string') out += child.text
  }
  return out
}

// ── Comparison ─────────────────────────────────────────────────────────

function compareCounts(
  source: SourceShape,
  doc: DocShape,
  issues: IntegrityIssue[],
  flags: { loss: boolean; duplication: boolean },
): void {
  for (const [key, expected] of source.counts) {
    const actual = doc.counts.get(key)
    const actualCount = actual?.count ?? 0
    if (actualCount < expected.count && (flags.loss || expected.type !== 'href')) {
      issues.push({
        kind: 'lost',
        unit: expected.type,
        sample: expected.sample,
        expected: expected.count,
        actual: actualCount,
      })
    }
    if (actualCount > expected.count && flags.duplication && expected.type !== 'href' && expected.type !== 'image') {
      issues.push({
        kind: 'duplicated',
        unit: expected.type,
        sample: expected.sample,
        expected: expected.count,
        actual: actualCount,
      })
    }
  }
  // Content present in the doc but absent from the source: injected blocks
  // (an extra paragraph, swapped-in text). Without this pass a parse that
  // added brand-new units alongside the original ones would pass, since the
  // loop above only inspects keys the source knows about. Reference-style
  // hrefs resolve doc-side only, so they stay exempt.
  for (const [key, actual] of doc.counts) {
    if (source.counts.has(key)) continue
    if (actual.type === 'href') continue
    issues.push({
      kind: 'injected',
      unit: actual.type,
      sample: actual.sample,
      expected: 0,
      actual: actual.count,
    })
  }
}

function missingSubsequence(needle: number[], haystack: number[]): number {
  let at = 0
  let missing = 0
  for (const want of needle) {
    let found = -1
    for (let i = at; i < haystack.length; i += 1) {
      if (haystack[i] === want) {
        found = i
        break
      }
    }
    if (found === -1) {
      missing += 1
    } else {
      at = found + 1
    }
  }
  return missing
}

function compareSequences(source: SourceShape, doc: DocShape, issues: IntegrityIssue[]): void {
  // A folded list (lazy continuation) legitimately changes the parsed list
  // count while keeping every character; value checks apply only when the
  // two sides agree on how many there are.
  const pairs: Array<[string, number[], number[]]> = [
    ['heading level', source.headingLevels, doc.headingLevels],
    ['table row width', source.tableRows, doc.tableRows],
  ]
  if (source.listStarts.length === doc.listStarts.length) {
    pairs.push(['ordered list start', source.listStarts, doc.listStarts])
  }
  if (source.checkboxes.length === doc.checkboxes.length) {
    pairs.push(['task checkbox', source.checkboxes.map(Number), doc.checkboxes.map(Number)])
  }
  for (const [unit, want, have] of pairs) {
    const missing = missingSubsequence(want, have)
    if (missing > 0) {
      issues.push({ kind: 'lost', unit, sample: `${missing} of ${want.length}`, expected: want.length, actual: have.length })
    }
  }
  // Line breaks are presentation-level: re-serialization legitimately turns
  // some hard breaks into paragraph boundaries (e.g. when a lazily-absorbed
  // list continuation splits into its own block). Flag only a collapse —
  // most or all line structure gone — not a single converted break.
  if (source.hardBreaks > 0 && doc.hardBreaks < source.hardBreaks / 2) {
    issues.push({
      kind: 'lost',
      unit: 'line break',
      sample: `${source.hardBreaks} line breaks in source`,
      expected: source.hardBreaks,
      actual: doc.hardBreaks,
    })
  }
  // Paragraph order: only meaningful when the content multiset matches —
  // a loss or duplication is already reported above, and reordering with
  // identical counts is its own corruption ("A, B" parsed as "B, A").
  const countsMatch =
    source.counts.size === doc.counts.size &&
    [...source.counts.entries()].every(([key, expected]) => doc.counts.get(key)?.count === expected.count)
  if (countsMatch) {
    if (sequenceReordered(source.proseSeq, doc.proseSeq)) {
      issues.push({
        kind: 'reordered',
        unit: 'paragraph order',
        sample: firstOutOfOrder(source.proseSeq, doc.proseSeq),
        expected: source.proseSeq.length,
        actual: doc.proseSeq.length,
      })
    }
    // Math participates in ordering too: two formulas swapping places keeps
    // every count intact and must not pass on counts alone.
    if (sequenceReordered(source.mathSeq, doc.mathSeq)) {
      issues.push({
        kind: 'reordered',
        unit: 'math order',
        sample: firstOutOfOrder(source.mathSeq, doc.mathSeq),
        expected: source.mathSeq.length,
        actual: doc.mathSeq.length,
      })
    }
  }
}

/** True when needle's units no longer appear in haystack in the same order. */
function sequenceReordered(needle: string[], haystack: string[]): boolean {
  let at = 0
  for (const unit of needle) {
    const found = haystack.indexOf(unit, at)
    if (found === -1) return true
    at = found + 1
  }
  return false
}

function firstOutOfOrder(needle: string[], haystack: string[]): string {
  let at = 0
  for (const unit of needle) {
    const found = haystack.indexOf(unit, at)
    if (found === -1) return unit.slice(0, 60)
    at = found + 1
  }
  return ''
}

export function checkParseIntegrity(source: string, doc: JSONContent | null): IntegrityReport {
  if (doc === null) {
    return { ok: false, issues: [{ kind: 'lost', unit: 'document', sample: source.slice(0, 60), expected: 1, actual: 0 }] }
  }
  const sourceShape = extractSourceShape(source)
  const docShape = extractDocShape(doc)

  const issues: IntegrityIssue[] = []
  compareCounts(sourceShape, docShape, issues, { loss: true, duplication: true })
  compareSequences(sourceShape, docShape, issues)

  return { ok: issues.length === 0, issues }
}

/**
 * Compare two document shapes directly — used to prove that a serialization
 * step kept the editor's document intact: comparing only the serialized
 * string against its re-parse would miss content lost during serialization
 * itself, since both sides of that check would share the loss.
 */
export function checkDocEquivalence(before: JSONContent, after: JSONContent): IntegrityReport {
  const beforeShape = extractDocShape(before)
  const afterShape = extractDocShape(after)

  const issues: IntegrityIssue[] = []
  compareCounts(beforeShape, afterShape, issues, { loss: true, duplication: true })
  compareSequences(beforeShape, afterShape, issues)

  return { ok: issues.length === 0, issues }
}
