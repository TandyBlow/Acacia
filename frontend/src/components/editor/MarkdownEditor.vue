<template>
  <div class="editor-shell">
    <template v-if="activeNode">
      <div class="editor-toolbar">
        <button
          type="button"
          class="node-link-btn"
          :disabled="!hasTextSelection || nodeLinkPickerBusy"
          title="Ctrl/Cmd + K"
          @mousedown.prevent
          @click="openNodeLinkPicker"
        >
          {{ nodeLinkPickerBusy ? 'Loading Nodes...' : 'Link Node' }}
        </button>
      </div>

      <EditorContent :editor="editor" class="editor-input" spellcheck="false" />

      <NodeLinkPicker
        v-if="showNodeLinkPicker"
        :options="nodeLinkOptions"
        @cancel="closeNodeLinkPicker"
        @confirm="applyInternalNodeLink"
      />
    </template>
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
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import type { Editor, JSONContent } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Mathematics, mathMigrationRegex, migrateMathStrings } from '@tiptap/extension-mathematics';
import { Markdown } from '@tiptap/markdown';
import { all, createLowlight } from 'lowlight';
import DOMPurify from 'dompurify';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import type { TreeNode } from '../../types/node';
import NodeLinkPicker from './NodeLinkPicker.vue';
import { CodeBlockWithUi } from './extensions/codeBlockWithUi';
import { MarkdownBold, MarkdownItalic, MarkdownStrike } from './extensions/markdownInputRules';
import { buildInternalNodeHref, parseInternalNodeHref } from './internalLink';
import 'highlight.js/styles/github.css';
import 'katex/dist/katex.min.css';

const AUTO_SAVE_DELAY_MS = 1000;
const PROSEMIRROR_SLICE_MIME = 'application/x-prosemirror-slice';

const store = useNodeStore();
const { activeNode, treeNodes } = storeToRefs(store);
const lowlight = createLowlight(all);

interface InternalLinkSelection {
  href: string;
  from: number;
  to: number;
}

interface NodeLinkOption {
  id: string;
  name: string;
  path: string;
  depth: number;
}

const draft = ref('');
const lastSavedContent = ref('');
const isApplyingExternalContent = ref(false);
const isMigratingMath = ref(false);
const hasTextSelection = ref(false);
const nodeLinkPickerBusy = ref(false);
const showNodeLinkPicker = ref(false);
const armedInternalLink = ref<InternalLinkSelection | null>(null);
const pendingNodeLinkRange = ref<{ from: number; to: number } | null>(null);

let autoSaveTimer: number | null = null;
let saveInFlight = false;
let queuedContent: string | null = null;

function sanitizeMarkdownSource(content: string): string {
  return content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, ' $1="#"');
}

function normalizePastedText(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ');
}

function buildPlainTextDoc(content: string): JSONContent {
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

function parseMarkdownDoc(instance: Editor, content: string): JSONContent | null {
  try {
    if (!instance.markdown) {
      return null;
    }
    const parsed = instance.markdown.parse(content);
    const parsedNode = instance.schema.nodeFromJSON(parsed);
    parsedNode.check();
    return parsed;
  } catch {
    return null;
  }
}

function startLogout(): void {
  store.startLogout();
}

function syncSelectionState(): void {
  if (!editor.value) {
    hasTextSelection.value = false;
    return;
  }
  const { from, to } = editor.value.state.selection;
  hasTextSelection.value = from !== to;
}

function flattenTreeNodes(
  nodes: TreeNode[],
  ancestors: string[],
  depth: number,
  result: NodeLinkOption[],
): void {
  for (const node of nodes) {
    const pathParts = [...ancestors, node.name];
    result.push({
      id: node.id,
      name: node.name,
      path: pathParts.join(' / '),
      depth,
    });
    flattenTreeNodes(node.children, pathParts, depth + 1, result);
  }
}

const nodeLinkOptions = computed(() => {
  const options: NodeLinkOption[] = [];
  flattenTreeNodes(treeNodes.value, [], 0, options);
  return options;
});

function closeNodeLinkPicker(): void {
  showNodeLinkPicker.value = false;
  pendingNodeLinkRange.value = null;
}

async function openNodeLinkPicker(): Promise<void> {
  if (!activeNode.value || !editor.value || !hasTextSelection.value) {
    return;
  }

  const { from, to } = editor.value.state.selection;
  if (from === to) {
    return;
  }

  pendingNodeLinkRange.value = { from, to };
  nodeLinkPickerBusy.value = true;
  try {
    await store.refreshTree();
    showNodeLinkPicker.value = true;
  } catch {
    pendingNodeLinkRange.value = null;
  } finally {
    nodeLinkPickerBusy.value = false;
  }
}

function applyInternalNodeLink(nodeId: string): void {
  if (!editor.value) {
    showNodeLinkPicker.value = false;
    pendingNodeLinkRange.value = null;
    return;
  }

  const range = pendingNodeLinkRange.value;
  if (!range || range.from === range.to) {
    showNodeLinkPicker.value = false;
    pendingNodeLinkRange.value = null;
    return;
  }

  const href = buildInternalNodeHref(nodeId);
  editor.value
    .chain()
    .focus()
    .setTextSelection({ from: range.from, to: range.to })
    .setLink({ href })
    .run();
  armedInternalLink.value = null;
  showNodeLinkPicker.value = false;
  pendingNodeLinkRange.value = null;
  syncSelectionState();
}

function selectLinkRange(view: EditorView, link: HTMLAnchorElement, href: string): InternalLinkSelection | null {
  if (!editor.value) {
    return null;
  }

  let position = 0;
  try {
    position = view.posAtDOM(link, 0);
  } catch {
    return null;
  }

  editor.value.chain().focus().setTextSelection(position).extendMarkRange('link').run();
  const { from, to } = editor.value.state.selection;
  if (from === to) {
    return null;
  }

  const attrs = editor.value.getAttributes('link');
  if (typeof attrs.href !== 'string' || attrs.href !== href) {
    return null;
  }

  return { href, from, to };
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

  const source = sanitizeMarkdownSource(content);
  const parsedDoc = parseMarkdownDoc(editor.value, source);

  isApplyingExternalContent.value = true;
  editor.value.commands.setContent(parsedDoc ?? buildPlainTextDoc(source), {
    emitUpdate: false,
  });
  migrateMathStrings(editor.value);
  isApplyingExternalContent.value = false;
  syncSelectionState();
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
    transformPastedText: (text) => normalizePastedText(text),
    handlePaste: (_view, event) => {
      if (!editor.value || !event.clipboardData) {
        return false;
      }

      const clipboardTypes = Array.from(event.clipboardData.types);
      if (clipboardTypes.includes(PROSEMIRROR_SLICE_MIME)) {
        return false;
      }

      const markdownText = event.clipboardData.getData('text/markdown');
      const plainText = event.clipboardData.getData('text/plain');
      const source = sanitizeMarkdownSource(normalizePastedText(markdownText || plainText));
      if (!source) {
        return false;
      }

      const parsedDoc = parseMarkdownDoc(editor.value, source) ?? buildPlainTextDoc(source);
      const insertContent = Array.isArray(parsedDoc.content) ? parsedDoc.content : [];

      event.preventDefault();
      if (insertContent.length === 0) {
        return editor.value.commands.insertContent({ type: 'paragraph' });
      }
      return editor.value.commands.insertContent(insertContent);
    },
    handleDOMEvents: {
      click: (view, event) => {
        if (!(event instanceof MouseEvent)) {
          return false;
        }

        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return false;
        }

        const link = target.closest('a');
        if (!(link instanceof HTMLAnchorElement)) {
          return false;
        }

        const href = link.getAttribute('href');
        if (!href) {
          return true;
        }

        const internalNodeId = parseInternalNodeHref(href);
        if (internalNodeId) {
          event.preventDefault();
          const currentSelection = selectLinkRange(view, link, href);
          if (!currentSelection) {
            return true;
          }

          const armed = armedInternalLink.value;
          if (
            armed &&
            armed.href === currentSelection.href &&
            armed.from === currentSelection.from &&
            armed.to === currentSelection.to
          ) {
            armedInternalLink.value = null;
            closeNodeLinkPicker();
            void store.loadNode(internalNodeId);
            return true;
          }

          armedInternalLink.value = currentSelection;
          return true;
        }

        if (!(event.ctrlKey || event.metaKey)) {
          return false;
        }

        event.preventDefault();
        window.open(href, '_blank', 'noopener,noreferrer');
        return true;
      },
      keydown: (_view, event) => {
        if (!(event instanceof KeyboardEvent)) {
          return false;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          void openNodeLinkPicker();
          return true;
        }
        return false;
      },
    },
  },
  onCreate: ({ editor: instance }) => {
    const { from, to } = instance.state.selection;
    hasTextSelection.value = from !== to;
  },
  onSelectionUpdate: ({ editor: instance }) => {
    const { from, to } = instance.state.selection;
    hasTextSelection.value = from !== to;

    const armed = armedInternalLink.value;
    if (!armed) {
      return;
    }

    if (armed.from !== from || armed.to !== to) {
      armedInternalLink.value = null;
    }
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

    armedInternalLink.value = null;
    pendingNodeLinkRange.value = null;
    draft.value = instance.getMarkdown();
  },
});

watch(
  [() => editor.value, () => activeNode.value?.id],
  () => {
    clearAutoSaveTimer();
    saveInFlight = false;
    queuedContent = null;
    showNodeLinkPicker.value = false;
    armedInternalLink.value = null;
    pendingNodeLinkRange.value = null;

    const content = activeNode.value?.content ?? '';
    lastSavedContent.value = content;
    draft.value = content;

    if (activeNode.value && editor.value) {
      syncEditorContent(content);
      return;
    }
    syncSelectionState();
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
  showNodeLinkPicker.value = false;
  armedInternalLink.value = null;
  pendingNodeLinkRange.value = null;
  editor.value?.destroy();
});
</script>

<style scoped>
.editor-shell {
  position: relative;
  width: 100%;
  height: 100%;
  color: var(--color-primary);
}

.editor-toolbar {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 12;
}

.node-link-btn {
  border: 1px solid rgba(109, 138, 255, 0.3);
  border-radius: 10px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.86);
  color: #2e4297;
  font-size: 12px;
  line-height: 1.2;
  cursor: pointer;
}

.node-link-btn:hover {
  background: rgba(255, 255, 255, 1);
}

.node-link-btn:disabled {
  opacity: 0.52;
  cursor: not-allowed;
}

.editor-input {
  width: 100%;
  height: 100%;
  padding: 44px 16px 14px;
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
