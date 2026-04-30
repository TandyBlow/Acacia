# Phase N3: UI Polish - Research

**Researched:** 2026-04-30
**Domain:** TipTap rich-text editor extensions, Vue 3 charting, accessibility (ARIA/keyboard nav), stats/heatmap data visualization
**Confidence:** HIGH

## Summary

Phase N3 enhances the Acacia application across four fronts: (1) Markdown editor gains table, task list, mermaid diagram, and export support via TipTap extensions; (2) ARIA labels and keyboard navigation bring the app closer to WAI-ARIA compliance using Radix Vue primitives and custom keyboard handlers; (3) a Stats Dashboard replaces the current static stats display with interactive trend charts and a domain heatmap; (4) a Review Heatmap provides GitHub-style calendar visualization of daily review consistency.

**Primary recommendation:** Extend the existing TipTap editor with official v3 extensions (table, task list) and a custom Mermaid Node for diagrams. Use uPlot (15-20KB gzip) via uplot-vue for trend charts -- the lightest option compatible with Tailwind CSS v4. Build a custom calendar heatmap component rather than depending on unmaintained third-party packages. Leverage Radix Vue's built-in ARIA support for interactive components and add explicit labels to custom components (Knob, MarkdownEditor, QuizPanel). Add two new backend endpoints (`/review-heatmap`, `/quiz-trends`) backed by SQL queries on the existing `quiz_records` table.

**Critical architecture insight:** The phase reuses existing infrastructure -- no new Pinia stores, no new database tables, no new services. All enhancements extend existing composables (`useStats`, `useReview`) and add new composables for heatmap data. The TipTap editor gains extensions without structural changes to `MarkdownEditor.vue`. Charts and heatmaps render in new sub-components under the existing `StatsPanel.vue` and a new `ReviewHeatmap.vue` component.

## User Constraints (from CONTEXT.md)

_No CONTEXT.md exists for this phase. All decisions are at Claude's discretion within the project conventions documented in CLAUDE.md and .planning/codebase/._

### Locked Decisions
- _None -- first planning phase for N3_

### Claude's Discretion
- Charting library selection (uPlot vs Vue Data UI vs vue-chartjs)
- Calendar heatmap approach (vue3-calendar-heatmap vs custom build vs Heat.js)
- Mermaid rendering approach (community extension vs custom Node extension)
- Export format scope (Markdown + HTML required; PDF optional)
- New API endpoint design for heatmap/trend data
- ARIA label scope and keyboard shortcut assignments
- Extension upgrade strategy (align starter-kit 3.15.3 with core 3.20.4)

### Deferred Ideas (OUT OF SCOPE)
- PWA push notifications (Phase N5)
- AI SSE streaming (Phase N4)
- Zero-downtime deploy (Phase N6)
- Daily SQLite backups (Phase N6)
- Review streak celebration animations (QUIZ-05, belongs in Phase 3)
- Mobile responsive optimization (v2 requirements)

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Markdown editor extensions (table, task list, mermaid) | Browser / Client (TipTap editor) | -- | TipTap runs entirely client-side. Extensions are pure JavaScript with no server dependency. |
| Markdown/HTML/PDF export | Browser / Client (TipTap + export libs) | -- | Export is a client-side operation. TipTap's `getMarkdown()` / `getHTML()` are built-in. PDF via html2pdf.js runs in browser. |
| ARIA labels and keyboard navigation | Browser / Client (Vue components) | -- | Accessibility is a frontend concern. Radix Vue provides ARIA; custom keyboard handlers in Vue components. |
| Stats trend charts | Browser / Client (uPlot) | API / Backend (new `/quiz-trends` endpoint) | Charts render client-side. Backend provides aggregated trend data from quiz_records. |
| Domain heatmap | Browser / Client (custom SVG component) | API / Backend (enhanced `/quiz-stats`) | Client renders the heatmap grid. Backend provides per-domain accuracy data from nodes join quiz_records. |
| Review calendar heatmap | Browser / Client (custom or vue3-calendar-heatmap) | API / Backend (new `/review-heatmap` endpoint) | Client renders the calendar grid. Backend provides daily review counts from quiz_records. |
| Heatmap/trend data queries | API / Backend (FastAPI endpoints) | Database / Storage (SQLite quiz_records + nodes) | Backend owns data aggregation. Existing quiz_records table schema is sufficient -- no new tables needed. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @tiptap/extension-table | 3.22.5 [VERIFIED: npm registry] | Table editing (row/col add/delete, resize) | Official TipTap v3 extension; consolidated single-package import with TableKit |
| @tiptap/extension-list | 3.22.5 [VERIFIED: npm registry] | TaskList + TaskItem (checkboxes), bullet/ordered lists | Official TipTap v3 extension; already installed at 3.15.3 -- upgrade to align. TaskList is included but not currently configured. |
| mermaid | ^11.x | Diagram rendering engine | Industry standard for text-to-diagram (flowcharts, sequence, Gantt, etc.). Client-side SVG generation. |
| uplot | 1.6.32 [VERIFIED: npm registry] | Time series / trend line charts | Lightest charting library (~15-20KB gzip); native TypeScript; renders on Canvas for high performance |
| uplot-vue | 1.2.4 [VERIFIED: npm registry] | Vue 3 wrapper for uPlot | Declarative Vue component API; maintained |
| html2pdf.js | 0.14.0 [VERIFIED: npm registry] | Client-side PDF export from HTML | Free, zero-server-dependency PDF generation from TipTap HTML output |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vue3-calendar-heatmap | 2.0.5 [VERIFIED: npm registry] | GitHub-style calendar heatmap component | If the component works out of the box for review consistency display. Last updated ~3 years ago -- evaluate before adopting. |
| DOMPurify | 3.3.3 (already installed) | HTML sanitization for export | Already used in MarkdownEditor for paste handling; reused for export sanitization |
| @tiptap/markdown | 3.20.4 (already installed) | Markdown serialization/deserialization | Already used for editor content persistence; provides getMarkdown() for export |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| uPlot + uplot-vue | Vue Data UI | Vue Data UI has 60+ component types and is Vue 3 native, but larger bundle. uPlot is lighter (15KB vs ~200KB+) and is sufficient for the two chart types needed (trend line + maybe a bar chart). |
| uPlot + uplot-vue | vue-chartjs v4 (Chart.js) | Chart.js has broader chart types (pie, radar) but larger bundle (~40-60KB tree-shaken). uPlot is purpose-built for time series -- exactly what trend charts need. |
| html2pdf.js | @tiptap-pro/extension-export-pdf | Tiptap Pro PDF export is paid ($/month) and server-side. html2pdf.js is free, client-side, and zero ongoing cost. Quality is acceptable for personal knowledge management use. |
| Custom calendar heatmap | Heat.js | Heat.js is framework-agnostic and actively maintained, but adds an extra dependency. A custom SVG-based heatmap is ~100 lines of Vue code and avoids maintenance risk. |
| Custom Mermaid Node extension | tiptap-extension-mermaid (v0.0.0) | Community package is effectively unmaintained (0.0.0, 1 maintainer). A custom TipTap Node extension gives full control over rendering and uses the mature mermaid library directly. |
| Build custom table extension | @tiptap/extension-table (official) | Official table extension is production-tested, handles edge cases (merged cells, col resize, keyboard nav), and saves 500+ lines of code. Never hand-roll a table editor. |

**Installation:**

```bash
cd frontend

# Upgrade existing TipTap packages to aligned versions
npm install @tiptap/starter-kit@^3.22.5 @tiptap/core@^3.22.5 @tiptap/vue-3@^3.22.5 @tiptap/pm@^3.22.5

# New TipTap extensions
npm install @tiptap/extension-table@^3.22.5 @tiptap/extension-list@^3.22.5

# Mermaid for diagram rendering
npm install mermaid

# Charting: trend charts
npm install uplot uplot-vue

# PDF export
npm install html2pdf.js

# Calendar heatmap (evaluate first; may replace with custom)
npm install vue3-calendar-heatmap
```

**Version verification:**
- @tiptap/extension-table: 3.22.5 [VERIFIED: npm view @tiptap/extension-table version]
- @tiptap/extension-list: 3.22.5 [VERIFIED: npm view @tiptap/extension-list version]
- tiptap-extension-mermaid: 0.0.0 [VERIFIED: npm view tiptap-extension-mermaid version] -- effectively unmaintained
- uplot: 1.6.32 [VERIFIED: npm view uplot version]
- uplot-vue: 1.2.4 [VERIFIED: npm view uplot-vue version]
- vue3-calendar-heatmap: 2.0.5 [VERIFIED: npm view vue3-calendar-heatmap version]
- html2pdf.js: 0.14.0 [VERIFIED: npm view html2pdf.js version]
- Current @tiptap/core: 3.20.4 installed (deduped), starter-kit 3.15.3 [VERIFIED: npm ls]
- Current @tiptap/markdown: 3.20.4 installed [VERIFIED: npm ls]

## Architecture Patterns

### System Architecture Diagram

```
                        EDITOR ENHANCEMENTS (client-side only)
    ┌─────────────────────────────────────────────────────────────────┐
    │  MarkdownEditor.vue                                              │
    │                                                                  │
    │  TipTap Editor (useEditor)                                       │
    │  ┌────────────────────────────────────────────────────────────┐ │
    │  │ Extensions:                                                  │ │
    │  │  StarterKit (existing) + CodeBlockWithUi + Math + Image     │ │
    │  │  + NEW: TableKit (Table, TableRow, TableCell, TableHeader)  │ │
    │  │  + NEW: TaskList + TaskItem (from @tiptap/extension-list)   │ │
    │  │  + NEW: MermaidNode (custom Node extension)                 │ │
    │  │  Markdown (existing -- output serialization)                │ │
    │  └────────────────────────────────────────────────────────────┘ │
    │                                                                  │
    │  Export buttons (new toolbar or dropdown)                        │
    │  ┌────────────────────────────────────────────────────────────┐ │
    │  │ Export Markdown: editor.getMarkdown() → .md file download   │ │
    │  │ Export HTML:    editor.getHTML()    → .html file download   │ │
    │  │ Export PDF:     editor.getHTML()    → html2pdf.js → .pdf    │ │
    │  └────────────────────────────────────────────────────────────┘ │
    └─────────────────────────────────────────────────────────────────┘

                    STATS DASHBOARD (client + new API endpoints)
    ┌─────────────────────────────────────────────────────────────────┐
    │  StatsPanel.vue (enhanced from current)                          │
    │  ┌──────────────────────────┐  ┌──────────────────────────────┐ │
    │  │ GrowthStage + ReviewCoverage│  │ TrendChart.vue (NEW)        │ │
    │  │ (existing, keep)          │  │ uPlot line chart:            │ │
    │  │                            │  │  - mastery_score over time   │ │
    │  │                            │  │  - daily quiz accuracy %     │ │
    │  │                            │  │  - review count per day      │ │
    │  └──────────────────────────┘  └──────────────────────────────┘ │
    │  ┌────────────────────────────────────────────────────────────┐ │
    │  │ DomainHeatmap.vue (NEW)                                     │ │
    │  │ Custom SVG grid: rows=domain, cols=metric, color=intensity │ │
    │  │ Data from /quiz-stats (existing, enhanced)                  │ │
    │  └────────────────────────────────────────────────────────────┘ │
    │  ┌────────────────────────────────────────────────────────────┐ │
    │  │ ReviewHeatmap.vue (NEW)                                     │ │
    │  │ Calendar heatmap: 52 weeks x 7 days, color=daily_review_cnt│ │
    │  │ Data from /review-heatmap (NEW endpoint)                    │ │
    │  └────────────────────────────────────────────────────────────┘ │
    └─────────────────────────────────────────────────────────────────┘

                    DATA FLOW (stats/heatmap)
    ┌──────────────────┐         ┌──────────────────────────────────┐
    │  StatsPanel.vue   │────────▶│  useStats().fetchStats()          │
    │  (onMounted)      │         │  GET /quiz-stats → StatsNode[]   │
    └──────────────────┘         └──────────────────────────────────┘
                                            │
    ┌──────────────────┐         ┌─────────▼────────────────────────┐
    │  TrendChart.vue   │────────▶│  useTrends().fetchTrends()         │
    │  (onMounted)      │         │  GET /quiz-trends → TrendPoint[]  │
    └──────────────────┘         └─────────│──────────────────────────┘
                                            │  NEW endpoint
    ┌──────────────────┐         ┌─────────▼────────────────────────┐
    │  ReviewHeatmap.vue│────────▶│  useHeatmap().fetchHeatmap()       │
    │  (onMounted)      │         │  GET /review-heatmap → DayCount[] │
    └──────────────────┘         └─────────│──────────────────────────┘
                                            │  NEW endpoint
                                   ┌───────▼──────────────────────────┐
                                   │  Backend (main.py)               │
                                   │  /quiz-trends → quiz_service     │
                                   │  /review-heatmap → review_service│
                                   │  Both query quiz_records table   │
                                   └──────────────────────────────────┘
```

### Recommended Project Structure

```
frontend/src/
├── components/
│   ├── editor/
│   │   ├── MarkdownEditor.vue          # MODIFIED: add extensions, export toolbar
│   │   ├── EditorToolbar.vue           # NEW: export buttons (MD/HTML/PDF) + table menu
│   │   └── extensions/
│   │       ├── codeBlockWithUi.ts      # existing
│   │       ├── markdownInputRules.ts   # existing
│   │       └── mermaidNode.ts          # NEW: custom TipTap Node for mermaid diagrams
│   ├── stats/
│   │   ├── StatsPanel.vue              # MODIFIED: add TrendChart, DomainHeatmap sections
│   │   ├── TrendChart.vue              # NEW: uPlot trend line chart
│   │   ├── DomainHeatmap.vue           # NEW: domain performance heatmap grid
│   │   └── ReviewHeatmap.vue           # NEW: calendar heatmap component
│   └── review/
│       └── ReviewPanel.vue             # MINOR: add ARIA labels
├── composables/
│   ├── useStats.ts                     # MODIFIED: add domain breakdown fetch
│   ├── useReview.ts                    # existing
│   ├── useTrends.ts                    # NEW: fetch quiz trend data
│   └── useHeatmap.ts                   # NEW: fetch review heatmap data
├── constants/
│   └── uiStrings.ts                    # MODIFIED: add export labels, ARIA labels

backend/
├── main.py                             # MODIFIED: add /quiz-trends, /review-heatmap endpoints
├── quiz_service_sqlite.py              # MODIFIED: add get_quiz_trends_sqlite()
└── review_service_sqlite.py            # MODIFIED: add get_review_heatmap_sqlite()
```

### Pattern 1: TipTap Extension Registration (Table + Task List)

**What:** Enable table and task list editing by adding official TipTap v3 extensions. Table editing requires Table, TableRow, TableCell, TableHeader from `@tiptap/extension-table`. Task lists use TaskList and TaskItem from `@tiptap/extension-list` (already installed at 3.15.3 but not configured).

**When to use:** Register once in `MarkdownEditor.vue` `useEditor({ extensions: [...] })`.

**Example:**
```typescript
// Source: https://tiptap.dev/docs/editor/extensions/nodes/table
// Verified: @tiptap/extension-table v3 consolidated API [CITED: npm registry]

import { Table, TableRow, TableCell, TableHeader, TableKit } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'

// In MarkdownEditor.vue extensions array:
extensions: [
  // ... existing extensions ...
  TableKit.configure({
    resizable: true,  // allow column resize via drag handle
  }),
  // OR register individually:
  // Table.configure({ resizable: true }),
  // TableRow,
  // TableHeader,
  // TableCell,
  TaskList,
  TaskItem.configure({
    nested: true,       // allow nested task items
    HTMLAttributes: {
      class: 'task-list-item',
    },
  }),
]
```

### Pattern 2: Custom Mermaid Node Extension

**What:** A custom TipTap Node extension that renders mermaid code blocks as live SVG diagrams. Extends the existing code block pattern (CodeBlockWithUi) but renders mermaid output instead of syntax-highlighted code.

**When to use:** When user types a code block with `mermaid` language identifier, automatically render as diagram.

**Example:**
```typescript
// Source: adapted from TipTap custom Node docs + mermaid.render() API
// https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views
// https://mermaid.js.org/config/usage.html#using-mermaid-with-vue

import mermaid from 'mermaid'
import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import MermaidRenderer from './MermaidRenderer.vue'

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'sandbox',
})

export const MermaidNode = Node.create({
  name: 'mermaid',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      diagram: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-mermaid]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-mermaid': '' })]
  },

  addNodeView() {
    return VueNodeViewRenderer(MermaidRenderer)
  },
})
```

**Alternative (simpler, recommended for Phase N3):** Don't build a custom Node. Instead, extend the existing CodeBlockWithUi to detect `mermaid` language and render SVG in the code block preview area. This reuses the existing code block infrastructure and is lower risk.

### Pattern 3: Chart Composables with uPlot

**What:** A composable pattern for trend charts using uPlot. uPlot renders on Canvas (not SVG), which is ideal for performance with time series data but requires careful sizing and destruction lifecycle management.

**When to use:** TrendChart.vue component initialization and data updates.

**Example:**
```typescript
// Source: uplot-vue docs + uPlot API
// https://github.com/skalinichev/uplot-wrappers

// TrendChart.vue
<template>
  <div ref="chartContainer" class="trend-chart-container">
    <UplotVue
      v-if="chartData"
      :data="chartData"
      :options="chartOptions"
      :target="chartContainer"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import UplotVue from 'uplot-vue'
import 'uplot/dist/uPlot.min.css'
import { useTrends } from '../../composables/useTrends'

const { trendPoints, fetchTrends } = useTrends()

const chartOptions = {
  width: 600,
  height: 250,
  axes: [
    { label: '日期' },
    { label: '%', scale: '%', values: (u, vals) => vals.map(v => v + '%') },
  ],
  series: [
    {},
    { label: '掌握度', stroke: '#66ffe5', width: 2 },
    { label: '正确率', stroke: '#4caf50', width: 2 },
  ],
}

const chartData = computed(() => {
  if (!trendPoints.value.length) return null
  // uPlot expects [timestamps[], series1[], series2[]]
  const timestamps = trendPoints.value.map(p => p.date_epoch)
  const mastery = trendPoints.value.map(p => p.avg_mastery * 100)
  const accuracy = trendPoints.value.map(p => p.accuracy * 100)
  return [timestamps, mastery, accuracy]
})

onMounted(() => fetchTrends())
</script>
```

### Pattern 4: Calendar Heatmap (Custom SVG)

**What:** A custom Vue component rendering a GitHub-style contribution calendar (52 weeks x 7 days grid of colored cells). Each cell represents one day; color intensity reflects review count.

**When to use:** ReviewHeatmap.vue -- displays review consistency as a visual habit tracker.

**Example:**
```typescript
// Custom implementation (recommended over vue3-calendar-heatmap due to maintenance risk)
// Inspired by GitHub contribution graph layout

// ReviewHeatmap.vue
<template>
  <div class="heatmap">
    <div v-for="(week, wi) in weeks" :key="wi" class="heatmap-week">
      <div
        v-for="(day, di) in week"
        :key="di"
        class="heatmap-day"
        :style="{ backgroundColor: colorForCount(day.count) }"
        :title="day.date + ': ' + day.count + ' 次复习'"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { HeatmapDay } from '../../composables/useHeatmap'

const props = defineProps<{ days: HeatmapDay[] }>()

// Build 52-week x 7-day grid from array of {date, count}
const weeks = computed(() => {
  const now = new Date()
  const oneYearAgo = new Date(now)
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

  const dayMap = new Map(props.days.map(d => [d.date, d.count]))
  const result: { date: string; count: number }[][] = []
  const start = new Date(oneYearAgo)
  start.setDate(start.getDate() - start.getDay()) // align to Sunday

  for (let w = 0; w < 53; w++) {
    const week: { date: string; count: number }[] = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(start)
      date.setDate(date.getDate() + w * 7 + d)
      const dateStr = date.toISOString().slice(0, 10)
      week.push({ date: dateStr, count: dayMap.get(dateStr) || 0 })
    }
    result.push(week)
  }
  return result
})

function colorForCount(count: number): string {
  if (count === 0) return 'rgba(255,255,255,0.06)'
  if (count <= 2) return 'rgba(102,255,229,0.22)'
  if (count <= 5) return 'rgba(102,255,229,0.44)'
  if (count <= 10) return 'rgba(102,255,229,0.66)'
  return 'rgba(102,255,229,0.88)'
}
</script>
```

### Pattern 5: Keyboard Navigation

**What:** Add keyboard shortcuts and focus management across the app. Radix Vue components already handle their own keyboard navigation internally. Custom components (Knob, MarkdownEditor, QuizPanel, ReviewPanel) need explicit keyboard handlers.

**When to use:** Throughout the application.

**Example:**
```typescript
// In MainLayout.vue or a new useKeyboard composable:
// Global keyboard shortcuts:
//   Ctrl+E -> toggle editor focus
//   Ctrl+N -> create new child node
//   Escape -> cancel current operation / go back
//   Ctrl+Q -> start quiz
//   Ctrl+R -> start review

import { onMounted, onBeforeUnmount } from 'vue'
import { useNodeStore } from '../stores/nodeStore'

export function useKeyboard() {
  const store = useNodeStore()

  function handleKeydown(e: KeyboardEvent) {
    // Don't intercept when typing in editor
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
    if ((e.target as HTMLElement)?.closest('.ProseMirror')) return

    if (e.key === 'Escape') {
      e.preventDefault()
      if (store.isConfirmState) store.cancelOperation()
      else if (store.viewState !== 'display') store.cancelOperation()
      return
    }

    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault()
      if (store.viewState === 'display') store.startAdd()
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
}
```

### Anti-Patterns to Avoid
- **Hand-rolling a table editor:** The official `@tiptap/extension-table` handles column resize, row/col add/delete, keyboard navigation within tables, and HTML/Markdown serialization. Building a custom table would require 500+ lines and still miss edge cases.
- **Using ECharts for 2-3 simple line charts:** ECharts is ~300KB gzipped. uPlot is ~15KB. For trend lines and maybe a bar chart, uPlot is sufficient. Adding ECharts would double the frontend bundle.
- **Relying on `tiptap-extension-mermaid` (v0.0.0):** This community package is unmaintained (1 maintainer, no releases beyond 0.0.0). A custom extension using the mature `mermaid` library directly is more reliable.
- **Creating Pinia stores for stats/heatmap data:** The existing composable pattern (`useStats`, `useReview`) manages reactive state scoped to component instances. Stats and heatmap data don't need global state -- they're fetched on component mount and discarded on unmount.
- **Adding database tables for heatmap data:** The `quiz_records` table already has `answered_at` timestamps and `owner_id`. Daily counts can be derived via SQL `GROUP BY date(answered_at)`. Adding a denormalized heatmap table would create synchronization bugs.
- **Ignoring TipTap version alignment:** current `@tiptap/core` is 3.20.4 (deduped) but `starter-kit` is 3.15.3. The `@tiptap/markdown` extension at 3.20.4 expects a 3.20.x core API. Upgrading everything to 3.22.x in one pass prevents silent API mismatches.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Table editing in rich text | Custom ProseMirror table plugin | `@tiptap/extension-table` (official, v3.22.5) | Table editing is extremely complex: column resize, row/col add/delete, cell selection, keyboard navigation, copy/paste, HTML/Markdown serialization. The official extension handles all of this. |
| Markdown serialization | Custom ProseMirror Markdown serializer | `@tiptap/markdown` (already installed, v3.20.4) | Already used for content persistence. Provides `getMarkdown()` for export. Parsing Markdown edge cases (nested lists, links in headings, code fences with language) is error-prone work the library already solved. |
| PDF generation from HTML | Custom HTML-to-PDF rendering engine | `html2pdf.js` (v0.14.0) | PDF rendering involves page breaks, margins, font embedding, image handling, and CSS interpretation. html2pdf.js wraps jsPDF + html2canvas and handles cross-browser quirks. |
| Mermaid rendering engine | Custom diagram renderer | `mermaid` (v11.x) | Mermaid supports 10+ diagram types (flowchart, sequence, class, Gantt, etc.) with a text-based DSL. Building even a flowchart renderer would be a project in itself. |
| Calendar heatmap layout algorithm | Custom date math for 52-week grid | Simple Date arithmetic (built-in) | The layout is straightforward: align to Sunday, iterate 53 weeks x 7 days. No library needed for the grid itself. But don't build a generic heatmap framework -- just build the specific component. |
| Time series chart rendering | Custom Canvas/SVG chart engine | uPlot (v1.6.32) via uplot-vue | Chart rendering involves axis scaling, tick formatting, data mapping, tooltips, and responsive resize. uPlot handles all of this in 15KB. |
| HTML sanitization for export | Regex-based HTML cleaning | DOMPurify (already installed, v3.3.3) | Already used for paste sanitization. HTML sanitization via regex is famously impossible to get right (nested tags, script injection, attribute escaping). |

**Key insight:** The TipTap ecosystem provides official extensions for the most complex editor features (tables, task lists, markdown). Only mermaid requires a custom solution because no official extension exists. For charts and heatmaps, use libraries for the rendering engine (uPlot) but build custom Vue components for the specific layout and data binding -- no generic "dashboard framework" is needed.

## Runtime State Inventory

> Phase N3 is a UI enhancement phase with new backend endpoints but no rename/refactor/migration of existing systems. The closest to "runtime state" impact is the TipTap version upgrade.

**Stored data:** None affected. All existing SQLite tables (quiz_records, nodes, quiz_questions) remain unchanged. New backend endpoints are read-only queries -- no schema changes.

**Live service config:** None affected. No n8n workflows, Datadog configs, or external service registrations touch the features being modified.

**OS-registered state:** None affected. No Windows Task Scheduler, systemd, or pm2 entries reference TipTap extensions, chart libraries, or ARIA labels.

**Secrets/env vars:** None affected. No new env vars are required. Existing `SILICONFLOW_API_KEY` and `JWT_SECRET` are unchanged.

**Build artifacts:** The TipTap version upgrade (3.15.3/3.20.4 to 3.22.x) is a standard npm upgrade -- `npm install` handles all package.json and node_modules updates. No stale artifacts to clean.

**All 5 categories: Nothing found (UI enhancement phase with no rename/refactor/migration impact).**

## Common Pitfalls

### Pitfall 1: TipTap Version Incompatibility in Extension Mix

**What goes wrong:** The project has `@tiptap/core` at 3.20.4 (deduped) but `starter-kit` at 3.15.3. Adding `@tiptap/extension-table` at 3.22.5 with a mixed-version install causes silent rendering failures or import errors because internal ProseMirror APIs may differ between minor versions.

**Why it happens:** npm's deduplication picks the "newest compatible" version for shared dependencies. When starter-kit 3.15.3 depends on `@tiptap/core@^3.15.3` and new extensions depend on `^3.22.5`, npm may hoist one version of core and multiple copies of sub-extensions, causing duplicate ProseMirror plugin registrations.

**How to avoid:** Upgrade ALL TipTap packages to the same version (3.22.5) in a single `npm install` command BEFORE adding new extensions. Verify with `npm ls @tiptap/core` that only one version is installed.

**Warning signs:** Multiple versions of `@tiptap/core` in `npm ls` output. Console errors about "duplicate plugin" or "schema mismatch" when the editor loads.

### Pitfall 2: Mermaid Diagram Rendering Before DOM Ready

**What goes wrong:** `mermaid.render()` is called before the container element exists in the DOM, producing an empty diagram or a "Cannot read properties of undefined" error.

**Why it happens:** In Vue 3, `<script setup>` runs during component setup, but the DOM is not attached until after mount. If mermaid rendering is triggered in a watcher or computed that fires before `onMounted`, the target element is not yet in the DOM.

**How to avoid:** Always use `onMounted` or `nextTick` before calling `mermaid.render()`. For reactive diagram content, use `watch + nextTick`. Use unique diagram IDs to avoid conflicts when multiple mermaid blocks exist on the page.

**Warning signs:** Mermaid diagrams that render blank. Console error "Cannot read properties of null (reading 'innerHTML')". Diagrams that render only on hot reload but not on initial page load.

### Pitfall 3: uPlot Canvas Sizing Breaking with Tailwind CSS v4

**What goes wrong:** uPlot renders on a `<canvas>` element with explicit width/height attributes. If the container is styled with Tailwind utility classes that modify dimensions (e.g., `w-full`, `max-w-*`), the canvas may not resize correctly when the container changes size, causing blurry or cropped charts.

**Why it happens:** uPlot measures its container on initialization and sets canvas dimensions. CSS-driven resizes (responsive breakpoints, flex/grid layout changes) don't trigger uPlot's internal resize handler unless `debounce` and resize observer patterns are used.

**How to avoid:** Call `uplot.setSize({ width, height })` on window resize (debounced). Use a ResizeObserver on the chart container. Apply Tailwind sizing classes to the container `<div>`, not the uPlot target element.

**Warning signs:** Charts that look correct on first render but become cropped or stretched after window resize or switching to compact layout.

### Pitfall 4: Keyboard Shortcuts Interfering with TipTap Editor

**What goes wrong:** Global keyboard shortcuts (e.g., Escape to cancel, Ctrl+N to add node) fire when the user is typing in the TipTap editor, disrupting editing.

**Why it happens:** The keyboard event handler is registered on `window` and checks `event.target`. ProseMirror (TipTap's engine) renders inside a `<div class="ProseMirror">` which is `contentEditable`. Standard `input`/`textarea` checks don't catch `contentEditable` divs.

**How to avoid:** In the global keyboard handler, check `event.target.closest('.ProseMirror')` before executing any shortcut. Also check for open dialogs/modals (Naive UI modal, Radix popover).

**Warning signs:** Pressing Escape to close a dialog also cancels the current node operation. Ctrl+N creates a new node while the user is typing in the editor.

### Pitfall 5: Export Content Including Unsanitized User Input

**What goes wrong:** `editor.getHTML()` returns the raw HTML including any malicious content that was pasted or typed. If exported HTML is opened in another browser context, scripts or event handlers could execute.

**Why it happens:** TipTap stores the ProseMirror document model, which does not include inline scripts or event handlers (they're stripped during parsing). However, exported HTML may include attributes that survived TipTap's internal schema. DOMPurify is used during paste but the exported HTML bypasses it.

**How to avoid:** Run exported HTML through `DOMPurify.sanitize()` before creating the download blob. The existing `sanitizeMarkdownSource()` function in MarkdownEditor.vue already provides a pattern -- extend it for export.

**Warning signs:** Exported HTML files that contain `onerror=`, `onload=`, or `javascript:` protocol handlers. Markdown export is generally safe but HTML and PDF exports need sanitization.

## Code Examples

Verified patterns from official sources:

### TipTap TableKit Setup
```typescript
// Source: https://tiptap.dev/docs/editor/extensions/nodes/table
// Official TipTap v3 table extension (consolidated package)

import { TableKit } from '@tiptap/extension-table'

// Add to editor extensions:
TableKit.configure({
  resizable: true,
  // Optional: constrain table width to editor
  // HTMLAttributes: { class: 'editor-table' },
})
```

### TipTap TaskList Setup
```typescript
// Source: https://tiptap.dev/docs/editor/extensions/nodes/task-item
// Official TipTap v3 task list (included in @tiptap/extension-list)

import { TaskList, TaskItem } from '@tiptap/extension-list'

TaskList,
TaskItem.configure({
  nested: true,
  // onReadOnlyChecked: false, // allow toggling even in read-only mode
})
```

### Markdown Export (Already Available)
```typescript
// Source: @tiptap/markdown (already installed)
// The editor already uses instance.getMarkdown() for auto-save.
// For export, the same method produces downloadable content.

function exportMarkdown(): void {
  if (!editor.value) return
  const md = editor.value.getMarkdown()
  const blob = new Blob([md], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${activeNode.value?.name ?? 'document'}.md`
  a.click()
  URL.revokeObjectURL(url)
}
```

### HTML Export (Built-in)
```typescript
// Source: TipTap core -- editor.getHTML() is always available
function exportHTML(): void {
  if (!editor.value) return
  const raw = editor.value.getHTML()
  const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
  const fullDoc = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>${activeNode.value?.name ?? 'Document'}</title></head>
<body>${clean}</body>
</html>`
  const blob = new Blob([fullDoc], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${activeNode.value?.name ?? 'document'}.html`
  a.click()
  URL.revokeObjectURL(url)
}
```

### PDF Export via html2pdf.js
```typescript
// Source: https://github.com/eKoopmans/html2pdf.js
import html2pdf from 'html2pdf.js'
import DOMPurify from 'dompurify'

function exportPDF(): void {
  if (!editor.value) return
  const rawHTML = editor.value.getHTML()
  const cleanHTML = DOMPurify.sanitize(rawHTML, { USE_PROFILES: { html: true } })
  const element = document.createElement('div')
  element.innerHTML = cleanHTML

  const opt = {
    margin: [10, 10, 10, 10], // top, right, bottom, left (mm)
    filename: `${activeNode.value?.name ?? 'document'}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  }
  html2pdf().set(opt).from(element).save()
}
```

### Mermaid Rendering Composable
```typescript
// Source: https://mermaid.js.org/config/usage.html#using-mermaid-with-vue
import mermaid from 'mermaid'
import { ref } from 'vue'

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'sandbox',
})

export function useMermaid() {
  const svg = ref('')
  let counter = 0

  async function render(diagram: string): Promise<string> {
    const id = `mermaid-${++counter}-${Math.random().toString(36).slice(2, 8)}`
    try {
      const { svg: result } = await mermaid.render(id, diagram)
      return result
    } catch (err) {
      console.error('Mermaid render error:', err)
      return `<div class="mermaid-error">图表渲染失败</div>`
    }
  }

  return { svg, render }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No table editing | `@tiptap/extension-table` v3.22.5 with TableKit | Phase N3 | Users can create/edit tables with resize, row/col management |
| No task lists | `@tiptap/extension-list` TaskList + TaskItem (already present but unused) | Phase N3 | Enable checkbox task lists in editor |
| No diagram support | Custom Mermaid rendering (extending CodeBlockWithUi or custom Node) | Phase N3 | Users can create flowcharts, sequence diagrams via text |
| No export | `editor.getMarkdown()` / `editor.getHTML()` + html2pdf.js | Phase N3 | MD/HTML/PDF export from editor content |
| No trend charts | uPlot line charts via uplot-vue | Phase N3 | Visual trend of mastery and accuracy over time |
| No domain heatmap | Custom SVG heatmap grid component | Phase N3 | Visual overview of per-domain knowledge strength |
| No review calendar | Custom SVG calendar heatmap component | Phase N3 | GitHub-style review consistency tracker |
| Minimal ARIA support (~17 occurrences) | Radix Vue built-in ARIA + explicit labels on custom components | Phase N3 | WAI-ARIA compliance for screen readers, keyboard nav |
| TipTap 3.15.3/3.20.4 mixed versions | Unified 3.22.x across all @tiptap packages | Phase N3 | Prevention of duplicate ProseMirror plugin registration |

**Deprecated/outdated:**
- **tiptap-extension-mermaid (v0.0.0):** Effectively dead package. Use custom Node extension with `mermaid` library directly.
- **vue3-calendar-heatmap (v2.0.5, last updated ~3 years ago):** Evaluate before adopting. If it works as-is, use it. If not, custom SVG heatmap (~100 lines) is more maintainable than forking an unmaintained package.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | uPlot (15KB) is sufficient for the two chart types needed (trend line chart, maybe bar chart). No pie/radar/3D charts are required. | Standard Stack / Charting | Low: Stats dashboard needs time series (mastery over time, accuracy trend) and domain heatmap. If the user wants additional chart types later, uPlot can be supplemented with a custom component or vue-chartjs can be swapped in. |
| A2 | The custom calendar heatmap (~100 lines SVG) is preferable to vue3-calendar-heatmap (unmaintained). | Standard Stack / Heatmap | Low: The calendar heatmap layout is a well-known algorithm (53 weeks x 7 days, color-by-count). A custom implementation gives full control over styling, i18n, and tooltip content without depending on an unmaintained package. |
| A3 | Mermaid diagram rendering should extend the existing CodeBlockWithUi rather than creating a separate Node extension. | Architecture Patterns / Mermaid | Medium: If users expect to edit mermaid code and see live preview (like a dedicated mermaid editor), a separate Node extension would be better. However, the code-block-based approach is simpler and reuses existing UI infrastructure. |
| A4 | Two new backend endpoints (`/quiz-trends`, `/review-heatmap`) are sufficient. No new database tables needed. | Architecture Patterns / API | Low: The quiz_records table already has `answered_at`, `owner_id`, `is_correct`, and `node_id` (joinable to nodes.domain_tag). Daily aggregations via `GROUP BY date(answered_at)` and per-domain accuracy via `JOIN nodes ON quiz_records.node_id = nodes.id GROUP BY nodes.domain_tag` provide all data needed for trends, heatmap, and domain breakdown. |
| A5 | TipTap version upgrade to 3.22.x across all packages is safe and non-breaking for existing extensions. | Common Pitfalls | Medium: Minor version bumps (3.15.3 -> 3.22.x) within v3 should be API-compatible, but ProseMirror internals may have subtle changes. Mitigation: run the editor smoke test after upgrade (load a node, edit content, verify save). |
| A6 | The project's single-uvicorn-worker deployment means chart and heatmap data aggregation queries are fast enough for synchronous SQLite (no async needed). | Architecture Patterns / Performance | Low: Quiz data is per-user, and typical user has hundreds to low thousands of quiz records. SQLite aggregation queries on this scale complete in < 10ms. If a user has 100,000+ records, pagination or date-range limits can be added later. |
| A7 | ARIA labels and keyboard shortcuts don't require a third-party accessibility library beyond Radix Vue's built-in support. | Architecture Patterns / Accessibility | Low: The app has a limited set of interactive components. Radix Vue covers dialog, popover, and toggle accessibility. The remaining components (Knob, MarkdownEditor, QuizPanel) need targeted `aria-label` attributes and keyboard handlers -- no framework needed. |
| A8 | The `@tiptap/markdown` extension (already installed at 3.20.4) handles table, task list, and code block serialization correctly in its bundled Markdown parser/serializer. | Standard Stack / Editor | Medium: Task lists use the `- [ ]` syntax in Markdown. Tables use pipe syntax. Mermaid uses fenced code blocks with `mermaid` language. All are standard Markdown constructs. If @tiptap/markdown has incomplete table serialization, the `tiptap-markdown-3` community package provides a fallback. |

## Open Questions

1. **Export toolbar placement**
   - What we know: The editor currently has no toolbar. The `Knob` provides context-sensitive actions. `EditorToolbar.vue` is a new proposed component.
   - What's unclear: Whether export buttons should be in a floating toolbar above the editor, integrated into the Knob long-press menu, or added to a sidebar.
   - Recommendation: Add a minimal floating toolbar (positioned above the editor content area) with three icon buttons: Download Markdown, Download HTML, Download PDF. Keeps Knob responsibilities unchanged.

2. **Domain heatmap design**
   - What we know: `domain_tag` is set by `tag_service_sqlite.py` via keyword matching. Domain accuracy can be computed by `JOIN quiz_records ON quiz_questions.node_id = nodes.id GROUP BY nodes.domain_tag`.
   - What's unclear: How many domains exist per user, what visual layout works for 0-15 domains, whether the heatmap should be a grid (domains x metrics) or a horizontal bar chart.
   - Recommendation: Start with a horizontal stacked bar chart per domain showing correct/wrong/total counts, colored by a green-to-red gradient. This handles 1-20 domains gracefully. The grid heatmap format is a stretch goal.

3. **Mermaid integration approach**
   - What we know: The existing `CodeBlockWithUi` custom extension renders code blocks with syntax highlighting and a copy button. Mermaid diagrams could be rendered within the same code block UI when language = `mermaid`.
   - What's unclear: Whether users expect a live-preview side panel (code on left, diagram on right) or inline rendering (code block transforms to diagram on blur).
   - Recommendation: Inline rendering on blur/click -- code block shows mermaid source with a "Preview" toggle button. When previewed, the SVG replaces the highlighted code. User can click "Edit" to return to source. This avoids layout complexity and reuses the existing `CodeBlockWithUi` architecture.

4. **Heatmap data retention period**
   - What we know: `quiz_records.answered_at` is stored with full datetime precision. Backend can query any date range.
   - What's unclear: Whether to show the last 3 months, 6 months, or 1 year of review data in the heatmap. The GitHub contribution graph shows 1 year.
   - Recommendation: Show 1 year (52 weeks) by default, matching the GitHub contribution graph convention. Add a dropdown to switch to "All time" if the user has less than 1 year of data.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Frontend npm install | Yes | v22.13.0 | -- |
| npm | Package installation | Yes | 10.9.2 | -- |
| Python | Backend | Yes | 3.12.3 | -- |
| pip | Python packages | Yes | (bundled) | -- |
| @tiptap/extension-table (npm) | Table editing | Needs install | 3.22.5 (npm registry) | -- |
| @tiptap/extension-list (npm) | Task list (upgrade) | Already installed (3.15.3) | 3.22.5 (upgrade needed) | -- |
| uplot + uplot-vue (npm) | Trend charts | Needs install | 1.6.32 / 1.2.4 | Build custom Canvas chart (~200 lines) if uPlot integration fails |
| html2pdf.js (npm) | PDF export | Needs install | 0.14.0 | window.print() for basic PDF |
| mermaid (npm) | Diagram rendering | Needs install | ^11.x | Skip mermaid feature if installation fails |
| vue3-calendar-heatmap (npm) | Calendar heatmap | Needs install | 2.0.5 | Custom SVG heatmap (~100 lines Vue component) -- available as fallback |
| SQLite (quiz_records table) | Heatmap/trend data | Already exists | N/A (stdlib) | -- |

**Missing dependencies with no fallback:** None. All core dependencies have fallbacks.

**Missing dependencies with fallback:**
- vue3-calendar-heatmap: Custom SVG heatmap as fallback (recommended primary approach anyway)
- uplot + uplot-vue: Custom Canvas chart as fallback

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 (frontend) + pytest 9.0.3 (backend) |
| Config file | none -- vitest auto-resolves from vite.config.ts; need nodeStore.spec.ts pattern for new store tests |
| Quick run command | `cd frontend && npx vitest run related src/components/editor/ src/components/stats/` |
| Full suite command | `cd frontend && npm test && cd ../backend && pytest tests/` |

### Phase Requirements to Test Map

Phase N3 has no formal requirements in REQUIREMENTS.md (CEO Plan phases are defined by goal + success criteria). The following derived requirement IDs are used for traceability:

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UP-01 | TableKit extension renders in TipTap editor; user can insert table with 3x3 cells | unit (Vitest) | `npx vitest run src/components/editor/MarkdownEditor.spec.ts -t "table"` | No (Wave 0) |
| UP-02 | TaskList renders checkboxes; clicking toggles checked state | unit (Vitest) | `npx vitest run src/components/editor/MarkdownEditor.spec.ts -t "task"` | No (Wave 0) |
| UP-03 | Mermaid code block renders SVG diagram on preview toggle | unit (Vitest) | `npx vitest run src/components/editor/MarkdownEditor.spec.ts -t "mermaid"` | No (Wave 0) |
| UP-04 | Export Markdown produces valid .md file with correct content | unit (Vitest) | `npx vitest run src/components/editor/MarkdownEditor.spec.ts -t "export markdown"` | No (Wave 0) |
| UP-05 | Export HTML produces valid .html file with sanitized content | unit (Vitest) | `npx vitest run src/components/editor/MarkdownEditor.spec.ts -t "export html"` | No (Wave 0) |
| UP-06 | Export PDF triggers download (mock html2pdf.js) | unit (Vitest) | `npx vitest run src/components/editor/MarkdownEditor.spec.ts -t "export pdf"` | No (Wave 0) |
| UP-07 | /quiz-trends endpoint returns daily mastery + accuracy arrays for last 30 days | integration (pytest) | `pytest tests/test_quiz_stats_api.py::test_quiz_trends -x` | No (Wave 0) |
| UP-08 | /review-heatmap endpoint returns daily review count for last 365 days | integration (pytest) | `pytest tests/test_review_api.py::test_review_heatmap -x` | No (Wave 0) |
| UP-09 | TrendChart renders uPlot line chart with correct data points | unit (Vitest) | `npx vitest run src/components/stats/TrendChart.spec.ts` | No (Wave 0) |
| UP-10 | ReviewHeatmap renders 52-week x 7-day grid with correct color intensity | unit (Vitest) | `npx vitest run src/components/stats/ReviewHeatmap.spec.ts` | No (Wave 0) |
| UP-11 | DomainHeatmap renders domain performance bars with correct values | unit (Vitest) | `npx vitest run src/components/stats/DomainHeatmap.spec.ts` | No (Wave 0) |
| UP-12 | ARIA labels present on Knob, MarkdownEditor, QuizPanel, ReviewPanel, StatsPanel | accessibility (manual + axe-core) | `npx vitest run src/components/**/*.spec.ts -t "aria"` or axe-core audit | No (Wave 0) |
| UP-13 | Keyboard shortcut Escape cancels current operation (when not in editor) | unit (Vitest) | `npx vitest run src/composables/useKeyboard.spec.ts` | No (Wave 0) |
| UP-14 | Keyboard shortcut Ctrl+N starts add-child operation | unit (Vitest) | `npx vitest run src/composables/useKeyboard.spec.ts` | No (Wave 0) |
| UP-15 | TipTap version alignment: all @tiptap/* packages at 3.22.x | manual/smoke | `npm ls @tiptap/core` shows single version | Manual check after install |

### Sampling Rate
- **Per task commit:** `cd frontend && npx vitest run --reporter=verbose` (unit tests for modified component)
- **Per wave merge:** `cd frontend && npm test && cd ../backend && pytest tests/ -v` (full frontend + backend suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `frontend/src/components/editor/MarkdownEditor.spec.ts` -- covers UP-01 through UP-06 (no component tests exist currently for MarkdownEditor)
- [ ] `frontend/src/components/stats/TrendChart.spec.ts` -- covers UP-09
- [ ] `frontend/src/components/stats/ReviewHeatmap.spec.ts` -- covers UP-10
- [ ] `frontend/src/components/stats/DomainHeatmap.spec.ts` -- covers UP-11
- [ ] `frontend/src/composables/useKeyboard.spec.ts` -- covers UP-13, UP-14
- [ ] `backend/tests/test_quiz_stats_api.py` -- covers UP-07 (new file)
- [ ] `backend/tests/test_review_api.py` -- covers UP-08 (new file)
- [ ] `frontend/src/composables/useTrends.spec.ts` -- composable unit test
- [ ] `frontend/src/composables/useHeatmap.spec.ts` -- composable unit test
- [ ] `frontend/vitest.config.ts` -- may need explicit config for component mount tests with TipTap (TipTap requires DOM environment, happy-dom may need configuration for contentEditable support)
- [ ] `backend/pytest.ini` -- verify `pythonpath = .` is set (known issue from Phase N1 research)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Phase does not modify authentication. |
| V3 Session Management | No | Phase does not modify session management. |
| V4 Access Control | Yes (indirect) | New `/quiz-trends` and `/review-heatmap` endpoints must use `get_current_user` dependency (ASVS 4.1.1). Existing pattern already enforces this -- all endpoints require JWT. |
| V5 Input Validation | Yes | Export filenames derived from `activeNode?.name` could contain path traversal characters. Sanitize node names when generating download filenames (ASVS 5.3.8). Date range query parameters on new endpoints must be validated. |
| V6 Cryptography | No | Phase does not introduce new cryptographic operations. |
| V7 Error Handling | Yes | New backend endpoints must follow existing error handling pattern (try/except with HTTPException). Chart rendering failures on the frontend should show user-friendly fallback text, not raw error stacks (ASVS 7.4.1). |
| V8 Data Protection | Yes | Heatmap and trend data expose user review history. Both endpoints require valid JWT (existing `get_current_user` dependency). No new sensitive data is stored -- all queries are read-only on existing tables. |

### Known Threat Patterns for TipTap + uPlot + SQLite

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via exported HTML content | Information Disclosure | Run `editor.getHTML()` output through DOMPurify before download. The editor already sanitizes pasted HTML; export is an additional path that bypasses paste sanitization. |
| Path traversal in export filename | Tampering | Strip `/`, `\`, `..`, and `:` from `activeNode.name` when constructing download filenames: `name.replace(/[/\\:*?"<>|]/g, '_')`. |
| Mermaid diagram XSS via malicious diagram source | Information Disclosure | Configure mermaid with `securityLevel: 'sandbox'`. This prevents script injection in SVG output. Users could still create misleading diagrams, but cannot execute arbitrary JS. |
| SQL injection in date range queries | Tampering | Use parameterized queries (`?` placeholders) for date range parameters on new `/quiz-trends` and `/review-heatmap` endpoints. Never concatenate user input into SQL strings. |
| Data leakage via missing access control on stats endpoints | Information Disclosure | Both new endpoints must include `WHERE owner_id = ?` clause (ASVS 4.1.2). The existing `get_current_user` dependency provides `user["sub"]` which maps to `owner_id`. |
| Canvas fingerprinting via uPlot (theoretical) | Privacy | uPlot renders on Canvas, which can be used for browser fingerprinting. This is intrinsic to all Canvas-based charting and is not unique to uPlot. Not a practical concern for a self-hosted knowledge management app. |

## Sources

### Primary (HIGH confidence)
- [@tiptap/extension-table npm](https://www.npmjs.com/package/@tiptap/extension-table) -- Version 3.22.5 confirmed; v3 consolidated package with TableKit
- [@tiptap/extension-list npm](https://www.npmjs.com/package/@tiptap/extension-list) -- Version 3.22.5 confirmed; includes TaskList + TaskItem in v3
- [TipTap Table Docs](https://tiptap.dev/docs/editor/extensions/nodes/table) -- Official table extension documentation
- [TipTap Task List Docs](https://tiptap.dev/docs/editor/extensions/nodes/task-item) -- Official task list extension documentation
- [TipTap Export PDF Docs](https://tiptap.dev/docs/conversion/export/pdf/editor-export) -- Official Tiptap Pro PDF export (reference only; using html2pdf.js instead)
- [uPlot GitHub](https://github.com/leeoniya/uPlot) -- Time series charting library, v1.6.32
- [uplot-vue npm](https://www.npmjs.com/package/uplot-vue) -- Vue 3 wrapper for uPlot, v1.2.4
- [html2pdf.js GitHub](https://github.com/eKoopmans/html2pdf.js) -- Client-side PDF generation, v0.14.0
- [Mermaid.js Documentation](https://mermaid.js.org/config/usage.html) -- Official mermaid rendering API
- [Radix Vue Accessibility](https://www.radix-vue.com/overview/accessibility) -- Official Radix Vue accessibility documentation
- [Starlette Pure ASGI Middleware](https://www.starlette.io/middleware/#pure-asgi-middleware) -- Reference for backend middleware pattern (not used but referenced)
- Project source files: `frontend/src/components/editor/MarkdownEditor.vue`, `frontend/src/components/stats/StatsPanel.vue`, `frontend/src/components/review/ReviewPanel.vue`, `backend/database.py`, `backend/quiz_service_sqlite.py`, `backend/review_service_sqlite.py`, `frontend/package.json` -- Verified line numbers, existing code patterns, installed dependencies
- `npm ls @tiptap/core` output -- Verified current TipTap version mix (core 3.20.4, starter-kit 3.15.3)

### Secondary (MEDIUM confidence)
- [tiptap-markdown npm](https://www.npmjs.com/package/tiptap-markdown) -- Community Markdown serialization for TipTap v2; relevant as context for v3 built-in support
- [vue3-calendar-heatmap npm](https://www.npmjs.com/package/vue3-calendar-heatmap) -- v2.0.5, last updated ~2023; evaluated for heatmap component
- [Heat.js](https://reactlibs.dev/articles/every-day-counts-heat-js/) -- Framework-agnostic heatmap library; evaluated as alternative
- [Naive UI ARIA optimization blog](https://blog.gitcode.com/f5a71c6d3bd994818e7507ef76d70025.html) -- Community article about Naive UI ARIA issues and fixes

### Tertiary (LOW confidence)
- [tiptap-extension-mermaid npm](https://www.npmjs.com/package/tiptap-extension-mermaid) -- Community mermaid extension v0.0.0; evaluated and rejected as unmaintained
- [Vue Data UI article](https://blog.csdn.net/luck332/article/details/148133923) -- Chinese blog post about Vue Data UI; informational only, not primary recommendation
- [CSDN Mermaid Vue 3 integration](https://bbs.huaweicloud.com/blogs/447106) -- Community tutorial for mermaid in Vue 3

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All TipTap extension versions verified against npm registry. uPlot, uplot-vue, html2pdf.js versions confirmed. Mermaid rendering approach verified against official docs. Calendar heatmap decision is MEDIUM confidence (custom vs package choice).
- Architecture: HIGH -- TipTap extension pattern verified against official docs and existing project patterns. uPlot integration pattern verified against uplot-vue docs. Backend endpoint design follows existing main.py patterns. No database schema changes needed -- verified by inspecting quiz_records table structure.
- Pitfalls: MEDIUM-HIGH -- Pitfalls 1-3 are well-documented issues from the TipTap, mermaid, and uPlot communities. Pitfall 4 (keyboard-TipTap interference) is specific to this project's design. Pitfall 5 (export sanitization) is based on standard XSS prevention patterns.
- Accessibility: MEDIUM -- ARIA recommendations based on Radix Vue official accessibility docs. Current ARIA usage confirmed by grep audit (17 occurrences). Keyboard shortcut design is custom and needs user validation.
- Security: HIGH -- ASVS mappings verified against ASVS 4.0 standard. Export sanitization, parameterized queries, and access control patterns follow existing project conventions.

**Research date:** 2026-04-30
**Valid until:** 2026-05-30 (30 days -- stable frontend libraries; TipTap, uPlot, and mermaid have stable APIs)
