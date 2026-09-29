import type { Editor, JSONContent } from '@tiptap/core'

export function stripUnknownNodes(json: JSONContent, schema: Editor['schema']): JSONContent | null {
  if (!json || typeof json !== 'object') return null;
  if (!json.type) return json;

  if (!schema.nodes[json.type]) {
    if (Array.isArray(json.content) && json.content.length > 0) {
      const strippedChildren = json.content
        .map(c => stripUnknownNodes(c, schema))
        .filter((c): c is JSONContent => c !== null);

      if (strippedChildren.length === 0) return null;

      // Only wrap in paragraph if all children are inline nodes.
      // Block children inside a paragraph would fail schema validation.
      const allInline = strippedChildren.every(
        c => c && typeof c === 'object' && c.type && INLINE_NODE_TYPES.has(c.type),
      );
      if (allInline) {
        return { type: 'paragraph', content: strippedChildren };
      }
      // Unknown node with block children — drop it to avoid invalid structure
      return null;
    }
    if (typeof json.text === 'string' && json.text) {
      return { type: 'text', text: json.text };
    }
    return null;
  }

  const cleaned: JSONContent = { ...json };
  if (Array.isArray(cleaned.content)) {
    cleaned.content = cleaned.content
      .map(c => stripUnknownNodes(c, schema))
      .filter((c): c is JSONContent => c !== null);
  }
  return cleaned;
}
/** Inline node types that should be wrapped in a paragraph inside block containers. */
const INLINE_NODE_TYPES = new Set(['text', 'hardBreak', 'inlineMath', 'mention']);

/** Inline containers whose content must stay inline-only; block children break schema.check(). */
const INLINE_CONTAINER_TYPES = new Set(['paragraph', 'heading']);

/** Block nodes whose content model requires paragraphs, not raw inline nodes. */
const BLOCK_WRAPPER_TYPES = new Set(['listItem', 'blockquote', 'doc']);

/**
 * Wrap bare inline nodes (text, hardBreak, etc.) in paragraphs inside
 * block containers (listItem, blockquote) that require paragraph children.
 */
export function wrapBareInlineContent(json: JSONContent): JSONContent {
  if (!json || typeof json !== 'object') return json;

  const result: JSONContent = { ...json };

  if (Array.isArray(result.content)) {
    // Check if this is a block node whose children are all inline nodes
    if (BLOCK_WRAPPER_TYPES.has(result.type ?? '') && result.content.length > 0) {
      const needsParagraph = result.content.some(
        c => c && typeof c === 'object' && c.type && INLINE_NODE_TYPES.has(c.type),
      );
      if (needsParagraph) {
        // Group inline children into paragraph-wrapped segments,
        // keeping existing block children (like nested lists) as-is
        const groups: JSONContent[][] = [];
        let currentInline: JSONContent[] = [];

        for (const child of result.content) {
          if (child && typeof child === 'object' && child.type && INLINE_NODE_TYPES.has(child.type)) {
            currentInline.push(wrapBareInlineContent(child));
          } else {
            if (currentInline.length > 0) {
              groups.push(currentInline);
              currentInline = [];
            }
            groups.push([wrapBareInlineContent(child)]);
          }
        }
        if (currentInline.length > 0) {
          groups.push(currentInline);
        }

        result.content = groups.map(group => {
          // If the group starts with a block node, keep it as-is
          if (group.length === 1 && group[0]?.type && !INLINE_NODE_TYPES.has(group[0].type)) {
            return group[0];
          }
          return { type: 'paragraph', content: group };
        });
      } else {
        result.content = result.content.map(c => wrapBareInlineContent(c));
      }
    } else {
      result.content = result.content.map(c => wrapBareInlineContent(c));
    }
  }

  return result;
}

export function sanitizeMarkdownSource(content: string): string {
  return content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, ' $1="#"');
}

const CODE_REGION_PLACEHOLDER = '\x00CR';

function maskFencedBlocks(text: string, push: (region: string) => string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let fence: { char: string; len: number; lines: string[] } | null = null;

  for (const line of lines) {
    if (fence) {
      fence.lines.push(line);
      const closing = new RegExp(`^ {0,3}\\${fence.char}{${fence.len},}\\s*$`);
      if (closing.test(line)) {
        out.push(push(fence.lines.join('\n')));
        fence = null;
      }
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (opening) {
      const run = opening[1] ?? '`';
      fence = { char: run[0] ?? '`', len: run.length, lines: [line] };
      continue;
    }
    out.push(line);
  }
  // Unterminated fence: masked to the end of the text, like marked parses it.
  if (fence) out.push(push(fence.lines.join('\n')));
  return out.join('\n');
}

function maskCodeSpansAndAutolinks(text: string, push: (region: string) => string): string {
  let out = '';
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    if (ch === '`') {
      let runEnd = i;
      while (runEnd < n && text[runEnd] === '`') runEnd += 1;
      const runLen = runEnd - i;

      // A span of N backticks closes at the next run of exactly N backticks.
      let close = -1;
      for (let k = runEnd; k < n; ) {
        if (text[k] === '`') {
          let runStart = k;
          while (k < n && text[k] === '`') k += 1;
          if (k - runStart === runLen) {
            close = runStart;
            break;
          }
        } else {
          k += 1;
        }
      }

      if (close !== -1) {
        const spanEnd = close + runLen;
        out += push(text.slice(i, spanEnd));
        i = spanEnd;
      } else {
        out += text.slice(i, runEnd);
        i = runEnd;
      }
      continue;
    }
    if (ch === '<') {
      const rest = text.slice(i);
      const autolink = /^<[A-Za-z][A-Za-z0-9+.-]*:\/\/[^<>\s]*>/.exec(rest);
      if (autolink) {
        out += push(autolink[0]);
        i += autolink[0].length;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Mask regions whose text must reach the markdown parser verbatim: fenced
 * code blocks, inline code spans, and <scheme://...> autolinks. Callers
 * rewrite the protected string (e.g. escape angle brackets) and run restore()
 * afterwards, so `<` inside code is never rewritten to &lt;.
 */
export function maskCodeRegions(text: string): { protected: string; restore: (s: string) => string } {
  const regions: string[] = [];
  const push = (region: string): string => {
    regions.push(region);
    return `${CODE_REGION_PLACEHOLDER}${regions.length - 1}\x00`;
  };

  const withoutFences = maskFencedBlocks(text, push);
  const withoutSpans = maskCodeSpansAndAutolinks(withoutFences, push);

  return {
    protected: withoutSpans,
    restore: (s: string) => s.replace(/\x00CR(\d+)\x00/g, (_m, i) => regions[parseInt(i, 10)] ?? ''),
  };
}

function trimEdgeHardBreaks(nodes: JSONContent[]): JSONContent[] {
  let start = 0;
  let end = nodes.length;
  while (start < end && nodes[start]?.type === 'hardBreak') start += 1;
  while (end > start && nodes[end - 1]?.type === 'hardBreak') end -= 1;
  return nodes.slice(start, end);
}

/**
 * Split a paragraph/heading whose content contains block-level nodes (marked
 * tokenizes a standalone image line as an inline token inside a paragraph,
 * but the image node is block-level, which fails schema.check() and discards
 * the whole parse). Inline runs keep the original node's type and attrs; the
 * block nodes become siblings at the same position.
 */
function splitInlineContainerAroundBlocks(node: JSONContent, schema: Editor['schema']): JSONContent[] {
  const content = Array.isArray(node.content) ? node.content : [];
  const hasBlockChild = content.some(
    c => c?.type && schema.nodes[c.type]?.isInline === false,
  );
  if (!hasBlockChild) return [node];

  const pieces: JSONContent[] = [];
  let inlineRun: JSONContent[] = [];

  const flushRun = (): void => {
    const trimmed = trimEdgeHardBreaks(inlineRun);
    inlineRun = [];
    if (trimmed.length === 0) return;
    // Spread the node so attrs (heading level, locked attr) carry over.
    pieces.push({ ...node, content: trimmed });
  };

  for (const child of content) {
    if (child?.type && schema.nodes[child.type]?.isInline === false) {
      flushRun();
      pieces.push(child);
    } else {
      inlineRun.push(child);
    }
  }
  flushRun();
  return pieces;
}

/**
 * Recursively lift block-level nodes out of inline containers (paragraph,
 * heading) so the document passes schema validation.
 */
export function liftBlockNodesFromInlineContainers(json: JSONContent, schema: Editor['schema']): JSONContent {
  if (!json || typeof json !== 'object') return json;

  const result: JSONContent = { ...json };
  if (Array.isArray(result.content)) {
    result.content = result.content.flatMap(child => {
      if (!child || typeof child !== 'object') return [child];
      if (INLINE_CONTAINER_TYPES.has(child.type ?? '') && Array.isArray(child.content)) {
        return splitInlineContainerAroundBlocks(child, schema);
      }
      return [liftBlockNodesFromInlineContainers(child, schema)];
    });
  }
  return result;
}

export function normalizePastedText(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/[​-‍﻿]/g, '')
    .replace(/ /g, ' ');
}

export function buildPlainTextDoc(content: string): JSONContent {
  const normalized = normalizePastedText(content);
  if (!normalized) {
    return {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };
  }

  const lines = normalized.split('\n');
  const paragraphContent: JSONContent[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.length > 0) {
      paragraphContent.push({
        type: 'text',
        text: line,
      });
    }
    if (index < lines.length - 1) {
      paragraphContent.push({ type: 'hardBreak' });
    }
  }

  return {
    type: 'doc',
    content: [
      paragraphContent.length > 0
        ? {
            type: 'paragraph',
            content: paragraphContent,
          }
        : {
            type: 'paragraph',
          },
    ],
  };
}
