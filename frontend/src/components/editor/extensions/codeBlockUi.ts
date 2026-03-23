import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const CODE_COPY_DEFAULT_TEXT = 'Copy';
const CODE_COPY_SUCCESS_TEXT = 'Copied';
const CODE_COPY_RESET_DELAY_MS = 1200;

function getLineCount(text: string): number {
  if (!text) {
    return 1;
  }
  return text.split('\n').length;
}

function buildLineNumbers(lineCount: number): string {
  return Array.from({ length: lineCount }, (_value, index) => `${index + 1}`).join('\n');
}

function setCopyButtonText(button: HTMLButtonElement, text: string): void {
  button.textContent = text;
}

function attachCopyButton(preElement: HTMLPreElement, codeElement: HTMLElement): void {
  if (preElement.querySelector<HTMLButtonElement>('.code-copy-btn')) {
    return;
  }

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'code-copy-btn';
  copyButton.contentEditable = 'false';
  setCopyButtonText(copyButton, CODE_COPY_DEFAULT_TEXT);

  let resetTimer: number | null = null;

  copyButton.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });

  copyButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const rawCode = codeElement.textContent ?? '';
    const writePromise = navigator.clipboard?.writeText(rawCode);

    if (!writePromise) {
      return;
    }

    void writePromise
      .then(() => {
        setCopyButtonText(copyButton, CODE_COPY_SUCCESS_TEXT);
        if (resetTimer !== null) {
          window.clearTimeout(resetTimer);
        }
        resetTimer = window.setTimeout(() => {
          setCopyButtonText(copyButton, CODE_COPY_DEFAULT_TEXT);
          resetTimer = null;
        }, CODE_COPY_RESET_DELAY_MS);
      })
      .catch(() => {
        setCopyButtonText(copyButton, CODE_COPY_DEFAULT_TEXT);
      });
  });

  preElement.append(copyButton);
}

function syncCodeBlockUi(rootElement: HTMLElement): void {
  const codeElements = rootElement.querySelectorAll<HTMLElement>('pre > code');

  codeElements.forEach((codeElement) => {
    const preElement = codeElement.parentElement;

    if (!(preElement instanceof HTMLPreElement)) {
      return;
    }

    preElement.classList.add('md-code-block');
    preElement.setAttribute('data-line-numbers', buildLineNumbers(getLineCount(codeElement.textContent ?? '')));
    attachCopyButton(preElement, codeElement);
  });
}

export const CodeBlockUi = Extension.create({
  name: 'codeBlockUi',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('codeBlockUi'),
        view: (editorView) => {
          let frameHandle: number | null = null;

          const scheduleSync = () => {
            if (frameHandle !== null) {
              window.cancelAnimationFrame(frameHandle);
            }

            frameHandle = window.requestAnimationFrame(() => {
              frameHandle = null;
              syncCodeBlockUi(editorView.dom as HTMLElement);
            });
          };

          scheduleSync();

          return {
            update: scheduleSync,
            destroy: () => {
              if (frameHandle !== null) {
                window.cancelAnimationFrame(frameHandle);
              }
            },
          };
        },
      }),
    ];
  },
});
