<template>
  <div class="node-chat-root">
    <!-- Idle: 2 glass areas (text input + file upload) stacked vertically -->
    <div v-if="mode === 'idle'" class="activity-layout">
      <div class="activity-glass-host chat-tab-host">
        <GlassWrapper interactive @click="setTextMode()">
          <div class="chat-tab-inner">
            <span class="tab-icon">✎</span>
            <span class="tab-label">文字输入</span>
            <span class="tab-desc">描述你想了解的内容</span>
          </div>
        </GlassWrapper>
      </div>
      <div class="activity-glass-host chat-tab-host">
        <GlassWrapper interactive @click="setFileMode()">
          <div class="chat-tab-inner">
            <span class="tab-icon">📄</span>
            <span class="tab-label">文件导入</span>
            <span class="tab-desc">上传文件作为参考资料</span>
          </div>
        </GlassWrapper>
      </div>
    </div>

    <!-- Text input mode: 1 glass area -->
    <div v-else-if="mode === 'text_input'" class="activity-layout">
      <div class="activity-glass-host">
        <GlassWrapper>
          <div class="activity-scroll">
            <div class="input-form">
              <button class="back-btn" @click="mode = 'idle'">← 返回</button>
              <textarea
                v-model="textDraft"
                class="chat-textarea"
                placeholder="输入你想了解的内容，AI会通过对话帮你深入理解...&#10;&#10;例如：&#10;- 梯度下降的工作原理&#10;- 什么是RESTful API&#10;- 二叉树的遍历方式"
                rows="6"
              />
              <button
                class="start-btn"
                :disabled="!textDraft.trim() || isBusy"
                @click="startTextChat()"
              >
                {{ isBusy ? '启动中...' : '开始对话' }}
              </button>
            </div>
          </div>
        </GlassWrapper>
      </div>
    </div>

    <!-- File upload mode: 1 glass area -->
    <div v-else-if="mode === 'file_upload'" class="activity-layout">
      <div class="activity-glass-host">
        <GlassWrapper>
          <div class="activity-scroll">
            <div class="input-form">
              <button class="back-btn" @click="mode = 'idle'">← 返回</button>
              <FileUploadArea
                @uploaded="onFileUploaded"
                @removed="onFileRemoved"
              />
              <button
                v-if="pendingFile"
                class="start-btn"
                :disabled="isBusy"
                @click="startFileChat()"
              >
                {{ isBusy ? '启动中...' : '开始对话' }}
              </button>
            </div>
          </div>
        </GlassWrapper>
      </div>
    </div>

    <!-- Conversing: 1 glass area with ConversationView -->
    <div v-else-if="mode === 'conversing'" class="activity-layout">
      <div class="activity-glass-host">
        <GlassWrapper>
          <ConversationView
            ref="conversationRef"
            class="conversation-full"
            :session-id="sessionId || ''"
            :current-index="currentKpIndex"
            :total="totalKp"
            :current-kp-title="currentSubTopic || '当前主题'"
            :is-completed="isCompleted"
            @answer="onAnswer"
            @skip="onSkip"
            @end="onEnd"
          >
            <template #extra-actions>
              <div class="extra-chat-actions">
                <button
                  class="action-btn action-btn-regenerate"
                  :disabled="isBusy"
                  title="用当前知识树上下文重新生成AI的最后一条回复"
                  @click="onRegenerate()"
                >
                  🔄 根据知识树重新生成
                </button>
                <button
                  class="action-btn action-btn-mark"
                  :disabled="isBusy"
                  title="将不懂的概念标记为待学习的子节点"
                  @click="onMarkConcept()"
                >
                  📌 标记概念
                </button>
              </div>
            </template>
          </ConversationView>
        </GlassWrapper>
      </div>
    </div>

    <!-- Error -->
    <div v-if="errorMessage" class="chat-error">{{ errorMessage }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import ConversationView from './ConversationView.vue';
import FileUploadArea from './FileUploadArea.vue';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeChat } from '../../composables/useNodeChat';
import { useNodeStore } from '../../stores/nodeStore';

const {
  mode, sessionId, isBusy, errorMessage,
  isCompleted,
  currentSubTopic, messages,
  totalKp, currentKpIndex,
  setNodeId, setTextMode, setFileMode,
  startTextChat: doStartTextChat,
  startFileChat: doStartFileChat,
  sendMessage, skipTurn, endConversation,
  regenerateWithTreeContext,
  markConcept,
  resetForNewNode,
} = useNodeChat();

const store = useNodeStore();
const { activeNode, pathNodes, childNodes, treeNodes } = storeToRefs(store);

const textDraft = ref('');
const pendingFile = ref<{ file_id: string; filename: string; size: number; text_length: number; text_preview: string } | null>(null);
const conversationRef = ref<InstanceType<typeof ConversationView> | null>(null);

watch(() => activeNode.value?.id, (newId, oldId) => {
  if (newId !== oldId) {
    resetForNewNode();
    textDraft.value = '';
    pendingFile.value = null;
    if (newId) {
      setNodeId(newId);
    }
  }
}, { immediate: true });

function onFileUploaded(file: { file_id: string; filename: string; size: number; extension: string; text_length: number; text_preview: string }) {
  pendingFile.value = file;
}

function onFileRemoved() {
  pendingFile.value = null;
}

async function startTextChat() {
  if (!textDraft.value.trim() || !activeNode.value) return;
  try {
    const result = await doStartTextChat(activeNode.value.id, activeNode.value.name, textDraft.value);
    await nextTick();
    conversationRef.value?.addAiMessage(result.question);
  } catch { /* error already set in composable */ }
}

async function startFileChat() {
  if (!pendingFile.value || !activeNode.value) return;
  try {
    const result = await doStartFileChat(
      activeNode.value.id,
      activeNode.value.name,
      pendingFile.value.file_id,
      pendingFile.value.filename,
      pendingFile.value.text_preview
    );
    await nextTick();
    conversationRef.value?.addAiMessage(result.question);
  } catch { /* error already set in composable */ }
}

async function onAnswer(answer: string) {
  const result = await sendMessage(answer);
  if (result) {
    conversationRef.value?.addAiMessage(result.ai_message, result.generated_content);
  } else if (errorMessage.value) {
    conversationRef.value?.resetThinking(errorMessage.value);
  }
}

async function onSkip() {
  const result = await skipTurn();
  if (result) {
    conversationRef.value?.addAiMessage(result.ai_message);
  } else if (errorMessage.value) {
    conversationRef.value?.resetThinking(errorMessage.value);
  }
}

async function onEnd() {
  const result = await endConversation();
  if (result) {
    conversationRef.value?.addAiMessage(result.ai_message);
  } else if (errorMessage.value) {
    conversationRef.value?.resetThinking(errorMessage.value);
  }
}

function buildTreeContext(): string {
  const parts: string[] = [];

  if (pathNodes.value.length > 0) {
    parts.push('知识路径：' + pathNodes.value.map(n => n.name).join(' → '));
  }

  if (activeNode.value) {
    parts.push(`当前学习：${activeNode.value.name}`);
  }

  if (childNodes.value.length > 0) {
    parts.push('已学习的子知识点：' + childNodes.value.map(n => n.name).join('、'));
  }

  if (pathNodes.value.length > 0 && childNodes.value.length === 0) {
    const parentId = activeNode.value?.parentId;
    if (parentId) {
      const siblings = treeNodes.value
        .filter(n => n.parentId === parentId && n.id !== activeNode.value?.id)
        .map(n => n.name);
      if (siblings.length > 0) {
        parts.push('同级知识点：' + siblings.join('、'));
      }
    }
  }

  return parts.join('\n');
}

async function onRegenerate() {
  const treeContext = buildTreeContext();
  if (!treeContext) return;
  const result = await regenerateWithTreeContext(treeContext);
  if (result) {
    conversationRef.value?.loadHistory(messages.value);
  } else if (errorMessage.value) {
    conversationRef.value?.resetThinking(errorMessage.value);
  }
}

async function onMarkConcept() {
  const name = prompt('输入概念名称：');
  if (!name || !name.trim()) return;
  const result = await markConcept(name.trim());
  if (result) {
    conversationRef.value?.loadHistory(messages.value);
    await store.loadNode(activeNode.value?.id || '');
  }
}
</script>

<style scoped>
.node-chat-root {
  width: 100%;
  height: 100%;
}

/* Idle tab cards */
.chat-tab-host :deep(.glass) {
  cursor: pointer;
  transition: border-color 240ms ease, background 240ms ease;
}

.chat-tab-host:hover :deep(.glass) {
  border-color: var(--color-hint, rgba(102, 255, 229, 0.54));
}

.chat-tab-host:hover :deep(.glass-content) {
  background: rgba(255, 255, 255, 0.12);
}

.chat-tab-inner {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  pointer-events: none;
}

.tab-icon {
  font-size: 28px;
}

.tab-label {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-primary);
}

.tab-desc {
  font-size: 12px;
  color: var(--color-text-secondary);
  text-align: center;
}

/* Input forms */
.input-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.back-btn {
  align-self: flex-start;
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 13px;
  padding: 4px 0;
}

.back-btn:hover {
  color: var(--color-primary);
}

.chat-textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--color-glass-border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-primary);
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
  font-family: inherit;
}

.chat-textarea:focus {
  outline: none;
  border-color: var(--color-hint, rgba(102, 255, 229, 0.54));
}

.start-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  background: var(--color-accent, rgba(102, 255, 229, 0.28));
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.start-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.start-btn:hover:not(:disabled) {
  opacity: 0.85;
}

/* Conversation */
.conversation-full {
  width: 100%;
  height: 100%;
}

/* Extra actions */
.extra-chat-actions {
  display: flex;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid var(--color-glass-border);
}

.action-btn {
  padding: 6px 12px;
  border: 1px solid var(--color-glass-border);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover:not(:disabled) {
  border-color: var(--color-hint, rgba(102, 255, 229, 0.54));
  color: var(--color-accent, rgba(102, 255, 229, 0.9));
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.action-btn-mark {
  margin-left: auto;
}

/* Error */
.chat-error {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 10px 16px;
  background: rgba(255, 80, 80, 0.1);
  color: #ff5050;
  font-size: 13px;
  border-top: 1px solid rgba(255, 80, 80, 0.2);
}
</style>
