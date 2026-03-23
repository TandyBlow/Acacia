import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const COPY_DEFAULT_TEXT = 'Copy';
const COPY_SUCCESS_TEXT = 'Copied';
const COPY_RESET_DELAY_MS = 1200;

function getLineCount(text: string): number {
  return text.length > 0 ? text.split('\n').length : 1;
}

function buildLineNumbers(text: string): string {
  const lineCount = getLineCount(text);
  return Array.from({ length: lineCount }, (_value, index) => `${index + 1}`).join('\n');
}

function setLanguageClass(codeElement: HTMLElement, prefix: string, language: string | null): void {
  codeElement.className = '';
  if (language) {
    codeElement.classList.add(`${prefix}${language}`);
  }
}

function syncLineNumbers(preElement: HTMLPreElement, text: string): void {
  preElement.setAttribute('data-line-numbers', buildLineNumbers(text));
}

export const CodeBlockWithUi = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node }) => {
      const languageClassPrefix = this.options.languageClassPrefix ?? 'language-';

      const shell = document.createElement('div');
      shell.className = 'md-code-shell';
      shell.setAttribute('data-type', 'code-block-shell');

      const preElement = document.createElement('pre');
      preElement.className = 'md-code-block';

      const codeElement = document.createElement('code');
      preElement.append(codeElement);

      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'code-copy-btn';
      copyButton.contentEditable = 'false';
      copyButton.textContent = COPY_DEFAULT_TEXT;

      shell.append(preElement, copyButton);

      let currentText = node.textContent;
      let resetTimer: number | null = null;

      setLanguageClass(codeElement, languageClassPrefix, node.attrs.language ?? null);
      syncLineNumbers(preElement, currentText);

      copyButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });

      copyButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        const writePromise = navigator.clipboard?.writeText(currentText);
        if (!writePromise) {
          return;
        }

        void writePromise
          .then(() => {
            copyButton.textContent = COPY_SUCCESS_TEXT;
            if (resetTimer !== null) {
              window.clearTimeout(resetTimer);
            }
            resetTimer = window.setTimeout(() => {
              copyButton.textContent = COPY_DEFAULT_TEXT;
              resetTimer = null;
            }, COPY_RESET_DELAY_MS);
          })
          .catch(() => {
            copyButton.textContent = COPY_DEFAULT_TEXT;
          });
      });

      return {
        dom: shell,
        contentDOM: codeElement,
        update: (updatedNode) => {
          if (updatedNode.type !== node.type) {
            return false;
          }

          currentText = updatedNode.textContent;
          setLanguageClass(codeElement, languageClassPrefix, updatedNode.attrs.language ?? null);
          syncLineNumbers(preElement, currentText);
          return true;
        },
        destroy: () => {
          if (resetTimer !== null) {
            window.clearTimeout(resetTimer);
          }
        },
      };
    };
  },

  addProseMirrorPlugins() {
    const parentPlugins = this.parent?.() ?? [];

    const fenceExitPlugin = new Plugin({
      key: new PluginKey('codeBlockFenceExit'),
      props: {
        handleTextInput: (view, _from, _to, text) => {
          if (text !== '`') {
            return false;
          }

          const { state } = view;
          const { selection } = state;
          if (!selection.empty) {
            return false;
          }

          const { $from } = selection;
          if ($from.parent.type !== this.type) {
            return false;
          }

          const blockText = $from.parent.textContent;
          const cursorOffset = $from.parentOffset;

          const lineStartOffset = blockText.lastIndexOf('\n', Math.max(0, cursorOffset - 1)) + 1;
          const lineEndIndex = blockText.indexOf('\n', cursorOffset);
          const lineEndOffset = lineEndIndex === -1 ? blockText.length : lineEndIndex;

          const beforeCursor = blockText.slice(lineStartOffset, cursorOffset);
          const afterCursor = blockText.slice(cursorOffset, lineEndOffset);

          if (beforeCursor !== '``' || afterCursor.length > 0) {
            return false;
          }

          const blockStart = $from.start();
          let deleteFrom = blockStart + lineStartOffset;
          const deleteTo = blockStart + lineEndOffset;

          if (lineStartOffset > 0) {
            deleteFrom -= 1;
          }

          view.dispatch(state.tr.delete(deleteFrom, deleteTo));
          this.editor.commands.exitCode();
          return true;
        },
      },
    });

    return [...parentPlugins, fenceExitPlugin];
  },
});
