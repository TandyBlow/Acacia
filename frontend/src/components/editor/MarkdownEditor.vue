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

            <!-- idle or conversing: editor + optional conversation controls -->
            <template v-else>
              <EditorContent
                :editor="editor"
                class="editor-input"
                :class="{ 'editor-readonly': chatMode === 'conversing' }"
                spellcheck="false"
              />

              <!-- Conversation input area (only during conversing) -->
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
            </template>
          </div>
        </GlassWrapper>
      </div>
    </div>

    <!-- Bottom action bar: context-sensitive -->
    <div v-if="showBottomBar" class="bottom-actions">
      <!-- idle / text_input / file_upload: chat action buttons -->
      <template v-if="chatMode === 'idle' || chatMode === 'text_input' || chatMode === 'file_upload'">
        <div class="action-glass-host">
          <GlassWrapper
            interactive
            :pressed="isSunk"
            @click="toggleChat()"
          >
            <div class="action-inner">
              <span class="action-label">对话生成</span>
            </div>
          </GlassWrapper>
        </div>
        <div v-if="chatMode !== 'file_upload'" class="action-glass-host">
          <GlassWrapper interactive @click="startChatFile()">
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
import { onBeforeUnmount, onMounted, ref, watch, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import FileUploadArea from '../ai/FileUploadArea.vue';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeChat } from '../../composables/useNodeChat';
import { usePageTransition } from '../../composables/usePageTransition';
import type { Editor, JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Paragraph from '@tiptap/extension-paragraph';
import Image from '@tiptap/extension-image';
import { Mathematics, mathMigrationRegex, migrateMathStrings } from '@tiptap/extension-mathematics';
import { Markdown } from '@tiptap/markdown';
import { all, createLowlight } from 'lowlight';
import DOMPurify from 'dompurify';
import { useNodeStore } from '../../stores/nodeStore';
import { CodeBlockWithUi } from './extensions/codeBlockWithUi';
import { MarkdownBold, MarkdownItalic, MarkdownStrike } from './extensions/markdownInputRules';
import { AUTO_SAVE_DELAY_MS } from '../../constants/app';
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
  messages,
  generatedContent,
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
  startFileChat: doStartFileChat,
  sendMessage,
  skipTurn,
  endConversation,
  regenerateWithTreeContext,
  markConcept,
} = useNodeChat();

const hasUserEdited = ref(false);
const isSunk = ref(false);
const isAnimating = ref(false);
const userInput = ref('');
const pendingFile = ref<UploadedFile | null>(null);

const CHAT_PROMPT_TEXT = '想聊点啥？主动换行可以给我发送消息。我会基于我们的聊天记录来填充这个知识点的内容，当然，之后你也可以把我填充的内容剪切到其他知识点中，随你喜欢。';

const ChatPromptParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      contenteditable: {
        default: null,
        parseHTML: element => element.getAttribute('contenteditable'),
        renderHTML: attributes => {
          if (attributes.contenteditable != null) {
            return { contenteditable: attributes.contenteditable };
          }
          return {};
        },
      },
    };
  },
});

const isEmptyNode = computed(() => {
  if (!activeNode.value) return false;
  if (hasUserEdited.value) return false;
  const content = activeNode.value.content || '';
  return content.trim().length === 0;
});

const showBottomBar = computed(() =>
  isEmptyNode.value || chatMode.value !== 'idle'
);

const canSend = computed(() => userInput.value.trim().length > 0);

const progressPercent = computed(() => {
  if (totalKp.value <= 1) return 100;
  if (isCompleted.value) return 100;
  return Math.round((currentKpIndex.value / totalKp.value) * 100);
});

// ── Chat toggle ──────────────────────────────────────────────────────

const SINK_DURATION_MS = 240;

function startChatText() {
  chatMode.value = 'text_input';
  if (editor.value) {
    isApplyingExternalContent.value = true;
    editor.value.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { contenteditable: 'false' },
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
    if (node.type.name === 'paragraph' && node.attrs.contenteditable !== 'false') {
      lastText = node.textContent;
    }
  });
  return lastText.trim();
}

function makeAllParagraphsNonEditable(node: JSONContent) {
  if (node.type === 'paragraph') {
    node.attrs = { ...(node.attrs || {}), contenteditable: 'false' };
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      makeAllParagraphsNonEditable(child);
    }
  }
}

function buildInlineChatDoc(pendingUserMsg?: string): JSONContent {
  const content: JSONContent[] = [];

  // Prompt paragraph
  content.push({
    type: 'paragraph',
    attrs: { contenteditable: 'false' },
    content: [{ type: 'text', text: CHAT_PROMPT_TEXT }],
  });

  // Message history
  const msgs = messages.value;
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    if (!msg) continue;
    const prefix = msg.role === 'ai' ? '**AI**: ' : '**你**: ';
    const mdText = prefix + msg.content;

    const parsed = (editor.value as any)?.markdown?.parse(mdText);
    if (parsed && Array.isArray(parsed.content)) {
      for (const node of parsed.content) {
        makeAllParagraphsNonEditable(node);
        content.push(node);
      }
    } else {
      content.push({
        type: 'paragraph',
        attrs: { contenteditable: 'false' },
        content: [{ type: 'text', text: mdText }],
      });
    }

    // Separator between messages or before pending
    if (i < msgs.length - 1 || pendingUserMsg) {
      content.push({
        type: 'paragraph',
        attrs: { contenteditable: 'false' },
        content: [{ type: 'text', text: '---' }],
      });
    }
  }

  // Pending user message
  if (pendingUserMsg) {
    const parsed = (editor.value as any)?.markdown?.parse('**你**: ' + pendingUserMsg);
    if (parsed && Array.isArray(parsed.content)) {
      for (const node of parsed.content) {
        makeAllParagraphsNonEditable(node);
        content.push(node);
      }
    } else {
      content.push({
        type: 'paragraph',
        attrs: { contenteditable: 'false' },
        content: [{ type: 'text', text: '**你**: ' + pendingUserMsg }],
      });
    }
    content.push({
      type: 'paragraph',
      attrs: { contenteditable: 'false' },
      content: [{ type: 'text', text: '---' }],
    });

    // "让我思考一下" placeholder
    if (isBusy.value) {
      content.push({
        type: 'paragraph',
        attrs: { contenteditable: 'false' },
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
}

async function sendInlineMessage() {
  if (chatMode.value !== 'text_input' || !editor.value || !activeNode.value) return;
  if (isBusy.value) return;

  const msg = getLastInputParagraphText();
  if (!msg) return;

  const isFirstMessage = !sessionId.value;

  try {
    // Show pending state immediately
    applyInlineChatDoc(buildInlineChatDoc(msg));

    if (isFirstMessage) {
      await doStartTextChat(activeNode.value.id, activeNode.value.name, msg);
      // startTextChat overwrites messages with only AI response, prepend user msg
      messages.value = [
        { role: 'user' as const, content: msg },
        ...messages.value,
      ];
    } else {
      await sendMessage(msg, { skipInsertContent: true });
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
  const parsed = (editor.value as any).markdown?.parse(md);
  if (parsed) {
    editor.value.commands.setContent(parsed, { emitUpdate: false });
  }
  isApplyingExternalContent.value = false;
}

async function sendAnswer() {
  if (!canSend.value || isBusy.value || isCompleted.value) return;
  const answer = userInput.value.trim();
  userInput.value = '';
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
    parts.push('已学习的子知识点: ' + children.map(n => n.name).join(', '));
  }
  return parts.join('\n');
}

async function toggleChat() {
  if (isAnimating.value) return;
  isAnimating.value = true;

  try {
    if (chatMode.value !== 'idle') {
      // Close: save generated content → exit to idle
      if (generatedContent.value && activeNode.value) {
        const currentContent = activeNode.value.content || '';
        const newContent = currentContent
          ? currentContent + '\n\n' + generatedContent.value
          : generatedContent.value;
        try {
          await store.saveActiveNodeContent(activeNode.value.id, newContent);
          lastSavedContent.value = newContent;
          draft.value = newContent;
          generatedContent.value = '';
        } catch { /* save failed, discard */ }
      }
      exitChat();
      isSunk.value = false;
      userInput.value = '';
      pendingFile.value = null;
      if (activeNode.value && editor.value) {
        syncEditorContent(activeNode.value.content || '');
      }
    } else {
      // Open: sink button first, then start
      isSunk.value = true;
      await new Promise(r => setTimeout(r, SINK_DURATION_MS));
      const resumed = await resumeOrStartChat();
      if (!resumed) {
        startChatText();
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
  isSunk.value = true;
  await new Promise(r => setTimeout(r, SINK_DURATION_MS));
  setFileMode();
  isAnimating.value = false;
}

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

// Watch for file_upload mode with a pending file to auto-start
watch(pendingFile, async (file) => {
  if (file && chatMode.value === 'file_upload' && activeNode.value) {
    try {
      await doStartFileChat(
        activeNode.value.id,
        activeNode.value.name,
        file.file_id,
        file.filename,
        file.text_preview || ''
      );
      rebuildTranscriptFromMessages();
      userInput.value = '';
    } catch {
      // Failed — stay in file_upload mode
    }
  }
});

const { registerRegion, unregisterRegion } = usePageTransition();
const editorRef = ref<HTMLElement | null>(null);

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
    Paragraph,
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
    isSunk.value = false;
    userInput.value = '';
    pendingFile.value = null;
    setEditor(editor.value || null);

    // Handle node switching: exit active chat, check if new node has resumable session
    const newId = val?.[1];
    const oldId = oldVal?.[1];
    if (newId !== oldId) {
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
</style>
