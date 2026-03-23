import { markInputRule, markPasteRule } from '@tiptap/core';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Strike from '@tiptap/extension-strike';

const boldStarInputRegex = /(?:^|[^*])(\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*))$/;
const boldStarPasteRegex = /(?:^|[^*])(\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*))/g;
const boldUnderscoreInputRegex = /(?:^|[^_])(__(?!\s+__)((?:[^_]+))__(?!\s+__))$/;
const boldUnderscorePasteRegex = /(?:^|[^_])(__(?!\s+__)((?:[^_]+))__(?!\s+__))/g;

const italicStarInputRegex = /(?:^|[^*])(\*(?!\s+\*)((?:[^*]+))\*(?!\s+\*))$/;
const italicStarPasteRegex = /(?:^|[^*])(\*(?!\s+\*)((?:[^*]+))\*(?!\s+\*))/g;
const italicUnderscoreInputRegex = /(?:^|[^_])(_(?!\s+_)((?:[^_]+))_(?!\s+_))$/;
const italicUnderscorePasteRegex = /(?:^|[^_])(_(?!\s+_)((?:[^_]+))_(?!\s+_))/g;

const strikeInputRegex = /(?:^|[^~])(~~(?!\s+~~)((?:[^~]+))~~(?!\s+~~))$/;
const strikePasteRegex = /(?:^|[^~])(~~(?!\s+~~)((?:[^~]+))~~(?!\s+~~))/g;

export const MarkdownBold = Bold.extend({
  addInputRules() {
    return [
      markInputRule({
        find: boldStarInputRegex,
        type: this.type,
      }),
      markInputRule({
        find: boldUnderscoreInputRegex,
        type: this.type,
      }),
    ];
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: boldStarPasteRegex,
        type: this.type,
      }),
      markPasteRule({
        find: boldUnderscorePasteRegex,
        type: this.type,
      }),
    ];
  },
});

export const MarkdownItalic = Italic.extend({
  addInputRules() {
    return [
      markInputRule({
        find: italicStarInputRegex,
        type: this.type,
      }),
      markInputRule({
        find: italicUnderscoreInputRegex,
        type: this.type,
      }),
    ];
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: italicStarPasteRegex,
        type: this.type,
      }),
      markPasteRule({
        find: italicUnderscorePasteRegex,
        type: this.type,
      }),
    ];
  },
});

export const MarkdownStrike = Strike.extend({
  addInputRules() {
    return [
      markInputRule({
        find: strikeInputRegex,
        type: this.type,
      }),
    ];
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: strikePasteRegex,
        type: this.type,
      }),
    ];
  },
});
