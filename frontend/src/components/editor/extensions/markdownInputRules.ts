import { markInputRule } from '@tiptap/core';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Strike from '@tiptap/extension-strike';

const boldStarInputRegex = /(?<!\*)\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*)$/;
const boldUnderscoreInputRegex = /(?<!_)__(?!\s+__)((?:[^_]+))__(?!\s+__)$/;

const italicStarInputRegex = /(?<!\*)\*(?!\s+\*)((?:[^*]+))\*(?!\s+\*)$/;
const italicUnderscoreInputRegex = /(?<!_)_(?!\s+_)((?:[^_]+))_(?!\s+_)$/;

const strikeInputRegex = /(?<!~)~~(?!\s+~~)((?:[^~]+))~~(?!\s+~~)$/;

// Paste rules are intentionally NOT registered here.
// handlePaste in MarkdownEditor already parses markdown to JSON via
// parseMarkdownContent(), which carries bold/italic/strike marks.
// Adding paste rules on top would apply the same marks twice, causing
// ProseMirror to reject them with "Invalid collection of marks".

export const MarkdownBold = Bold.extend({
  addInputRules() {
    return [
      markInputRule({ find: boldStarInputRegex, type: this.type }),
      markInputRule({ find: boldUnderscoreInputRegex, type: this.type }),
    ];
  },
});

export const MarkdownItalic = Italic.extend({
  addInputRules() {
    return [
      markInputRule({ find: italicStarInputRegex, type: this.type }),
      markInputRule({ find: italicUnderscoreInputRegex, type: this.type }),
    ];
  },
});

export const MarkdownStrike = Strike.extend({
  addInputRules() {
    return [
      markInputRule({ find: strikeInputRegex, type: this.type }),
    ];
  },
});
