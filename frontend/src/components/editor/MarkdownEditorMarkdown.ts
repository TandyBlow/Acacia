import type { Editor, JSONContent } from '@tiptap/core'
import type { MarkdownManager } from '@tiptap/markdown'
import { marked } from 'marked'
import { liftBlockNodesFromInlineContainers, maskCodeRegions, stripUnknownNodes, wrapBareInlineContent } from './MarkdownEditorMarkdownUtil'

export function getMarkdownManager(instance: Editor): MarkdownManager | null {
  return instance.markdown ?? instance.storage?.markdown?.manager ?? null;
}
function protectMathHtmlTags(text: string): { protected: string; restore: (s: string) => string } {
  const tags: string[] = [];
  const PROTECTED = '\x00MPH';
  let idx = 0;
  // Match both inline (<span data-type="inline-math"...) and block (<div data-type="block-math"...)
  const pattern = /<(span|div)\s+data-type="(?:inline|block)-math"[^>]*><\/(span|div)>/gi;
  const processed = text.replace(pattern, (match) => {
    const placeholder = `${PROTECTED}${idx}\x00`;
    tags.push(match);
    idx++;
    return placeholder;
  });
  return {
    protected: processed,
    restore: (s: string) => s.replace(/\x00MPH(\d+)\x00/g, (_m, i) => tags[parseInt(i)] ?? ''),
  };
}

/**
 * Escape the angle brackets that marked would tokenize as HTML tags, so
 * content like <b> or <img ...> stays literal text instead of becoming
 * invalid nodes. A bare `<` in prose (e.g. "a < b", "<中文>") is not
 * tag-shaped for marked and round-trips as-is — escaping it would persist
 * "&lt;" into the saved content.
 * Fenced code blocks, inline code spans and <scheme://...> autolinks keep
 * their brackets untouched (maskCodeRegions), and math HTML tags are
 * protected as before.
 */
function escapeNonHtmlAngleBrackets(text: string): string {
  const code = maskCodeRegions(text);
  const mathTags = protectMathHtmlTags(code.protected);
  const escaped = mathTags.protected.replace(/<(?=[A-Za-z!/?])/g, '&lt;');
  return code.restore(mathTags.restore(escaped));
}
/** marked block token type → TipTap node type at doc top level. */
const BLOCK_TOKEN_NODE_TYPES: Record<string, string> = {
  heading: 'heading',
  paragraph: 'paragraph',
  // marked's block-level fallback for content it cannot classify.
  text: 'paragraph',
  html: 'paragraph',
  code: 'codeBlock',
  blockquote: 'blockquote',
  hr: 'horizontalRule',
  table: 'table',
};

function expectedNodeTypeForToken(token: { type: string; ordered?: boolean }): string | null {
  if (token.type === 'list') return token.ordered ? 'orderedList' : 'bulletList';
  return BLOCK_TOKEN_NODE_TYPES[token.type] ?? null;
}

/**
 * Re-parse a single block's raw markdown in isolation and return the content
 * of its first non-empty node of the wanted type. The result goes through the
 * same strip/lift normalization as the main pipeline so a repaired block can
 * never fail the schema check that follows.
 */
function reparseBlockContent(
  mgr: MarkdownManager,
  raw: string,
  nodeType: string,
  schema: Editor['schema'],
): JSONContent[] | null {
  try {
    const parsed = mgr.parse(raw);
    const candidate = (parsed.content ?? []).find(
      n => n.type === nodeType && Array.isArray(n.content) && n.content.length > 0,
    );
    if (!candidate) return null;
    const stripped = stripUnknownNodes(candidate, schema) ?? candidate;
    const lifted = liftBlockNodesFromInlineContainers(stripped, schema);
    return Array.isArray(lifted.content) && lifted.content.length > 0 ? lifted.content : null;
  } catch {
    return null;
  }
}

/**
 * Repair blocks that @tiptap/markdown's ordered-list parsing empties (parser
 * state corruption blanks the block right after a list, headings and
 * paragraphs alike). Blocks are matched against a marked token stream built
 * from the original markdown, one block token per doc node in order; code
 * fences are real code tokens there, so `#` lines inside them can no longer
 * skew the alignment. The repair only fires on blocks whose content is
 * actually empty, and any structural divergence bails out instead of guessing.
 */
function repairEmptyBlocks(
  json: JSONContent,
  mgr: MarkdownManager,
  rawContent: string,
  schema: Editor['schema'],
): void {
  if (!json.content || json.type !== 'doc') return;

  const tokens = marked.lexer(rawContent, { gfm: true, breaks: true });
  let cursor = 0;
  for (const token of tokens) {
    if (token.type === 'space') continue;
    const want = expectedNodeTypeForToken(token as { type: string; ordered?: boolean });
    if (!want) {
      console.warn('[MarkdownEditor] repairEmptyBlocks: unaligned token type, skipping repair:', token.type);
      return;
    }
    const node = json.content[cursor];
    if (!node || node.type !== want) {
      console.warn('[MarkdownEditor] repairEmptyBlocks: doc structure diverged from tokens, skipping repair');
      return;
    }

    const isEmpty = !Array.isArray(node.content) || node.content.length === 0;
    const repairable = node.type === 'heading' || node.type === 'paragraph';
    if (isEmpty && repairable) {
      if (node.type === 'heading') {
        const depth = (token as { depth?: number }).depth;
        if (typeof depth === 'number' && depth !== node.attrs?.level) {
          cursor += 1;
          continue;
        }
      }
      const raw = token.raw ?? '';
      if (raw.trim()) {
        const repaired = reparseBlockContent(mgr, raw, node.type, schema);
        if (repaired) node.content = repaired;
      }
    }
    cursor += 1;
  }
}

/**
 * Put currency-like $...$ spans (closing $ followed by a digit) back into the
 * parsed document. The spans were replaced with placeholders before parsing
 * so no registered tokenizer — stock or tightened — can consume
 * "It costs $5 and $10 total." as inline math together with the whitespace
 * inside the span.
 */
function restoreShieldedCurrency(json: JSONContent, spans: string[]): void {
  if (!json || typeof json !== 'object' || spans.length === 0) return;
  if (typeof json.text === 'string' && json.text.includes(CURRENCY_PLACEHOLDER)) {
    json.text = json.text.replace(/\x00CUR(\d+)\x00/g, (_m, i) => spans[parseInt(i, 10)] ?? '');
  }
  if (Array.isArray(json.content)) {
    for (const child of json.content) restoreShieldedCurrency(child, spans);
  }
}

const CURRENCY_PLACEHOLDER = '\x00CUR';

export function parseMarkdownContent(instance: Editor, content: string): JSONContent | null {
  const mgr = getMarkdownManager(instance);
  if (!mgr) return null;
  try {
    // Strip control characters that would break HTML/XML parsing
    content = sanitizeControlChars(content);
    // $$...$$ stays intact: the block-math tokenizer handles it directly, and
    // the listItem schema now accepts a leading blockMath (see
    // extensions/listItemWithBlockMath.ts), so collapsing $$ to $ — which
    // forced block math inline and rewrote $$ inside code fences — is gone.
    // Protect $...$ / $$...$$ math syntax from angle-bracket escaping so
    // that < inside LaTeX (e.g. $x < y$) is preserved. The custom
    // markdownTokenizer on the Mathematics extension handles these directly.
    const mathProtected = protectMathDollarSyntax(content);
    // Escape unprotected < to &lt; so marked doesn't treat text like <中文> as HTML.
    // Math HTML tags (from old saved content) are also protected from escaping.
    const htmlSafe = escapeNonHtmlAngleBrackets(mathProtected.protected);
    // Restore $...$ / $$...$$ math syntax so the custom tokenizer can parse it
    const finalContent = mathProtected.restore(htmlSafe);
    // Shield currency spans from the math tokenizer: a $...$ pair whose
    // closing $ is immediately followed by a digit is money, not math
    // ("It costs $5 and $10 total."). The placeholder survives parsing as
    // plain text and is substituted back into the document afterwards, so
    // the behavior does not depend on which tokenizer variant is registered.
    const currencySpans: string[] = [];
    const code = maskCodeRegions(finalContent);
    const shielded = code.protected.replace(/\$(?=\d)([^$\n]*?)\$(?=\d)/g, (match) => {
      currencySpans.push(match);
      return `${CURRENCY_PLACEHOLDER}${currencySpans.length - 1}\x00`;
    });
    const parsed = mgr.parse(code.restore(shielded));
    restoreShieldedCurrency(parsed, currencySpans);

    // Strip nodes with unknown types, then wrap bare inline nodes in paragraphs
    const stripped = stripUnknownNodes(parsed, instance.schema) ?? parsed;
    const sanitized = wrapBareInlineContent(stripped);
    // marked nests block-level nodes (e.g. images) inside paragraphs, which
    // fails schema validation and would throw away the whole document.
    const lifted = liftBlockNodesFromInlineContainers(sanitized, instance.schema);

    // Workaround for @tiptap/markdown bug: ordered lists corrupt parser state,
    // leaving the following block (heading or paragraph) empty. Repair by
    // re-parsing each empty block from its original markdown token.
    repairEmptyBlocks(lifted, mgr, content, instance.schema);

    instance.schema.nodeFromJSON(lifted).check();
    return lifted;
  } catch (err) {
    console.error('[MarkdownEditor] parseMarkdownContent failed:', err, 'content preview:', content.slice(0, 200));
    return null;
  }
}
function protectMathDollarSyntax(text: string): { protected: string; restore: (s: string) => string } {
  const blocks: string[] = [];
  const PROTECTED = '\x00MDS';
  let idx = 0;

  let processed = text;
  // Block math first ($$...$$) — multiline, non-greedy
  processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (match) => {
    const placeholder = `${PROTECTED}${idx}\x00`;
    blocks.push(match);
    idx++;
    return placeholder;
  });

  // Inline math ($...$) — single-line, exclude currency with (?![ \d])
  processed = processed.replace(/\$(?![ \d])([^$\n]+?)\$/g, (match) => {
    const placeholder = `${PROTECTED}${idx}\x00`;
    blocks.push(match);
    idx++;
    return placeholder;
  });

  return {
    protected: processed,
    restore: (s: string) => s.replace(/\x00MDS(\d+)\x00/g, (_m, i) => blocks[parseInt(i)] ?? ''),
  };
}

/**
 * Strip control characters that are invalid in HTML/XML and will break
 * the DOM parser used by generateJSON inside the markdown manager.
 */
function sanitizeControlChars(text: string): string {
  // Strip C1 control characters (U+0080-U+009F) — invalid in HTML/XML
  return text.replace(/[\x80-\x9f]/g, ' ');
}
export function parseMarkdownDoc(instance: Editor, content: string): JSONContent | null {
  return parseMarkdownContent(instance, content);
}
