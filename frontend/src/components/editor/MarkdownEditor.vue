<template>
  <div ref="editorRef" class="editor-root">
    <!-- Single activity area: always visible -->
    <div class="activity-layout">
      <div class="activity-glass-host">
        <GlassWrapper>
          <div class="activity-scroll">
            <div v-if="activeNode && sameNameNodePaths.length > 1" class="same-name-paths" aria-live="polite">
              <div class="same-name-paths-title">{{ t('editor.sameNamePathsTitle') }}</div>
              <div class="same-name-paths-list">
                <div
                  v-for="(path, index) in sameNameNodePaths"
                  :key="`${path}-${index}`"
                  class="same-name-path"
                >
                  {{ path }}
                </div>
              </div>
            </div>

            <!-- text_input mode: inline chat prompt in editor -->
            <template v-if="chatMode === 'text_input'">
              <EditorContent
                :editor="editor"
                class="editor-input"
                spellcheck="false"
              />
            </template>

            <!-- file_upload mode: file upload UI -->
            <div v-else-if="chatMode === 'file_upload'" class="chat-input-form">
              <FileUploadArea @uploaded="onFileUploaded" @removed="onFileRemoved" />
            </div>

            <!-- file_uploaded mode: file received, show action choice -->
            <div v-else-if="chatMode === 'file_uploaded' && pendingFile" class="file-uploaded-choice">
              <div class="choice-file-info">
                <span class="choice-file-icon">📄</span>
                <span class="choice-file-name">{{ pendingFile.filename }}</span>
                <span class="choice-file-size">{{ formatFileSize(pendingFile.size) }}</span>
              </div>
              <div class="choice-prompt">{{ $t('editor.fileUploadDone') }}</div>
              <div v-if="errorMessage" class="choice-error">{{ errorMessage }}</div>
              <div class="choice-actions">
                <div class="action-glass-host choice-glass">
                  <GlassWrapper
                    interactive
                    @click="fillContentFromFile()"
                  >
                    <div class="choice-inner">
                      <span class="choice-label">{{ $t('editor.fillContent') }}</span>
                      <span class="choice-desc">{{ $t('editor.fillContentDesc') }}</span>
                    </div>
                  </GlassWrapper>
                </div>
                <div class="action-glass-host choice-glass">
                  <GlassWrapper
                    interactive
                    @click="startLineByLineChat()"
                  >
                    <div class="choice-inner">
                      <span class="choice-label">{{ $t('editor.startExplain') }}</span>
                      <span class="choice-desc">{{ $t('editor.startExplainDesc') }}</span>
                    </div>
                  </GlassWrapper>
                </div>
              </div>
              <button class="choice-cancel" @click="cancelFileUpload()">{{ $t('editor.cancel') }}</button>
            </div>

            <!-- idle or conversing: editor + optional conversation controls -->
            <template v-else>
              <div
                v-if="showMarkdownRenderedContent"
                class="markdown-preview editor-input"
                v-html="renderedMarkdown"
              />
              <EditorContent
                v-else
                :editor="editor"
                class="editor-input"
                :class="{ 'editor-readonly': chatMode === 'conversing' }"
                spellcheck="false"
              />

              <!-- @deprecated conversing textarea mode: 当前交互流程中用户始终走 text_input 内联模式，
                  这个 textarea 只在 API 请求期间短暂闪现，实际不会被用到。修改 AI 对话功能时请改 sendInlineMessage()。 -->
              <div v-if="chatMode === 'conversing'" class="conversation-input-area">
                <div class="conv-progress">
                  <span class="conv-progress-label">
                    <template v-if="totalKp <= 1">
                      {{ isCompleted ? $t('editor.chatEnded') : $t('editor.chatting') }}
                    </template>
                    <template v-else>
                      {{ $t('editor.kpProgress', { current: currentKpIndex + 1, total: totalKp }) }}
                    </template>
                  </span>
                  <span v-if="currentSubTopic" class="conv-progress-topic">{{ currentSubTopic }}</span>
                  <div class="conv-progress-track">
                    <div
                      class="conv-progress-fill"
                      :class="{ 'conv-progress-indeterminate': totalKp <= 1 && !isCompleted }"
                      :style="totalKp > 1 || isCompleted ? { width: progressPercent + '%' } : {}"
                    />
                  </div>
                </div>

                <textarea
                  v-model="userInput"
                  class="conv-textarea"
                  :placeholder="$t('editor.inputPlaceholder')"
                  :disabled="isBusy || isCompleted"
                  rows="3"
                  @keydown="onConvKeydown"
                />

                <div class="conv-actions">
                  <button
                    class="conv-btn conv-btn-skip"
                    :disabled="isBusy || isCompleted"
                    @click="onSkipTurn"
                  >{{ $t('editor.skip') }}</button>
                  <button
                    class="conv-btn conv-btn-end"
                    :disabled="isBusy || isCompleted"
                    @click="onEndConversation"
                  >{{ $t('editor.endChat') }}</button>
                  <button
                    class="conv-btn conv-btn-send"
                    :disabled="!canSend || isBusy || isCompleted"
                    @click="sendAnswer"
                  >
                    {{ isBusy ? $t('editor.sending') : $t('editor.send') }}
                  </button>
                </div>

                <div v-if="isCompleted" class="conv-completed-banner">
                  {{ $t('editor.chatEndedHint') }}
                </div>
              </div>
              <!-- /@deprecated conversing textarea mode -->
            </template>
          </div>
        </GlassWrapper>
      </div>
    </div>

    <!-- Concept chips: clickable knowledge points extracted from conversation -->
    <div
      v-if="chatMode === 'text_input' && mentionedConcepts.length > 0"
      class="concept-chips-row"
    >
      <span
        v-for="concept in mentionedConcepts"
        :key="concept.name"
        class="concept-chip"
        :class="{
          'concept-chip-marked': markedConceptNames.has(concept.name),
          'concept-chip-verified': concept.verified,
        }"
        :title="concept.wiki_summary || concept.definition"
        @click="onConceptClick(concept.name)"
      >
        <span v-if="concept.verified" class="concept-chip-w-badge">W</span>
        {{ concept.name }}
        <span v-if="markedConceptNames.has(concept.name)" class="concept-chip-check">&#10003;</span>
      </span>
    </div>

    <!-- Bottom action bar: context-sensitive -->
    <div v-if="showBottomBar" class="bottom-actions">
      <!-- idle / text_input / file_upload: chat action buttons -->
      <template v-if="chatMode === 'idle' || chatMode === 'text_input' || chatMode === 'file_upload' || chatMode === 'file_uploaded'">
        <div class="action-glass-host">
          <GlassWrapper
            interactive
            :pressed="isChatSunk"
            @click="toggleChat()"
          >
            <div class="action-inner">
              <span class="action-label">{{ $t('editor.chatGenerate') }}</span>
            </div>
          </GlassWrapper>
        </div>
        <div class="action-glass-host">
          <GlassWrapper
            interactive
            :pressed="isFileSunk"
            @click="startChatFile()"
          >
            <div class="action-inner">
              <span class="action-label">{{ $t('editor.fileImport') }}</span>
            </div>
          </GlassWrapper>
        </div>
      </template>

      <!-- conversing: chat controls -->
      <template v-else-if="chatMode === 'conversing'">
        <div class="action-glass-host">
          <GlassWrapper interactive :disabled="isBusy" @click="onRegenerate">
            <div class="action-inner">
              <span class="action-label">{{ $t('editor.regenerate') }}</span>
            </div>
          </GlassWrapper>
        </div>
        <div class="action-glass-host">
          <GlassWrapper interactive :disabled="isBusy" @click="onMarkConcept">
            <div class="action-inner">
              <span class="action-label">{{ $t('editor.markConcept') }}</span>
            </div>
          </GlassWrapper>
        </div>
        <div class="action-glass-host">
          <GlassWrapper interactive @click="toggleChat()">
            <div class="action-inner">
              <span class="action-label">{{ $t('editor.exitChat') }}</span>
            </div>
          </GlassWrapper>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, computed, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import FileUploadArea from '../ai/FileUploadArea.vue';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeChat } from '../../composables/useNodeChat';
import { usePageTransition } from '../../composables/usePageTransition';
import type { Editor, JSONContent } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Mathematics, mathMigrationRegex, migrateMathStrings } from '@tiptap/extension-mathematics';
import { Markdown } from '@tiptap/markdown';
import type { MarkdownManager } from '@tiptap/markdown';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { all, createLowlight } from 'lowlight';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import katex from 'katex';
import { useNodeStore } from '../../stores/nodeStore';
import type { TreeNode } from '../../types/node';
import { CodeBlockWithUi } from './extensions/codeBlockWithUi';
import { MarkdownBold, MarkdownItalic, MarkdownStrike } from './extensions/markdownInputRules';
import { AUTO_SAVE_DELAY_MS } from '../../constants/app';
import { apiFetch } from '../../utils/api';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';
import 'highlight.js/styles/github.css';

/**
 * Custom extension that handles 'table' tokens from marked's lexer (when gfm: true).
 * @tiptap/markdown doesn't have a built-in handler for table tokens — its
 * parseFallbackToken drops them. This handler converts marked table tokens
 * directly to TipTap table/tableRow/tableHeader/tableCell JSON without going
 * through generateJSON (which would fail when paragraph is disabled in StarterKit).
 */
const TableMarkdownParser = Extension.create({
  name: 'tableMarkdownParser',
  // These extension fields are read by @tiptap/markdown's MarkdownManager.registerExtension
  markdownTokenName: 'table',
  parseMarkdown: (token: any, helpers: any) => {
    const headerRow: any[] = token.header || [];
    const bodyRows: any[][] = token.rows || [];

    const allRows: any[] = [];

    // Header row
    if (headerRow.length > 0) {
      const headerCells = headerRow.map((cell: any) => ({
        type: 'tableHeader',
        attrs: { colspan: 1, rowspan: 1, colwidth: null, align: cell.align ?? null },
        content: [{
          type: 'paragraph',
          content: helpers.parseInline(cell.tokens || []),
        }],
      }));
      allRows.push({ type: 'tableRow', content: headerCells });
    }

    // Body rows (skip the separator row which is row index 0 after header;
    // marked already filtered out the separator, so bodyRows are the actual data rows)
    for (const row of bodyRows) {
      const cells = row.map((cell: any) => ({
        type: 'tableCell',
        attrs: { colspan: 1, rowspan: 1, colwidth: null, align: cell.align ?? null },
        content: [{
          type: 'paragraph',
          content: helpers.parseInline(cell.tokens || []),
        }],
      }));
      allRows.push({ type: 'tableRow', content: cells });
    }

    return { type: 'table', content: allRows };
  },
});

interface UploadedFile {
  file_id: string;
  filename: string;
  size: number;
  extension: string;
  text_length: number;
  text_preview: string;
  formatted_text?: string;
  ocr_applied?: boolean;
  ocr_reason?: string | null;
  ocr_status?: string;
  total_pages?: number;
}
import 'katex/dist/katex.min.css';

const PROSEMIRROR_SLICE_MIME = 'application/x-prosemirror-slice';
const CHAT_PROMPT_TEXT = '想聊点啥？主动换行可以给我发送消息。我会基于我们的聊天记录来填充这个知识点的内容，当然，之后你也可以把我填充的内容剪切到其他知识点中，随你喜欢。';

const store = useNodeStore();
const { activeNode, pathNodes, childNodes, treeNodes } = storeToRefs(store);
const { t } = useI18n();
const lowlight = createLowlight(all);
const {
  setEditor,
  mode: chatMode,
  isBusy,
  isCompleted,
  errorMessage,
  messages,
  currentSubTopic,
  totalKp,
  currentKpIndex,
  exitChat,
  resumeOrStartChat,
  setFileMode,
  resetForNewNode,
  setNodeId,
  hasResumableSession,
  sessionId,
  startTextChat: doStartTextChat,
  startContextualChat: doStartContextualChat,
  startLineByLineChat: doStartLineByLine,
  sendMessage,
  skipTurn,
  endConversation,
  regenerateWithTreeContext,
  markConcept,
  compressAndClear,
  recordNavigationTransition,
  mentionedConcepts,
  markedConceptNames,
} = useNodeChat();

const hasUserEdited = ref(false);
const isChatSunk = ref(false);
const isFileSunk = ref(false);
const isAnimating = ref(false);

const isMarkdownLikeContent = computed(() => {
  const content = activeNode.value?.content ?? '';
  return /(^|\n)\s{0,3}#{1,6}\s|(^|\n)\s{0,3}>\s|(^|\n)\s*\|.+\|\s*$|```|\$\$[\s\S]+?\$\$|(?<!\\)\$(?![\s\d])(?:\\.|[^$\\\n])+?(?<!\\)\$/m.test(content);
});

const showMarkdownRenderedContent = computed(() => chatMode.value === 'idle' && isMarkdownLikeContent.value);

function renderMathInMarkdown(source: string): string {
  const mathBlocks: string[] = [];
  const placeholderPrefix = 'ACACIA_RENDER_MATH_';
  let index = 0;

  function stashMath(match: string, displayMode: boolean): string {
    const raw = displayMode ? match.slice(2, -2) : match.slice(1, -1);
    let html = '';
    try {
      html = katex.renderToString(raw.trim(), {
        displayMode,
        throwOnError: false,
        strict: false,
        trust: false,
      });
    } catch {
      html = `<code>${escapeHtml(match)}</code>`;
    }
    const placeholder = `${placeholderPrefix}${index}__`;
    mathBlocks.push(html);
    index += 1;
    return placeholder;
  }

  return source
    .replace(/\$\$([\s\S]+?)\$\$/g, (match) => stashMath(match, true))
    .replace(/(?<!\\)\$(?![\s\d])(?:\\.|[^$\\\n])+?(?<!\\)\$/g, (match) => stashMath(match, false))
    .replace(new RegExp(`${placeholderPrefix}(\\d+)__`, 'g'), (_match, i) => mathBlocks[Number(i)] ?? '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const renderedMarkdown = computed(() => {
  const html = marked.parse(renderMathInMarkdown(activeNode.value?.content ?? ''), {
    gfm: true,
    breaks: true,
  });
  return DOMPurify.sanitize(String(html), {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'mtext', 'annotation'],
    ADD_ATTR: ['xmlns', 'encoding', 'class', 'style', 'aria-hidden'],
  });
});

const currentNodePath = computed(() => {
  if (!activeNode.value) return '';
  return [...pathNodes.value.map((node) => node.name), activeNode.value.name].join(' / ');
});

const sameNameNodePaths = computed(() => {
  if (!activeNode.value) return [];

  const activeName = activeNode.value.name.trim();
  const paths: string[] = [];
  const visited = new Set<string>();

  function walk(nodes: TreeNode[], ancestors: string[]): void {
    for (const node of nodes) {
      const nodePathParts = [...ancestors, node.name];
      if (node.name.trim() === activeName && !visited.has(node.id)) {
        paths.push(nodePathParts.join(' / '));
        visited.add(node.id);
      }
      walk(node.children, nodePathParts);
    }
  }

  walk(treeNodes.value, []);

  if (paths.length === 0 && currentNodePath.value) {
    paths.push(currentNodePath.value);
  }

  return paths;
});

async function refreshSameNameTree(): Promise<void> {
  try {
    await store.refreshTree();
  } catch (error) {
    console.error('[MarkdownEditor] Failed to refresh tree for same-name paths:', error);
  }
}
const userInput = ref('');
const pendingFile = ref<UploadedFile | null>(null);
const lastActiveNodeId = ref<string | null>(null);

function getChatPromptText(): string {
  return t('editor.chatPrompt');
}

const LockedParagraphAttr = Extension.create({
  name: 'lockedParagraphAttr',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          locked: {
            default: null,
            parseHTML: element => element.getAttribute('data-locked'),
            renderHTML: attributes => {
              if (attributes.locked != null) {
                return { 'data-locked': attributes.locked };
              }
              return {};
            },
          },
        },
      },
    ];
  },
});


const showBottomBar = computed(() => true);

// @deprecated 仅被下方废弃的 conversing textarea 模式使用，当前交互走 sendInlineMessage()
const canSend = computed(() => userInput.value.trim().length > 0);

const progressPercent = computed(() => {
  if (totalKp.value <= 1) return 100;
  if (isCompleted.value) return 100;
  return Math.round((currentKpIndex.value / totalKp.value) * 100);
});

// ── Chat toggle ──────────────────────────────────────────────────────

const SINK_DURATION_MS = 240;

function getMarkdownManager(instance: Editor): MarkdownManager | null {
  return instance.markdown ?? instance.storage?.markdown?.manager ?? null;
}

/**
 * Protect math HTML tags from angle-bracket escaping so they survive round-trip
 * serialization (getMarkdown → save → re-parse). Returns the placeholder-protected
 * string + a restore function.
 */
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
 * Escape all < as &lt; so marked doesn't treat text-in-angle-brackets as HTML tags.
 * Without this, content like <中文> or <**bold** text> creates invalid nodes.
 * Math HTML tags (generated by protectMathDollarSyntax) are protected from escaping.
 */
function escapeNonHtmlAngleBrackets(text: string): string {
  const { protected: processed, restore } = protectMathHtmlTags(text);
  return restore(processed.replace(/</g, '&lt;'));
}

/**
 * Recursively strip nodes whose type doesn't exist in the editor schema.
 */
function stripUnknownNodes(json: JSONContent, schema: Editor['schema']): JSONContent | null {
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
const INLINE_NODE_TYPES = new Set(['text', 'hardBreak', 'image', 'inlineMath', 'mention']);

/** Block nodes whose content model requires paragraphs, not raw inline nodes. */
const BLOCK_WRAPPER_TYPES = new Set(['listItem', 'blockquote', 'doc']);

/**
 * Wrap bare inline nodes (text, hardBreak, etc.) in paragraphs inside
 * block containers (listItem, blockquote) that require paragraph children.
 */
function wrapBareInlineContent(json: JSONContent): JSONContent {
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

/**
 * Workaround for @tiptap/markdown bug: ordered lists corrupt parser state making
 * all subsequent heading content empty. For each empty heading, find its text from
 * the original markdown and re-parse it in isolation (standalone headings aren't
 * affected by the ordered-list bug since there's no list before them).
 */
function repairEmptyHeadings(json: JSONContent, mgr: MarkdownManager, rawContent: string): void {
  if (!json.content || json.type !== 'doc') return;

  // Index headings in the raw content by extracting heading lines
  const rawHeadings: { level: number; text: string }[] = [];
  const headingRe = /^(#{1,6})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(rawContent)) !== null) {
    rawHeadings.push({ level: (m[1] ?? '').length, text: (m[2] ?? '').trim() });
  }

  let headingIdx = 0;
  for (const node of json.content) {
    if (node.type !== 'heading') continue;
    const h = node as JSONContent & { attrs?: { level?: number }; content?: JSONContent[] };

    // Only repair truly empty headings (content is [] or missing)
    if (h.content && h.content.length > 0) {
      headingIdx++;
      continue;
    }

    // Find the corresponding raw heading text
    const rawH = rawHeadings[headingIdx];
    if (rawH && rawH.level === (h.attrs?.level ?? 1)) {
      // Re-parse this heading in isolation to get proper inline content
      const prefix = '#'.repeat(rawH.level);
      try {
        const reparsed = mgr.parse(`${prefix} ${rawH.text}`);
        const reparsedHeading = reparsed.content?.find(n => n.type === 'heading');
        if (reparsedHeading?.content) {
          h.content = reparsedHeading.content;
        }
      } catch {
        console.error('[MarkdownEditor] heading reparse failed for:', rawH.text);
        // Fallback: plain text node
        h.content = [{ type: 'text', text: rawH.text }];
      }
    }
    headingIdx++;
  }
}

function parseMarkdownContent(instance: Editor, content: string): JSONContent | null {
  const mgr = getMarkdownManager(instance);
  if (!mgr) return null;
  try {
    // Strip control characters that would break HTML/XML parsing
    content = sanitizeControlChars(content);
    // Convert ALL $$...$$ to $...$ to prevent blockMath-in-listItem errors.
    // ProseMirror schema forbids blockMath as a child of listItem, and the
    // block-math tokenizer produces blockMath nodes that fail validation inside
    // list items. The AI is told to use $...$ for all math, so $$ usage is rare.
    content = content.replace(/\$\$([\s\S]+?)\$\$/g, (_full, latex: string) => {
      return `$${latex.trim()}$`;
    });
    // Protect $...$ / $$...$$ math syntax from angle-bracket escaping so
    // that < inside LaTeX (e.g. $x < y$) is preserved. The custom
    // markdownTokenizer on the Mathematics extension handles these directly.
    const mathProtected = protectMathDollarSyntax(content);
    // Escape unprotected < to &lt; so marked doesn't treat text like <中文> as HTML.
    // Math HTML tags (from old saved content) are also protected from escaping.
    const htmlSafe = escapeNonHtmlAngleBrackets(mathProtected.protected);
    // Restore $...$ / $$...$$ math syntax so the custom tokenizer can parse it
    const finalContent = mathProtected.restore(htmlSafe);
    // Table tokens are handled by TableMarkdownParser (custom extension registered
    // on the editor). marked's gfm:true produces 'table' tokens; the extension
    // converts them directly to TipTap JSON without going through generateJSON.
    const parsed = mgr.parse(finalContent);

    // Strip nodes with unknown types, then wrap bare inline nodes in paragraphs
    const stripped = stripUnknownNodes(parsed, instance.schema) ?? parsed;
    const sanitized = wrapBareInlineContent(stripped);

    // Workaround for @tiptap/markdown bug: ordered lists corrupt parser state,
    // making all subsequent heading content empty. Repair by re-parsing each
    // empty heading's text from the original markdown content.
    repairEmptyHeadings(sanitized, mgr, content);

    instance.schema.nodeFromJSON(sanitized).check();
    return sanitized;
  } catch (err) {
    console.error('[MarkdownEditor] parseMarkdownContent failed:', err, 'content preview:', content.slice(0, 200));
    return null;
  }
}

/**
 * Pre-process markdown text to protect $...$ / $$...$$ math syntax from
 * angle-bracket escaping. Unlike the old approach (converting to HTML tags
 * and relying on generateJSON's parseHTML), we keep the original $ syntax
 * so that the Mathematics extension's custom markdownTokenizer can parse
 * math directly. This avoids the fragile HTML round-trip through
 * parseHTMLToken → generateJSON → baseExtensions.
 *
 * The placeholder approach ensures that < inside LaTeX (e.g. $x < y$)
 * survives escapeNonHtmlAngleBrackets intact.
 */
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

function startChatText() {
  chatMode.value = 'text_input';
  if (editor.value) {
    isApplyingExternalContent.value = true;
    editor.value.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { locked: 'true' },
          content: [{ type: 'text', text: getChatPromptText() }],
        },
        { type: 'paragraph' },
      ],
    }, { emitUpdate: false });
    const docSize = editor.value.state.doc.content.size;
    editor.value.commands.setTextSelection(docSize);
    editor.value.commands.focus();
    isApplyingExternalContent.value = false;
  }
}

function getLastInputParagraphText(): string {
  if (!editor.value) return '';
  let lastText = '';
  editor.value.state.doc.descendants((node) => {
    if (node.type.name === 'paragraph' && !node.attrs.locked) {
      lastText = node.textContent;
    }
  });
  return lastText.trim();
}

function makeAllParagraphsNonEditable(node: JSONContent) {
  if (node.type === 'paragraph') {
    node.attrs = { ...(node.attrs || {}), locked: 'true' };
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      makeAllParagraphsNonEditable(child);
    }
  }
}

function pushLockedParsedNodes(content: JSONContent[], parsed: JSONContent | null) {
  if (parsed && Array.isArray(parsed.content)) {
    for (const node of parsed.content) {
      makeAllParagraphsNonEditable(node);
      content.push(node);
    }
    return true;
  }
  return false;
}

function pushLockedSeparator(content: JSONContent[]) {
  const parsed = editor.value ? parseMarkdownContent(editor.value, '---') : null;
  if (!pushLockedParsedNodes(content, parsed)) {
    content.push({
      type: 'paragraph',
      attrs: { locked: 'true' },
      content: [{ type: 'text', text: '---' }],
    });
  }
}

function buildInlineChatDoc(pendingUserMsg?: string): JSONContent {
  const content: JSONContent[] = [];

  // Prompt paragraph
  content.push({
    type: 'paragraph',
    attrs: { locked: 'true' },
    content: [{ type: 'text', text: CHAT_PROMPT_TEXT }],
  });

  // Message history
  const msgs = messages.value;
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    if (!msg) continue;
    const prefix = msg.role === 'ai' ? '**AI**: ' : '**你**: ';
    const mdText = prefix + msg.content;

    const parsed = editor.value ? parseMarkdownContent(editor.value, mdText) : null;
    if (!pushLockedParsedNodes(content, parsed)) {
      content.push({
        type: 'paragraph',
        attrs: { locked: 'true' },
        content: [{ type: 'text', text: mdText }],
      });
    }

    // Separator between messages or before pending
    if (i < msgs.length - 1 || pendingUserMsg) {
      pushLockedSeparator(content);
    }
  }

  // Pending user message
  if (pendingUserMsg) {
    const parsed = editor.value ? parseMarkdownContent(editor.value, '**你**: ' + pendingUserMsg) : null;
    if (!pushLockedParsedNodes(content, parsed)) {
      content.push({
        type: 'paragraph',
        attrs: { locked: 'true' },
        content: [{ type: 'text', text: '**你**: ' + pendingUserMsg }],
      });
    }
    pushLockedSeparator(content);

    // "让我思考一下" placeholder
    if (isBusy.value) {
      content.push({
        type: 'paragraph',
        attrs: { locked: 'true' },
        content: [{ type: 'text', text: t('editor.thinking') }],
      });
    }
  }

  // Empty input paragraph (always last, always editable)
  content.push({ type: 'paragraph' });

  return { type: 'doc', content };
}

function applyInlineChatDoc(doc: JSONContent) {
  if (!editor.value) return;
  isApplyingExternalContent.value = true;
  editor.value.commands.setContent(doc, { emitUpdate: false });
  const docSize = editor.value.state.doc.content.size;
  editor.value.commands.setTextSelection(docSize);
  editor.value.commands.focus();
  isApplyingExternalContent.value = false;

  nextTick(() => {
    const scrollEl = editorRef.value?.querySelector('.activity-scroll');
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  });
}

async function appendKnowledgeNote(note: string): Promise<void> {
  if (!activeNode.value || !note.trim()) return;
  const nodeId = activeNode.value.id;
  const currentContent = activeNode.value.content || '';
  const newContent = currentContent
    ? currentContent + '\n\n' + note
    : note;
  try {
    await store.saveActiveNodeContent(nodeId, newContent);
    lastSavedContent.value = newContent;
    draft.value = newContent;
    if (activeNode.value) {
      activeNode.value.content = newContent;
    }
  } catch {
    console.error('[MarkdownEditor] autoSave failed');
  }
}

async function sendInlineMessage() {
  if (chatMode.value !== 'text_input' || !editor.value || !activeNode.value) return;
  if (isBusy.value) return;

  const msg = getLastInputParagraphText();
  if (!msg) return;

  if (msg === '/clear') {
    await compressAndClear();
    // Reset editor to fresh chat prompt state, not exit to node content
    startChatText();
    return;
  }

  const isFirstMessage = !sessionId.value;

  try {
    // Show pending state immediately
    applyInlineChatDoc(buildInlineChatDoc(msg));

    if (isFirstMessage) {
      const result = await doStartTextChat(activeNode.value.id, activeNode.value.name, msg);
      // startTextChat overwrites messages with only AI response, prepend user msg
      messages.value = [
        { role: 'user' as const, content: msg },
        ...messages.value,
      ];
      if (result?.knowledge_note) {
        await appendKnowledgeNote(result.knowledge_note);
      }
    } else {
      const result = await sendMessage(msg, { skipInsertContent: true });
      if (result?.knowledge_note) {
        await appendKnowledgeNote(result.knowledge_note);
      }
      // Auto-end: replace incremental appends with LLM-consolidated content
      if (result?.consolidated_content && activeNode.value) {
        try {
          await store.saveActiveNodeContent(activeNode.value.id, result.consolidated_content);
          lastSavedContent.value = result.consolidated_content;
          draft.value = result.consolidated_content;
          if (activeNode.value) {
            activeNode.value.content = result.consolidated_content;
          }
        } catch {
          console.error('[MarkdownEditor] saveActiveNodeContent failed during sendInlineMessage consolidation');
        }
      }
    }

    // Revert mode from 'conversing' back to 'text_input'
    chatMode.value = 'text_input';

    // Rebuild with final data
    applyInlineChatDoc(buildInlineChatDoc());

  } catch {
    console.error('[MarkdownEditor] sendInlineMessage failed');
    chatMode.value = 'text_input';
    applyInlineChatDoc(buildInlineChatDoc());
  }
}

function rebuildTranscriptFromMessages() {
  if (!editor.value) return;
  const msgs = messages.value;
  if (msgs.length === 0) return;
  const md = msgs
    .map(m => m.role === 'ai' ? `**AI**: ${m.content}` : `**你**: ${m.content}`)
    .join('\n\n---\n\n');
  isApplyingExternalContent.value = true;
  const parsed = parseMarkdownContent(editor.value, md);
  if (parsed) {
    editor.value.commands.setContent(parsed, { emitUpdate: false });
  }
  isApplyingExternalContent.value = false;
}

// ── @deprecated conversing textarea 模式专用函数 ──────────────────
// 当前交互流程始终走 text_input 内联模式 (sendInlineMessage)。
// 修改 AI 对话功能时请改 sendInlineMessage()，不要在这里改。
async function sendAnswer() {
  if (!canSend.value || isBusy.value || isCompleted.value) return;
  const answer = userInput.value.trim();
  userInput.value = '';

  if (answer === '/clear') {
    await compressAndClear();
    startChatText();
    return;
  }
  const result = await sendMessage(answer);
  if (result) {
    rebuildTranscriptFromMessages();
  }
}

async function onSkipTurn() {
  if (isBusy.value || isCompleted.value) return;
  const result = await skipTurn();
  if (result) {
    rebuildTranscriptFromMessages();
  }
}

async function onEndConversation() {
  if (isBusy.value || isCompleted.value) return;
  const result = await endConversation();
  if (result) {
    rebuildTranscriptFromMessages();
    // Replace incremental knowledge_note appends with LLM-consolidated version
    if (result.consolidated_content && activeNode.value) {
      try {
        await store.saveActiveNodeContent(activeNode.value.id, result.consolidated_content);
        lastSavedContent.value = result.consolidated_content;
        draft.value = result.consolidated_content;
        if (activeNode.value) {
          activeNode.value.content = result.consolidated_content;
        }
      } catch {
        console.error('[MarkdownEditor] saveActiveNodeContent failed during onEndConversation');
      }
    }
  }
}

async function onRegenerate() {
  if (isBusy.value || !activeNode.value) return;
  const treeCtx = buildTreeContext();
  const result = await regenerateWithTreeContext(treeCtx);
  if (result) {
    rebuildTranscriptFromMessages();
  }
}

async function onMarkConcept() {
  if (isBusy.value) return;
  const name = window.prompt(t('editor.conceptNamePrompt'));
  if (!name || !name.trim()) return;
  const result = await markConcept(name.trim());
  if (result) {
    rebuildTranscriptFromMessages();
    await store.loadNode(activeNode.value?.id || '');
    // Record transition for context chain
    recordNavigationTransition(
      activeNode.value?.id || null,
      result.node_id,
      `在学习「${activeNode.value?.name || '未知'}」时标记了概念「${name.trim()}」`
    );
  }
}

async function onConceptClick(conceptName: string) {
  if (isBusy.value || markedConceptNames.value.has(conceptName)) return;
  // Check if concept already exists as a child node in the tree
  const existingChildNames = new Set((childNodes.value || []).map(n => n.name));
  if (existingChildNames.has(conceptName)) {
    markedConceptNames.value = new Set([...markedConceptNames.value, conceptName]);
    return;
  }
  const result = await markConcept(conceptName);
  if (result) {
    await store.loadNode(activeNode.value?.id || '');
    recordNavigationTransition(
      activeNode.value?.id || null,
      result.node_id,
      `在学习「${activeNode.value?.name || '未知'}」时标记了概念「${conceptName}」`
    );
  }
}

function buildTreeContext(): string {
  if (!activeNode.value) return '';
  const parts: string[] = [];
  const path = pathNodes.value || [];
  if (path.length > 0) {
    parts.push('知识路径: ' + path.map(n => n.name).join(' → '));
  }
  parts.push('当前知识点: ' + activeNode.value.name);
  const children = childNodes.value || [];
  if (children.length > 0) {
    parts.push('子知识点: ' + children.map(n => n.name).join(', '));
  }
  return parts.join('\n');
}

function onCinemaChatMode() {
  if (chatMode.value === 'idle') {
    toggleChat();
  }
}

async function toggleChat() {
  if (isAnimating.value) return;
  isAnimating.value = true;

  try {
    if (chatMode.value !== 'idle') {
      // @removed: 退出时保存 generatedContent 到知识点的功能已废弃。
      // 现在每轮对话都通过 appendKnowledgeNote() 实时更新知识点内容，
      // 不再需要在退出时做一次性总结保存。
      // if (generatedContent.value && activeNode.value) {
      //   const currentContent = activeNode.value.content || '';
      //   const newContent = currentContent
      //     ? currentContent + '\n\n' + generatedContent.value
      //     : generatedContent.value;
      //   try {
      //     await store.saveActiveNodeContent(activeNode.value.id, newContent);
      //     lastSavedContent.value = newContent;
      //     draft.value = newContent;
      //     generatedContent.value = '';
      //   } catch { /* save failed, discard */ }
      // }
      exitChat();
      isChatSunk.value = false;
      isFileSunk.value = false;
      userInput.value = '';
      pendingFile.value = null;
      if (activeNode.value && editor.value) {
        syncEditorContent(activeNode.value.content || '');
      }
    } else {
      // Open: sink button first, then start
      isChatSunk.value = true;
      await new Promise(r => setTimeout(r, SINK_DURATION_MS));
      const resumed = await resumeOrStartChat();
      if (!resumed) {
        // New chat: use contextual start with adaptive opening
        if (activeNode.value) {
          const prevId = lastActiveNodeId.value;
          const transType = prevId ? 'navigation' : 'initial';
          try {
            await doStartContextualChat(
              activeNode.value.id,
              activeNode.value.name,
              '',
              prevId,
              transType,
              ''
            );
            chatMode.value = 'text_input';
            applyInlineChatDoc(buildInlineChatDoc());
          } catch {
            console.error('[MarkdownEditor] doStartContextualChat failed, falling back to text mode');
            // Fallback to simple text mode on failure
            startChatText();
          }
        } else {
          startChatText();
        }
      } else {
        chatMode.value = 'text_input';
        applyInlineChatDoc(buildInlineChatDoc());
      }
    }
  } finally {
    isAnimating.value = false;
  }
}

async function startChatFile() {
  if (isAnimating.value) return;
  isAnimating.value = true;

  // Toggle: if already in file mode, restore to idle
  if (chatMode.value === 'file_upload' || chatMode.value === 'file_uploaded') {
    isFileSunk.value = false;
    pendingFile.value = null;
    chatMode.value = 'idle';
    isAnimating.value = false;
    return;
  }

  isFileSunk.value = true;
  await new Promise(r => setTimeout(r, SINK_DURATION_MS));
  setFileMode();
  isAnimating.value = false;
}

// @deprecated 仅被上方废弃的 conversing textarea 的 @keydown 使用
function onConvKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && event.ctrlKey) {
    event.preventDefault();
    sendAnswer();
  }
}

function onFileUploaded(file: UploadedFile) {
  pendingFile.value = file;
}

function onFileRemoved() {
  pendingFile.value = null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function fillContentFromFile() {
  if (!pendingFile.value || !activeNode.value) return;
  isBusy.value = true;
  errorMessage.value = '';
  try {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:7860';

    // Use pipeline-formatted text directly (already processed during upload)
    let fullText = pendingFile.value.formatted_text || '';

    if (!fullText.trim()) {
      errorMessage.value = t('editor.emptyContentWarning');
      return;
    }

    // Rewrite image URLs to absolute backend URLs so they load in the editor
    fullText = fullText.replace(/\/file-images\//g, `${backendUrl}/file-images/`);

    await store.saveActiveNodeContent(activeNode.value.id, fullText);
    lastSavedContent.value = fullText;
    draft.value = fullText;
    if (activeNode.value) {
      activeNode.value.content = fullText;
    }
    syncEditorContent(fullText);
    // Clean up temp files on server after file content is consumed
    if (pendingFile.value?.file_id) {
      apiFetch('/cleanup-file', {
        method: 'POST',
        body: JSON.stringify({ file_id: pendingFile.value.file_id }),
      }).catch(() => { /* fire-and-forget */ });
    }
    // Exit back to idle
    chatMode.value = 'idle';
    pendingFile.value = null;
    isFileSunk.value = false;
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : t('editor.fillContentFailed');
  } finally {
    isBusy.value = false;
  }
}

async function startLineByLineChat() {
  if (!pendingFile.value || !activeNode.value) return;
  isBusy.value = true;
  errorMessage.value = '';
  try {
    const prevId = lastActiveNodeId.value;
    const transType = prevId ? 'navigation' : 'initial';
    await doStartLineByLine(
      activeNode.value.id,
      activeNode.value.name,
      pendingFile.value.file_id,
      pendingFile.value.filename,
      prevId,
      transType,
      ''
    );
    pendingFile.value = null;
    isFileSunk.value = false;
    isChatSunk.value = true;
    chatMode.value = 'text_input';
    applyInlineChatDoc(buildInlineChatDoc());
  } catch (e) {
    console.error('[MarkdownEditor] resumeOrStartChat contextual start failed:', e);
  } finally {
    isBusy.value = false;
  }
}

function cancelFileUpload() {
  pendingFile.value = null;
  chatMode.value = 'idle';
  isFileSunk.value = false;
}

// Watch for file_upload mode with a pending file — switch to choice UI
watch(pendingFile, async (file) => {
  if (file && chatMode.value === 'file_upload' && activeNode.value) {
    chatMode.value = 'file_uploaded';
  }
});

const { registerRegion, unregisterRegion } = usePageTransition();
const editorRef = ref<HTMLElement | null>(null);

const draft = ref('');
const lastSavedContent = ref('');
const isApplyingExternalContent = ref(false);
const isMigratingMath = ref(false);

// ── Locked node plugin ─────────────────────────────────────────────

function isPositionInLockedNode(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos);
  return $pos.parent.attrs?.locked ?? false;
}

const lockedNodePluginKey = new PluginKey('lockedNodes');
const lockedNodePlugin = new Plugin({
  key: lockedNodePluginKey,
  props: {
    handleClick(view, pos) {
      if (chatMode.value !== 'text_input') return false;
      // Redirect clicks inside locked nodes to the editable area
      if (isPositionInLockedNode(view.state, pos)) {
        const docSize = view.state.doc.content.size;
        const tr = view.state.tr;
        tr.setSelection(TextSelection.create(view.state.doc, docSize));
        view.dispatch(tr);
        view.focus();
        return true;
      }
      return false;
    },
    handleTextInput(view, from, _to, text) {
      if (chatMode.value !== 'text_input') return false;
      // Block typing inside locked nodes - redirect to end of editable area
      if (isPositionInLockedNode(view.state, from)) {
        const docSize = view.state.doc.content.size;
        const tr = view.state.tr;
        tr.setSelection(TextSelection.create(view.state.doc, docSize));
        tr.insertText(text);
        view.dispatch(tr);
        return true;
      }
      return false;
    },
  },
  filterTransaction(tr, state) {
    if (!tr.docChanged) return true;
    if (isApplyingExternalContent.value) return true;

    const lockedRanges: {from: number, to: number}[] = [];
    state.doc.descendants((node, pos) => {
      if (node.attrs?.locked) {
        lockedRanges.push({from: pos, to: pos + node.nodeSize});
      }
    });

    if (lockedRanges.length === 0) return true;

    for (const step of tr.steps) {
      const map = step.getMap();
      let blocked = false;
      map.forEach((oldStart: number, oldEnd: number, newStart: number, newEnd: number) => {
        if (blocked) return;
        for (const range of lockedRanges) {
          if (oldStart < range.to && oldEnd > range.from) { blocked = true; return; }
          if (newStart < range.to && newEnd > range.from) { blocked = true; return; }
        }
      });
      if (blocked) return false;
    }

    return true;
  },
});

const LockedNodes = Extension.create({
  name: 'lockedNodes',
  addProseMirrorPlugins() {
    return [lockedNodePlugin];
  },
});

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
    .replace(/[​-‍﻿]/g, '')
    .replace(/ /g, ' ');
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
  return parseMarkdownContent(instance, content);
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
  if (!editor.value) return;

  const normalized = normalizePastedText(content);

  // Empty content: set an empty doc directly, skip the markdown parser
  if (!normalized) {
    isApplyingExternalContent.value = true;
    editor.value.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }, {
      emitUpdate: false,
    });
    isApplyingExternalContent.value = false;
    return;
  }

  const source = sanitizeMarkdownSource(normalized);
  const parsedDoc = parseMarkdownDoc(editor.value, source);

  isApplyingExternalContent.value = true;
  editor.value.commands.setContent(parsedDoc ?? buildPlainTextDoc(source), {
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
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
        },
      },
    }),
    LockedParagraphAttr,
    Markdown.configure({
      markedOptions: {
        gfm: true,
        breaks: true,
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
        strict: false,
        trust: false,
      },
    }),
    Table.configure({
      resizable: false,
      HTMLAttributes: {
        class: 'md-table',
      },
    }),
    TableRow,
    TableCell,
    TableHeader,
    TableMarkdownParser,
    LockedNodes,
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
      keydown: (_view, event) => {
        if (!(event instanceof KeyboardEvent)) return false;
        if (chatMode.value !== 'text_input') return false;
        if (isBusy.value) return false;
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          sendInlineMessage();
          return true;
        }
        // Prevent backspace from deleting into locked nodes
        if (event.key === 'Backspace') {
          const { state } = _view;
          const { from, to } = state.selection;
          if (from !== to) return false; // let filterTransaction handle selections
          const $pos = state.doc.resolve(from);
          // At start of paragraph with locked node before it
          if ($pos.parentOffset === 0 && ($pos.nodeBefore?.attrs?.locked ?? false)) {
            event.preventDefault();
            return true;
          }
          // In empty paragraph that follows a locked node
          if ($pos.parent.textContent === '' && ($pos.nodeBefore?.attrs?.locked ?? false)) {
            event.preventDefault();
            return true;
          }
        }
        return false;
      },
      click: (_view, event) => {
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

        if (!(event.ctrlKey || event.metaKey)) {
          return false;
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

    // Don't mark user-edited or auto-save during chat modes
    if (chatMode.value !== 'idle') {
      return;
    }

    if (!hasUserEdited.value && instance.state.doc.textContent.length > 0) {
      hasUserEdited.value = true;
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

onMounted(() => {
  registerRegion({
    id: 'content-editor',
    type: 'glass',
    element: editorRef,
    shouldShow: (state) => {
      return state.isAuthenticated &&
             state.activeNode !== null &&
             state.viewState === 'display';
    },
    parent: 'content',
  });

  window.addEventListener('cinema:chat-mode', onCinemaChatMode);
});

watch(
  [() => editor.value, () => activeNode.value?.id],
  (val, oldVal) => {
    clearAutoSaveTimer();
    saveInFlight = false;
    queuedContent = null;

    const content = activeNode.value?.content ?? '';
    lastSavedContent.value = content;
    draft.value = content;

    hasUserEdited.value = false;
    isChatSunk.value = false;
    isFileSunk.value = false;
    userInput.value = '';
    pendingFile.value = null;
    setEditor(editor.value || null);

    // Handle node switching: exit active chat, check if new node has resumable session
    const newId = val?.[1];
    const oldId = oldVal?.[1];
    if (newId !== oldId) {
      if (oldId) {
        lastActiveNodeId.value = oldId;
      }
      if (chatMode.value !== 'idle') {
        exitChat();
      }
      resetForNewNode();
      if (newId) {
        setNodeId(newId);
        if (hasResumableSession.value) {
          chatMode.value = 'idle';
        }
      }
      isMarkdownSourceMode.value = false;
    }

    if (activeNode.value && editor.value) {
      syncEditorContent(content);
    }

    if (activeNode.value) {
      void refreshSameNameTree();
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

  // Don't auto-save during chat modes
  if (chatMode.value !== 'idle') {
    return;
  }

  clearAutoSaveTimer();
  autoSaveTimer = window.setTimeout(() => {
    void enqueueSave(nodeId, value);
  }, AUTO_SAVE_DELAY_MS);
});

onBeforeUnmount(() => {
  unregisterRegion('content-editor');
  clearAutoSaveTimer();
  editor.value?.destroy();
  window.removeEventListener('cinema:chat-mode', onCinemaChatMode);
});
</script>

<style scoped>
.editor-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.activity-layout {
  flex: 1;
  min-height: 0;
}

.editor-input {
  width: 100%;
  min-height: 100%;
  padding: 12px 16px 14px;
}

.same-name-paths {
  margin: 16px 16px 8px;
  padding: 12px 14px;
  border: 1px solid var(--color-hint, rgba(102, 255, 229, 0.34));
  border-radius: 14px;
  background: color-mix(in srgb, var(--color-primary, #ffffff) 7%, transparent);
  color: var(--color-primary);
  user-select: text;
}

.same-name-paths-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-primary);
}

.same-name-paths-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.same-name-path {
  font-size: 12px;
  line-height: 1.45;
  color: var(--color-hint, rgba(102, 255, 229, 0.78));
  overflow-wrap: anywhere;
}

:global([data-theme-brightness='light']) .same-name-paths {
  background: color-mix(in srgb, var(--color-primary-on-light, var(--color-primary, #1f2937)) 7%, transparent);
  border-color: color-mix(in srgb, var(--color-hint-on-light, var(--color-hint, #2563eb)) 55%, transparent);
  color: var(--color-primary-on-light, var(--color-primary));
}

:global([data-theme-brightness='light']) .same-name-paths-title {
  color: var(--color-primary-on-light, var(--color-primary));
}

:global([data-theme-brightness='light']) .same-name-path {
  color: var(--color-hint-on-light, var(--color-hint));
}

:global([data-theme-brightness='dark']) .same-name-paths {
  background: color-mix(in srgb, var(--color-primary-on-dark, var(--color-primary, #ffffff)) 7%, transparent);
  border-color: color-mix(in srgb, var(--color-hint-on-dark, var(--color-hint, #66ffe5)) 55%, transparent);
  color: var(--color-primary-on-dark, var(--color-primary));
}

:global([data-theme-brightness='dark']) .same-name-paths-title {
  color: var(--color-primary-on-dark, var(--color-primary));
}

:global([data-theme-brightness='dark']) .same-name-path {
  color: var(--color-hint-on-dark, var(--color-hint));
}

.editor-input.editor-readonly {
  opacity: 0.72;
  pointer-events: none;
}

.markdown-preview {
  color: var(--color-primary);
}

.markdown-source-editor {
  min-height: 100%;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--color-primary);
  font: 14px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  white-space: pre-wrap;
}

.markdown-preview :deep(.katex-display) {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 4px 0;
}

.markdown-preview :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0 18px;
  font-size: 14px;
}

.markdown-preview :deep(th),
.markdown-preview :deep(td) {
  border: 1px solid var(--color-hint, rgba(102, 255, 229, 0.28));
  padding: 8px 10px;
  vertical-align: top;
}

.markdown-preview :deep(th) {
  font-weight: 700;
  background: rgba(102, 128, 255, 0.08);
}

.markdown-preview :deep(blockquote) {
  margin: 0 0 1em;
  padding: 8px 14px;
  border-left: 3px solid var(--color-hint, rgba(102, 255, 229, 0.54));
  color: var(--color-hint, rgba(102, 255, 229, 0.78));
}

.markdown-preview :deep(pre) {
  overflow-x: auto;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.72);
  color: #e5e7eb;
}

.markdown-preview :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}

/* ── Chat: file upload form ──────────────────────────────────────── */

.chat-input-form {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}

/* ── File uploaded choice UI ─────────────────────────────────────── */

.file-uploaded-choice {
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  height: 100%;
}

.choice-file-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  border-radius: 14px;
  background: rgba(102, 128, 255, 0.10);
  border: 1px solid rgba(102, 128, 255, 0.20);
}

.choice-file-icon {
  font-size: 28px;
}

.choice-file-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-primary);
}

.choice-file-size {
  font-size: 12px;
  color: var(--color-secondary);
}

.choice-prompt {
  font-size: 15px;
  color: var(--color-primary);
  font-weight: 500;
}

.choice-error {
  padding: 8px 14px;
  border-radius: 10px;
  background: rgba(255, 80, 80, 0.12);
  color: #c0392b;
  font-size: 13px;
  text-align: center;
}

.choice-actions {
  display: flex;
  gap: 1px;
  width: 100%;
}

.choice-glass {
  flex: 1;
  min-width: 0;
}

.choice-glass :deep(.glass) {
  cursor: pointer;
  transition: border-color 240ms ease, background 240ms ease;
}

.choice-glass:hover :deep(.glass) {
  border-color: var(--color-hint, rgba(102, 255, 229, 0.54));
}

.choice-glass:hover :deep(.glass-content) {
  background: rgba(255, 255, 255, 0.12);
}

.choice-inner {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 20px 12px;
  pointer-events: none;
}

.choice-label {
  font-size: 16px;
  font-weight: 700;
  color: var(--color-primary);
}

.choice-desc {
  font-size: 12px;
  color: var(--color-secondary);
  text-align: center;
}

.choice-cancel {
  border: none;
  background: transparent;
  color: var(--color-secondary);
  font-size: 13px;
  cursor: pointer;
  padding: 6px 14px;
  border-radius: 8px;
  transition: color 160ms ease, background 160ms ease;
}

.choice-cancel:hover {
  color: var(--color-primary);
  background: rgba(255, 255, 255, 0.08);
}

/* ── Chat: conversation input area ───────────────────────────────── */

.conversation-input-area {
  border-top: 1px solid rgba(102, 128, 255, 0.18);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.conv-progress {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.conv-progress-label {
  font-size: 12px;
  color: var(--color-secondary);
  font-weight: 600;
}

.conv-progress-topic {
  font-size: 11px;
  color: var(--color-hint, rgba(102, 255, 229, 0.54));
  margin-left: auto;
}

.conv-progress-track {
  width: 100%;
  height: 3px;
  border-radius: 2px;
  background: rgba(102, 128, 255, 0.12);
  overflow: hidden;
}

.conv-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--color-primary);
  transition: width 300ms ease;
}

.conv-progress-indeterminate {
  width: 30%;
  animation: conv-progress-slide 1.2s ease-in-out infinite;
}

@keyframes conv-progress-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(430%); }
}

.conv-textarea {
  width: 100%;
  border: 1px solid rgba(102, 128, 255, 0.24);
  border-radius: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.62);
  color: var(--color-primary);
  font-size: 14px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
  font-family: inherit;
}

.conv-textarea:focus {
  border-color: var(--color-hint, rgba(102, 255, 229, 0.54));
}

.conv-textarea:disabled {
  opacity: 0.5;
}

.conv-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.conv-btn {
  padding: 6px 14px;
  border: 1px solid rgba(102, 128, 255, 0.24);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.62);
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease;
}

.conv-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.85);
  border-color: var(--color-hint, rgba(102, 255, 229, 0.54));
}

.conv-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.conv-btn-send {
  background: rgba(102, 128, 255, 0.15);
  border-color: rgba(102, 128, 255, 0.35);
}

.conv-completed-banner {
  text-align: center;
  padding: 8px;
  font-size: 13px;
  color: var(--color-hint, rgba(102, 255, 229, 0.54));
  font-weight: 600;
}

/* ── Bottom actions ──────────────────────────────────────────────── */

.bottom-actions {
  display: flex;
  gap: 1px;
  flex: 0 0 54px;
}

.action-glass-host {
  flex: 1;
  min-width: 0;
}

.action-glass-host :deep(.glass) {
  cursor: pointer;
  transition: border-color 240ms ease, background 240ms ease;
}

.action-glass-host:hover :deep(.glass) {
  border-color: var(--color-hint, rgba(102, 255, 229, 0.54));
}

.action-glass-host:hover :deep(.glass-content) {
  background: rgba(255, 255, 255, 0.12);
}

.action-inner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  pointer-events: none;
}

.action-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-primary);
}

/* ── Editor prose ────────────────────────────────────────────────── */

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

.editor-input :deep(table.md-table) {
  width: 100%;
  margin: 0.4em 0 0.9em;
  border-collapse: collapse;
  font-size: 13px;
}

.editor-input :deep(.md-table th) {
  padding: 6px 10px;
  border: 1px solid rgba(102, 128, 255, 0.32);
  background: rgba(102, 128, 255, 0.10);
  font-weight: 700;
  text-align: left;
}

.editor-input :deep(.md-table td) {
  padding: 5px 10px;
  border: 1px solid rgba(102, 128, 255, 0.20);
}

.editor-input :deep(.md-table tr:nth-child(even) td) {
  background: rgba(102, 128, 255, 0.04);
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

.editor-input :deep([data-locked]) {
  cursor: default;
  user-select: text;
  -webkit-user-select: text;
}

/* ── Concept chips ───────────────────────────────────────────────── */

.concept-chips-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 16px 8px;
  flex-shrink: 0;
}

.concept-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 12px;
  border: 1px solid rgba(102, 128, 255, 0.28);
  background: rgba(102, 128, 255, 0.08);
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, opacity 160ms ease;
  user-select: none;
}

.concept-chip:hover {
  background: rgba(102, 128, 255, 0.18);
  border-color: var(--color-hint, rgba(102, 255, 229, 0.54));
}

.concept-chip-marked {
  opacity: 0.45;
  cursor: default;
  text-decoration: line-through;
}

.concept-chip-check {
  font-size: 11px;
  color: var(--color-hint, rgba(102, 255, 229, 0.54));
}

.concept-chip-verified {
  border-color: rgba(102, 200, 128, 0.45);
  background: rgba(102, 200, 128, 0.07);
}

.concept-chip-verified:hover {
  background: rgba(102, 200, 128, 0.16);
  border-color: rgba(102, 200, 128, 0.7);
}

.concept-chip-w-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: rgba(102, 200, 128, 0.22);
  color: #3a8;
  font-size: 9px;
  font-weight: 700;
  margin-right: 1px;
  flex-shrink: 0;
  line-height: 1;
}
</style>
