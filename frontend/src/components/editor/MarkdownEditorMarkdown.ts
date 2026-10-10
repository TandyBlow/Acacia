import type { Editor, JSONContent } from '@tiptap/core'
import type { MarkdownManager } from '@tiptap/markdown'
import { liftBlockNodesFromInlineContainers, maskCodeRegions, stripUnknownNodes, wrapBareInlineContent } from './MarkdownEditorMarkdownUtil'
import { checkParseIntegrity, type IntegrityReport } from './MarkdownEditorIntegrity'

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
  return parseMarkdownWithIntegrity(instance, content).doc
}

/**
 * Parse plus a parse-integrity verdict: the checker compares the pre-parse
 * markdown with the parsed doc per content unit, so a parse that silently
 * dropped or duplicated blocks is reported instead of sailing through as a
 * schema-valid "success".
 */
export function parseMarkdownWithIntegrity(
  instance: Editor,
  content: string,
): { doc: JSONContent | null; integrity: IntegrityReport } {
  const mgr = getMarkdownManager(instance)
  if (!mgr) {
    return {
      doc: null,
      integrity: { ok: false, issues: [{ kind: 'lost', unit: 'document', sample: content.slice(0, 60), expected: 1, actual: 0 }] },
    }
  }
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

    instance.schema.nodeFromJSON(lifted).check();

    // `content` at this point is the exact markdown that reached mgr.parse
    // (sanitized, angle-escaped, math restored); the currency shield was
    // already substituted back into the doc, so the two sides line up.
    const integrity = checkParseIntegrity(content, lifted);
    if (!integrity.ok) {
      console.error('[MarkdownEditor] parse integrity check failed:', integrity.issues);
    }
    return { doc: lifted, integrity };
  } catch (err) {
    console.error('[MarkdownEditor] parseMarkdownContent failed:', err, 'content preview:', content.slice(0, 200));
    return {
      doc: null,
      integrity: { ok: false, issues: [{ kind: 'lost', unit: 'document', sample: content.slice(0, 60), expected: 1, actual: 0 }] },
    };
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
