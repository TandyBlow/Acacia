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
  kind: 'lost' | 'duplicated'
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
  headingLevels: number[]
  listStarts: number[]
  checkboxes: boolean[]
  tableRows: number[]
  hardBreaks: number
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
    .replace(/[*_~[\]()<>#!`+|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normMath(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function normCode(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim()
}

// ── Source-side extraction ─────────────────────────────────────────────

export function extractSourceShape(source: string): SourceShape {
  const shape: SourceShape = {
    counts: new Map(),
    headingLevels: [],
    listStarts: [],
    checkboxes: [],
    tableRows: [],
    hardBreaks: 0,
  }

  const pushUnit = (type: string, raw: string): void => {
    const value = type === 'prose' ? normProse(raw) : type === 'math' ? normMath(raw) : type === 'code' ? normCode(raw) : raw.trim()
    if (!value) return
    const key = `${type}\u0000${value}`
    const existing = shape.counts.get(key)
    if (existing) existing.count += 1
    else shape.counts.set(key, { type, sample: value.slice(0, 60), count: 1 })
  }

  // 1. Pull autolinks out as hrefs before code masking hides them.
  let text = source.replace(/<([A-Za-z][A-Za-z0-9+.-]*:\/\/[^<>\s]*)>/g, (_m, url: string) => {
    pushUnit('href', url)
    return ' '
  })

  // 2. Mask fences and inline code spans; their content becomes code units.
  const masked = maskCodeRegions(text)
  const regions = masked.protected.match(/\x00CR(\d+)\x00/g) ?? []
  for (const token of regions) {
    const index = parseInt(token.slice(4, -1), 10)
    const region = maskedRestorePeek(masked, index)
    if (region !== null) pushUnit('code', region)
  }
  text = masked.protected.replace(/\x00CR\d+\x00/g, '\n')

  // 3. Math spans use the same precedence as protectMathDollarSyntax.
  text = text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, latex: string) => {
      pushUnit('math', latex)
      return '\n'
    })
    .replace(/\$(?![ \d])([^$\n]+?)\$/g, (_m, latex: string) => {
      pushUnit('math', latex)
      return ' '
    })

  // 4. Images: src is a unit; the alt text stays in the prose flow, exactly
  // like the doc side keeps it inline in the paragraph.
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt: string, src: string) => {
    pushUnit('image', src)
    return alt
  })

  // 5. Inline links: href is a unit, link text stays in the prose flow.
  text = text.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, _label: string, href: string) => {
    pushUnit('href', href)
    return ' '
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
      }
      lineClass.push('none')
      continue
    }

    pushUnit('prose', line)
    lineClass.push('prose')
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
  headingLevels: number[]
  listStarts: number[]
  checkboxes: boolean[]
  tableRows: number[]
  hardBreaks: number
}

function extractDocShape(doc: JSONContent): DocShape {
  const shape: DocShape = {
    counts: new Map(),
    headingLevels: [],
    listStarts: [],
    checkboxes: [],
    tableRows: [],
    hardBreaks: 0,
  }

  const pushUnit = (type: string, value: string): void => {
    if (!value) return
    const key = `${type}\u0000${value}`
    const existing = shape.counts.get(key)
    if (existing) existing.count += 1
    else shape.counts.set(key, { type, sample: value.slice(0, 60), count: 1 })
  }

  /** Inline runs between hardBreaks become one prose line each. */
  const walkInline = (nodes: JSONContent[]): void => {
    let line = ''
    const flush = (): void => {
      const normalized = normProse(line)
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
        // Transparent for line merging: the alt text flows in place, matching
        // the source side where the alt replaced the image syntax.
        pushUnit('image', String(node.attrs?.src ?? ''))
        if (node.attrs?.alt) line += String(node.attrs.alt)
        continue
      }
      if (node.type === 'inlineMath') {
        // Transparent: the latex is its own unit; surrounding text stays one line.
        const latex = String(node.attrs?.latex ?? inlineText(node))
        pushUnit('math', latex)
        continue
      }
      if (node.type === 'text' && typeof node.text === 'string') {
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
            // Cell text is covered by the row-shape check; prose here would
            // double-count against single-line source rows.
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
  const pairs: Array<[string, number[], number[]]> = [
    ['heading level', source.headingLevels, doc.headingLevels],
    ['ordered list start', source.listStarts, doc.listStarts],
    ['task checkbox', source.checkboxes.map(Number), doc.checkboxes.map(Number)],
    ['table row width', source.tableRows, doc.tableRows],
  ]
  for (const [unit, want, have] of pairs) {
    const missing = missingSubsequence(want, have)
    if (missing > 0) {
      issues.push({ kind: 'lost', unit, sample: `${missing} of ${want.length}`, expected: want.length, actual: have.length })
    }
  }
  if (doc.hardBreaks < source.hardBreaks) {
    issues.push({
      kind: 'lost',
      unit: 'line break',
      sample: `${source.hardBreaks} line breaks in source`,
      expected: source.hardBreaks,
      actual: doc.hardBreaks,
    })
  }
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
