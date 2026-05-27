<template>
  <div ref="editorRef" class="editor-root">
    <!-- Single activity area: always visible -->
    <div class="activity-layout">
      <div class="activity-glass-host">
        <GlassWrapper>
          <div class="activity-scroll">
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
              <div class="choice-prompt">文件上传完成，请选择操作：</div>
              <div v-if="errorMessage" class="choice-error">{{ errorMessage }}</div>
              <div class="choice-actions">
                <div class="action-glass-host choice-glass">
                  <GlassWrapper
                    interactive
                    @click="fillContentFromFile()"
                  >
                    <div class="choice-inner">
                      <span class="choice-label">填入内容</span>
                      <span class="choice-desc">将文件原文一字不差地填入知识点</span>
                    </div>
                  </GlassWrapper>
                </div>
                <div class="action-glass-host choice-glass">
                  <GlassWrapper
                    interactive
                    @click="startLineByLineChat()"
                  >
                    <div class="choice-inner">
                      <span class="choice-label">开始讲解</span>
                      <span class="choice-desc">AI逐句逐词讲解文件内容</span>
                    </div>
                  </GlassWrapper>
                </div>
              </div>
              <button class="choice-cancel" @click="cancelFileUpload()">取消</button>
            </div>

            <!-- idle or conversing: editor + optional conversation controls -->
            <template v-else>
              <EditorContent
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
                      {{ isCompleted ? '对话已结束' : '对话进行中' }}
                    </template>
                    <template v-else>
                      第 {{ currentKpIndex + 1 }} / {{ totalKp }} 个知识点
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
                  placeholder="输入你的回答... (Ctrl+Enter 发送)"
                  :disabled="isBusy || isCompleted"
                  rows="3"
                  @keydown="onConvKeydown"
                />

                <div class="conv-actions">
                  <button
                    class="conv-btn conv-btn-skip"
                    :disabled="isBusy || isCompleted"
                    @click="onSkipTurn"
                  >跳过</button>
                  <button
                    class="conv-btn conv-btn-end"
                    :disabled="isBusy || isCompleted"
                    @click="onEndConversation"
                  >结束对话</button>
                  <button
                    class="conv-btn conv-btn-send"
                    :disabled="!canSend || isBusy || isCompleted"
                    @click="sendAnswer"
                  >
                    {{ isBusy ? '发送中...' : '发送' }}
                  </button>
                </div>

                <div v-if="isCompleted" class="conv-completed-banner">
                  对话已结束，点击下方"退出对话"保存生成内容。
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
              <span class="action-label">对话生成</span>
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
              <span class="action-label">文件导入</span>
            </div>
          </GlassWrapper>
        </div>
      </template>

      <!-- conversing: chat controls -->
      <template v-else-if="chatMode === 'conversing'">
        <div class="action-glass-host">
          <GlassWrapper interactive :disabled="isBusy" @click="onRegenerate">
            <div class="action-inner">
              <span class="action-label">重新生成</span>
            </div>
          </GlassWrapper>
        </div>
        <div class="action-glass-host">
          <GlassWrapper interactive :disabled="isBusy" @click="onMarkConcept">
            <div class="action-inner">
              <span class="action-label">标记概念</span>
            </div>
          </GlassWrapper>
        </div>
        <div class="action-glass-host">
          <GlassWrapper interactive @click="toggleChat()">
            <div class="action-inner">
              <span class="action-label">退出对话</span>
            </div>
          </GlassWrapper>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, computed, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import FileUploadArea from '../ai/FileUploadArea.vue';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeChat } from '../../composables/useNodeChat';
import { usePageTransition } from '../../composables/usePageTransition';
import type { Editor, JSONContent } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Paragraph from '@tiptap/extension-paragraph';
import Image from '@tiptap/extension-image';
import { Mathematics, mathMigrationRegex, migrateMathStrings } from '@tiptap/extension-mathematics';
import { Markdown } from '@tiptap/markdown';
import type { MarkdownManager } from '@tiptap/markdown';
import { all, createLowlight } from 'lowlight';
import DOMPurify from 'dompurify';
import { useNodeStore } from '../../stores/nodeStore';
import { CodeBlockWithUi } from './extensions/codeBlockWithUi';
import { MarkdownBold, MarkdownItalic, MarkdownStrike } from './extensions/markdownInputRules';
import { AUTO_SAVE_DELAY_MS } from '../../constants/app';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';
import 'highlight.js/styles/github.css';

interface UploadedFile {
  file_id: string;
  filename: string;
  size: number;
  extension: string;
  text_length: number;
  text_preview: string;
}
import 'katex/dist/katex.min.css';

const PROSEMIRROR_SLICE_MIME = 'application/x-prosemirror-slice';

const store = useNodeStore();
const { activeNode, pathNodes, childNodes } = storeToRefs(store);
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
const userInput = ref('');
const pendingFile = ref<UploadedFile | null>(null);
const lastActiveNodeId = ref<string | null>(null);

const CHAT_PROMPT_TEXT = '想聊点啥？主动换行可以给我发送消息。我会基于我们的聊天记录来填充这个知识点的内容，当然，之后你也可以把我填充的内容剪切到其他知识点中，随你喜欢。';

const ChatPromptParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
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
    };
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

function parseMarkdownContent(instance: Editor, content: string): JSONContent | null {
  const mgr = getMarkdownManager(instance);
  if (!mgr) return null;
  try {
    // Pre-process LaTeX: convert $...$ / $$...$$ to HTML that Mathematics extension parseHTML recognizes
    const processed = preprocessMathForMarkdown(content);
    const parsed = mgr.parse(processed);
    instance.schema.nodeFromJSON(parsed).check();
    return parsed;
  } catch (err) {
    console.error('[MarkdownEditor] parseMarkdownContent failed:', err, 'content preview:', content.slice(0, 200));
    return null;
  }
}

/**
 * Escape HTML special characters in LaTeX content so they survive the HTML→JSON parse.
 */
function escapeLatexForHtmlAttr(latex: string): string {
  return latex
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Pre-process markdown text: convert $...$ (inline math) and $$...$$ (block math)
 * into HTML tags that the Mathematics extension's parseHTML can recognize.
 *
 * The Mathematics extension registers:
 *   parseHTML: [{ tag: 'span[data-type="inline-math"]' }]
 *   parseHTML: [{ tag: 'div[data-type="block-math"]' }]
 *
 * The TipTap MarkdownManager parses these HTML tags via generateJSON(),
 * which respects extension parseHTML rules and creates inlineMath/blockMath nodes.
 */
function preprocessMathForMarkdown(text: string): string {
  // Fast path: no $ delimiters means no LaTeX math to preprocess
  if (!text.includes('$')) {
    return text;
  }

  // Block math first ($$...$$) — supports multiline with [\s\S]+?
  // Use a non-greedy match so adjacent blocks stay separate
  let result = text.replace(/\$\$([\s\S]+?)\$\$/g, (_full, latex: string) => {
    return `<div data-type="block-math" data-latex="${escapeLatexForHtmlAttr(latex.trim())}"></div>`;
  });

  // Inline math ($...$) — single-line only.
  // The lookahead (?![ \d]) prevents matching currency values like $100 or $ 50.
  result = result.replace(/\$(?![ \d])([^$\n]+?)\$/g, (_full, latex: string) => {
    return `<span data-type="inline-math" data-latex="${escapeLatexForHtmlAttr(latex.trim())}"></span>`;
  });

  return result;
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
          content: [{ type: 'text', text: CHAT_PROMPT_TEXT }],
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
        content: [{ type: 'text', text: '让我思考一下...' }],
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
  } catch { /* save failed, continue */ }
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
        } catch { /* save failed, keep incremental content */ }
      }
    }

    // Revert mode from 'conversing' back to 'text_input'
    chatMode.value = 'text_input';

    // Rebuild with final data
    applyInlineChatDoc(buildInlineChatDoc());

  } catch {
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
      } catch { /* save failed, keep incremental content */ }
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
  const name = window.prompt('输入概念名称：');
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
  try {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:7860';
    const token = localStorage.getItem('acacia_backend_token');
    const resp = await fetch(`${backendUrl}/file-content/${pendingFile.value.file_id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error('获取文件内容失败');
    const data = await resp.json();
    const fullText = data.full_text || '';
    await store.saveActiveNodeContent(activeNode.value.id, fullText);
    lastSavedContent.value = fullText;
    draft.value = fullText;
    if (activeNode.value) {
      activeNode.value.content = fullText;
    }
    syncEditorContent(fullText);
    // Exit back to idle
    chatMode.value = 'idle';
    pendingFile.value = null;
    isFileSunk.value = false;
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '填入内容失败';
  } finally {
    isBusy.value = false;
  }
}

async function startLineByLineChat() {
  if (!pendingFile.value || !activeNode.value) return;
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
  } catch {
    // Failed — stay on choice screen
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
}

const editor = useEditor({
  content: '',
  contentType: 'markdown',
  extensions: [
    StarterKit.configure({
      paragraph: false,
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
    ChatPromptParagraph,
    Markdown.configure({
      markedOptions: {
        gfm: false,
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
        trust: false,
      },
    }),
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
    }

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
  padding: 44px 16px 14px;
}

.editor-input.editor-readonly {
  opacity: 0.72;
  pointer-events: none;
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
