<template>
  <div class="editor-shell">
    <EditorContent
      v-if="activeNode"
      :editor="editor"
      class="editor-input"
      spellcheck="false"
    />
    <div v-else class="home-state">
      <button type="button" class="logout-button" @click="startLogout">
        <GlassWrapper class="logout-toggle" shape="circle" interactive>
          <span class="logout-toggle-mark" />
        </GlassWrapper>
        <span class="logout-label">退出登录</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Mathematics, mathMigrationRegex, migrateMathStrings } from '@tiptap/extension-mathematics';
import { Markdown } from '@tiptap/markdown';
import { all, createLowlight } from 'lowlight';
import DOMPurify from 'dompurify';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { CodeBlockWithUi } from './extensions/codeBlockWithUi';
import { MarkdownBold, MarkdownItalic, MarkdownStrike } from './extensions/markdownInputRules';
import 'highlight.js/styles/github.css';
import 'katex/dist/katex.min.css';

const AUTO_SAVE_DELAY_MS = 1000;

const store = useNodeStore();
const { activeNode } = storeToRefs(store);
const lowlight = createLowlight(all);

const draft = ref('');
const lastSavedContent = ref('');
const isApplyingExternalContent = ref(false);
const isMigratingMath = ref(false);

let autoSaveTimer: number | null = null;
let saveInFlight = false;
let queuedContent: string | null = null;

function sanitizeMarkdownSource(content: string): string {
  return content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, ' $1="#"');
}

function startLogout(): void {
  store.startLogout();
}

function clearAutoSaveTimer(): void {
  if (autoSaveTimer !== null) {
    window.clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

async function enqueueSave(nodeId: string, content: string): Promise<void> {
  if (!activeNode.value || activeNode.value.id !== nodeId) {
    return;
  }
  if (content === lastSavedContent.value) {
    return;
  }

  if (saveInFlight) {
    queuedContent = content;
    return;
  }

  saveInFlight = true;
  try {
    const saved = await store.saveActiveNodeContent(nodeId, content);
    if (saved && activeNode.value?.id === nodeId) {
      lastSavedContent.value = content;
    }
  } finally {
    saveInFlight = false;
    if (queuedContent !== null) {
      const nextContent = queuedContent;
      queuedContent = null;
      if (activeNode.value?.id === nodeId && nextContent !== lastSavedContent.value) {
        await enqueueSave(nodeId, nextContent);
      }
    }
  }
}

function syncEditorContent(content: string): void {
  if (!editor.value) {
    return;
  }

  isApplyingExternalContent.value = true;
  editor.value.commands.setContent(sanitizeMarkdownSource(content), {
    contentType: 'markdown',
    emitUpdate: false,
  });
  migrateMathStrings(editor.value);
  isApplyingExternalContent.value = false;
}

const editor = useEditor({
  content: '',
  contentType: 'markdown',
  extensions: [
    StarterKit.configure({
      codeBlock: false,
      bold: false,
      italic: false,
      strike: false,
    }),
    Markdown.configure({
      markedOptions: {
        gfm: false,
        breaks: true,
      },
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https',
      HTMLAttributes: {
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      },
    }),
    Image.configure({
      allowBase64: false,
      HTMLAttributes: {
        loading: 'lazy',
      },
    }),
    CodeBlockWithUi.configure({
      lowlight,
    }),
    MarkdownBold,
    MarkdownItalic,
    MarkdownStrike,
    Mathematics.configure({
      katexOptions: {
        throwOnError: true,
        trust: false,
      },
    }),
  ],
  editorProps: {
    attributes: {
      class: 'editor-prose',
      spellcheck: 'false',
    },
    transformPastedHTML: (html) =>
      DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
      }),
    transformPastedText: (text) =>
      text
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u00A0/g, ' '),
    handleDOMEvents: {
      click: (_view, event) => {
        if (!(event instanceof MouseEvent)) {
          return false;
        }

        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return false;
        }

        const link = target.closest('a');
        if (!link || !(event.ctrlKey || event.metaKey)) {
          return false;
        }

        const href = link.getAttribute('href');
        if (!href) {
          return true;
        }

        event.preventDefault();
        window.open(href, '_blank', 'noopener,noreferrer');
        return true;
      },
    },
  },
  onUpdate: ({ editor: instance }) => {
    if (isApplyingExternalContent.value) {
      return;
    }

    if (!isMigratingMath.value) {
      const textContent = instance.state.doc.textContent;
      mathMigrationRegex.lastIndex = 0;
      if (mathMigrationRegex.test(textContent)) {
        isMigratingMath.value = true;
        migrateMathStrings(instance);
        isMigratingMath.value = false;
      }
    }

    draft.value = instance.getMarkdown();
  },
});

watch(
  [() => editor.value, () => activeNode.value?.id],
  () => {
    clearAutoSaveTimer();
    saveInFlight = false;
    queuedContent = null;

    const content = activeNode.value?.content ?? '';
    lastSavedContent.value = content;
    draft.value = content;

    if (activeNode.value && editor.value) {
      syncEditorContent(content);
    }
  },
  { immediate: true },
);

watch(draft, (value) => {
  const nodeId = activeNode.value?.id;
  if (!nodeId) {
    clearAutoSaveTimer();
    return;
  }

  if (value === lastSavedContent.value) {
    clearAutoSaveTimer();
    return;
  }

  clearAutoSaveTimer();
  autoSaveTimer = window.setTimeout(() => {
    void enqueueSave(nodeId, value);
  }, AUTO_SAVE_DELAY_MS);
});

onBeforeUnmount(() => {
  clearAutoSaveTimer();
  editor.value?.destroy();
});
</script>

<style scoped>
.editor-shell {
  width: 100%;
  height: 100%;
  color: var(--color-primary);
}

.editor-input {
  width: 100%;
  height: 100%;
  padding: 14px 16px;
  overflow: auto;
}

.editor-input :deep(.editor-prose) {
  min-height: 100%;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-primary);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.editor-input :deep(p) {
  margin: 0 0 0.75em;
}

.editor-input :deep(p:last-child) {
  margin-bottom: 0;
}

.editor-input :deep(h1),
.editor-input :deep(h2),
.editor-input :deep(h3),
.editor-input :deep(h4),
.editor-input :deep(h5),
.editor-input :deep(h6) {
  margin: 0.35em 0 0.5em;
  line-height: 1.28;
}

.editor-input :deep(h1) {
  font-size: 1.42em;
}

.editor-input :deep(h2) {
  font-size: 1.28em;
}

.editor-input :deep(h3) {
  font-size: 1.16em;
}

.editor-input :deep(ul),
.editor-input :deep(ol) {
  margin: 0 0 0.8em;
  padding-left: 1.3em;
}

.editor-input :deep(li) {
  margin: 0.15em 0;
}

.editor-input :deep(a) {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.editor-input :deep(a:hover) {
  color: #3d5eff;
}

.editor-input :deep(img) {
  max-width: 100%;
  height: auto;
  margin: 0.3em 0;
  border-radius: 10px;
}

.editor-input :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
}

.editor-input :deep(p code),
.editor-input :deep(li code) {
  padding: 0.1em 0.35em;
  border-radius: 6px;
  background: rgba(102, 128, 255, 0.12);
}

.editor-input :deep(.md-code-shell) {
  position: relative;
  margin: 0 0 0.9em;
}

.editor-input :deep(.md-code-shell > pre.md-code-block) {
  position: relative;
  margin: 0;
  padding: 12px 12px 12px 52px;
  border-radius: 12px;
  border: 1px solid rgba(102, 128, 255, 0.24);
  background: rgba(255, 255, 255, 0.62);
  overflow: auto;
  line-height: 1.6;
  tab-size: 2;
}

.editor-input :deep(.md-code-shell > pre.md-code-block::before) {
  content: attr(data-line-numbers);
  position: absolute;
  left: 0;
  top: 0;
  width: 40px;
  height: 100%;
  padding: 12px 8px 12px 0;
  border-right: 1px solid rgba(102, 128, 255, 0.18);
  color: rgba(102, 128, 255, 0.72);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre;
  text-align: right;
  user-select: none;
  pointer-events: none;
}

.editor-input :deep(.md-code-shell > pre.md-code-block > code) {
  display: block;
  min-width: max-content;
}

.editor-input :deep(.md-code-shell > .code-copy-btn) {
  position: absolute;
  right: 8px;
  top: 8px;
  border: 1px solid rgba(102, 128, 255, 0.25);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.8);
  color: #4d67da;
  font-size: 12px;
  line-height: 1;
  padding: 6px 10px;
  cursor: pointer;
}

.editor-input :deep(.md-code-shell > .code-copy-btn:hover) {
  background: rgba(255, 255, 255, 0.95);
}

.editor-input :deep(.md-code-shell > .code-copy-btn:active) {
  transform: translateY(1px);
}

.editor-input :deep(.tiptap-mathematics-render) {
  display: inline-block;
  margin: 0 0.15em;
  padding: 0.08em 0.22em;
  border-radius: 6px;
  background: rgba(102, 128, 255, 0.08);
}

.editor-input :deep(.tiptap-mathematics-render[data-type='block-math']) {
  display: block;
  margin: 0.5em 0 0.9em;
  padding: 0.7em 0.8em;
}

.editor-input :deep(.inline-math-error),
.editor-input :deep(.block-math-error) {
  color: #bb2f2f;
  background: rgba(255, 201, 201, 0.34);
}

.editor-input :deep(blockquote) {
  margin: 0 0 0.9em;
  padding-left: 0.8em;
  border-left: 3px solid rgba(102, 128, 255, 0.35);
}

.editor-input :deep(hr) {
  border: 0;
  border-top: 1px solid rgba(102, 128, 255, 0.28);
  margin: 0.9em 0;
}

.home-state {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--color-primary);
}

.logout-button {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.logout-toggle {
  width: 28px;
  height: 28px;
  padding: 1px;
}

.logout-toggle :deep(.glass-raised) {
  box-shadow:
    3px 3px 6px rgba(49, 78, 151, 0.16),
    -3px -3px 6px rgba(255, 255, 255, 0.3);
}

.logout-toggle-mark {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
}

.logout-label {
  font-size: 28px;
  line-height: 1.2;
  font-weight: 700;
}
</style>
