import { Extension } from '@tiptap/core';
import { InlineMath } from '@tiptap/extension-mathematics';
import type { MarkdownToken } from '@tiptap/core';

/**
 * marked's emStrong rule fails when a $ sits directly inside the ** delimiters
 * (**$x$**), and the inline-math tokenizer's start function then makes the
 * text cutter jump into the asterisks, so the bold markers are silently
 * dropped. This guard tokenizer claims plain **...** spans before the math
 * tokenizer can see the $ inside, and parses the inner content with the
 * regular inline rules. Cases the regex rejects (***, intraword, underscores)
 * fall through to marked's own emStrong handling.
 */
export const StrongSpanGuard = Extension.create({
  name: 'strongSpanGuard',
  markdownTokenizer: {
    name: 'strong',
    level: 'inline',
    start: (src: string) => src.indexOf('**'),
    tokenize: (src, _tokens, helpers) => {
      const match = /^\*\*(?=[^\s*])([\s\S]*?[^\s*])\*\*(?!\*)/.exec(src);
      if (!match) return undefined;
      const inner = match[1] ?? '';
      return {
        type: 'strong',
        raw: match[0],
        text: inner,
        tokens: helpers.inlineTokens(inner),
      } satisfies MarkdownToken;
    },
  },
});

/**
 * Tightened inline-math tokenizer, mirroring pandoc's rules: the opening $
 * must not be followed by whitespace, the closing $ must not be followed by a
 * digit and must not be preceded by whitespace. "It costs $5 and $10 total."
 * therefore stays plain text while $E=mc^2$ and $2x$ keep parsing as math.
 * The stock tokenizer accepts any $...$ pair, which consumed currency spans
 * together with the whitespace inside them.
 */
export const TightInlineMath = InlineMath.extend({
  markdownTokenizer: {
    name: 'inlineMath',
    level: 'inline',
    start: (src: string) => src.indexOf('$'),
    tokenize: (src) => {
      const match = src.match(/^\$(?!\s)([^$\n]+?)\$(?!\d)(?!\$)/);
      if (!match) return undefined;
      const latex = match[1] ?? '';
      if (/\s$/.test(latex)) return undefined;
      return {
        type: 'inlineMath',
        raw: match[0],
        latex: latex.trim(),
      } satisfies MarkdownToken;
    },
  },
});
