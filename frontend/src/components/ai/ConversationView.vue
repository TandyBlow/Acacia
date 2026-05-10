<template>
  <div class="conversation-container">
    <!-- Progress bar -->
    <div class="progress-bar">
      <div class="progress-text">
        第 {{ currentIndex + 1 }} / {{ total }} 个知识点
        <span v-if="currentKpTitle" class="progress-kp">{{ currentKpTitle }}</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
    </div>

    <!-- Source content panel -->
    <div v-if="props.currentKpData" class="source-panel">
      <button class="source-toggle" @click="showSource = !showSource">
        <span class="source-toggle-icon">{{ showSource ? '▾' : '▸' }}</span>
        查看原文
      </button>
      <div v-if="showSource" class="source-content">
        <div v-if="props.currentKpData.source_content" class="source-section">
          <div class="source-label">原文内容</div>
          <div class="source-text">{{ props.currentKpData.source_content }}</div>
        </div>
        <div v-if="props.currentKpData.correct_definition" class="source-section">
          <div class="source-label">标准定义</div>
          <div class="source-text">{{ props.currentKpData.correct_definition }}</div>
        </div>
        <div v-if="props.currentKpData.key_example" class="source-section">
          <div class="source-label">关键示例</div>
          <div class="source-text">{{ props.currentKpData.key_example }}</div>
        </div>
      </div>
    </div>

    <!-- Messages -->
    <div ref="messagesContainer" class="messages-container">
      <div
        v-for="(message, index) in messages"
        :key="index"
        class="message"
        :class="[
          'message-' + message.role,
          message.messageType ? 'message-' + message.messageType : ''
        ]"
      >
        <div class="message-avatar">
          {{ message.messageType === 'correct_self' ? '⚠️' : message.messageType === 'admit_uncertainty' ? '🤔' : message.role === 'ai' ? '🤖' : '👤' }}
        </div>
        <div class="message-content">
          <div v-if="message.messageType === 'correct_self'" class="message-type-label">纠正</div>
          <div v-if="message.messageType === 'admit_uncertainty'" class="message-type-label">不确定</div>
          <div class="message-text">{{ message.content }}</div>
          <div v-if="message.generatedContent" class="message-generated">
            <div class="generated-label">✓ 已生成内容</div>
            <div class="generated-preview">{{ message.generatedContent.substring(0, 100) }}...</div>
          </div>
        </div>
      </div>

      <div v-if="isThinking" class="message message-ai">
        <div class="message-avatar">🤖</div>
        <div class="message-content">
          <div class="message-thinking">思考中...</div>
        </div>
      </div>
    </div>

    <!-- Example preview card -->
    <div v-if="isShowingExample && currentExample" class="example-preview-card">
      <div class="example-header">
        <span class="example-icon">💡</span>
        <span class="example-title">示例答案预览</span>
      </div>

      <div class="example-content">
        <div class="example-answer" v-html="renderMarkdown(currentExample.content)"></div>
      </div>

      <div class="example-explanation">
        <div class="explanation-label">解释</div>
        <div class="explanation-text">{{ currentExample.explanation }}</div>
      </div>

      <div v-if="showFeedbackInput" class="example-feedback-input">
        <textarea
          v-model="feedbackText"
          class="feedback-textarea"
          placeholder="请说明需要改进的地方..."
          rows="2"
        />
      </div>

      <div class="example-actions">
        <button
          class="example-btn example-btn-skip"
          :disabled="isThinking"
          @click="handleSkipExample"
        >
          跳过示例
        </button>
        <button
          class="example-btn example-btn-regenerate"
          :disabled="isThinking"
          @click="handleRegenerateExample"
        >
          {{ showFeedbackInput ? '提交反馈并重新生成' : '重新生成' }}
        </button>
        <button
          class="example-btn example-btn-accept"
          :disabled="isThinking"
          @click="handleAcceptExample"
        >
          接受示例
        </button>
      </div>
    </div>

    <!-- Input area -->
    <div class="input-area">
      <textarea
        v-model="userInput"
        class="input-textarea"
        placeholder="输入你的回答..."
        rows="3"
        :disabled="isThinking || isCompleted"
        @keydown.enter.ctrl="sendAnswer"
      />
      <div class="input-actions">
        <button
          class="input-btn input-btn-skip"
          :disabled="isThinking || isCompleted"
          @click="skipCurrent"
        >
          跳过
        </button>
        <button
          class="input-btn input-btn-send"
          :disabled="!canSend || isThinking || isCompleted"
          @click="sendAnswer"
        >
          {{ isThinking ? '发送中...' : '发送 (Ctrl+Enter)' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';

interface Message {
  role: 'user' | 'ai';
  content: string;
  generatedContent?: string;
  messageType?: 'correct_self' | 'admit_uncertainty';
}

function renderMarkdown(content: string): string {
  // Simple markdown to HTML conversion for preview
  // Note: KaTeX rendering will happen automatically via TipTap's Mathematics extension
  return content
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
}

interface KpData {
  source_content?: string;
  correct_definition?: string;
  key_example?: string;
}

interface Props {
  sessionId: string;
  currentIndex: number;
  total: number;
  currentKpTitle?: string;
  currentKpData?: KpData | null;
  isCompleted: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  answer: [answer: string];
  skip: [];
  'example-feedback': [payload: { action: string; feedback?: string }];
}>();

const THINKING_SAFETY_TIMEOUT = 120_000; // 2 minutes, backend timeout is 60s

const messages = ref<Message[]>([]);
const userInput = ref('');
const isThinking = ref(false);
const messagesContainer = ref<HTMLElement | null>(null);
const showSource = ref(false);
let thinkingSafetyTimer: ReturnType<typeof setTimeout> | null = null;

function startThinking() {
  isThinking.value = true;
  thinkingSafetyTimer = setTimeout(() => {
    if (isThinking.value) {
      isThinking.value = false;
      messages.value.push({
        role: 'ai',
        content: '请求超时，请重试。如果多次出现此问题，请刷新页面后重新开始。',
      });
    }
  }, THINKING_SAFETY_TIMEOUT);
}

function stopThinking() {
  isThinking.value = false;
  if (thinkingSafetyTimer) {
    clearTimeout(thinkingSafetyTimer);
    thinkingSafetyTimer = null;
  }
}

// Example preview state
const isShowingExample = ref(false);
const currentExample = ref<{
  content: string;
  explanation: string;
} | null>(null);
const feedbackText = ref('');
const showFeedbackInput = ref(false);

const progressPercent = computed(() => {
  if (props.total === 0) return 0;
  return (props.currentIndex / props.total) * 100;
});

const canSend = computed(() => {
  return userInput.value.trim().length > 0;
});

function sendAnswer() {
  if (!canSend.value || isThinking.value) return;

  const answer = userInput.value.trim();
  messages.value.push({
    role: 'user',
    content: answer,
  });

  userInput.value = '';
  startThinking();

  emit('answer', answer);
}

function skipCurrent() {
  if (isThinking.value) return;

  messages.value.push({
    role: 'user',
    content: '[已跳过]',
  });

  startThinking();
  emit('skip');
}

function addAiMessage(content: string, generatedContent?: string, messageType?: 'correct_self' | 'admit_uncertainty') {
  messages.value.push({
    role: 'ai',
    content,
    generatedContent,
    messageType,
  });
  stopThinking();

  nextTick(() => {
    scrollToBottom();
  });
}

function showExample(content: string, explanation: string) {
  currentExample.value = { content, explanation };
  isShowingExample.value = true;
  showFeedbackInput.value = false;
  feedbackText.value = '';

  nextTick(() => {
    scrollToBottom();
  });
}

function handleAcceptExample() {
  if (isThinking.value) return;
  startThinking();
  isShowingExample.value = false;
  emit('example-feedback', { action: 'accept' });
}

function handleRegenerateExample() {
  if (!feedbackText.value.trim()) {
    showFeedbackInput.value = true;
    return;
  }

  if (isThinking.value) return;
  startThinking();
  isShowingExample.value = false;
  emit('example-feedback', { action: 'regenerate', feedback: feedbackText.value.trim() });
  feedbackText.value = '';
  showFeedbackInput.value = false;
}

function handleSkipExample() {
  if (isThinking.value) return;
  startThinking();
  isShowingExample.value = false;
  emit('example-feedback', { action: 'skip' });
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

watch(() => props.currentIndex, () => {
  showSource.value = false;
  nextTick(() => {
    scrollToBottom();
  });
});

function resetThinking(errorMessage?: string) {
  stopThinking();
  if (errorMessage) {
    messages.value.push({
      role: 'ai',
      content: errorMessage,
    });
  }
}

function loadHistory(historyMessages: Message[]) {
  messages.value = historyMessages;
  nextTick(() => {
    scrollToBottom();
  });
}

defineExpose({
  addAiMessage,
  showExample,
  resetThinking,
  loadHistory,
});
</script>

<style scoped>
.conversation-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.progress-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-kp {
  opacity: 0.6;
  font-weight: 400;
}

.progress-track {
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, rgba(102, 255, 229, 0.6), rgba(102, 255, 229, 0.9));
  transition: width 0.3s ease;
}

.source-panel {
  border: 1px solid var(--color-glass-border);
  border-radius: 12px;
  overflow: hidden;
}

.source-toggle {
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background 0.2s ease;
}

.source-toggle:hover {
  background: rgba(255, 255, 255, 0.08);
}

.source-toggle-icon {
  font-size: 12px;
  width: 14px;
  text-align: center;
}

.source-content {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-top: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.02);
}

.source-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.source-label {
  font-size: 12px;
  font-weight: 700;
  color: rgba(102, 255, 229, 0.75);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.source-text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-primary);
  opacity: 0.8;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px;
}

.message {
  display: flex;
  gap: 12px;
  animation: message-appear 0.3s ease;
}

@keyframes message-appear {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.message-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message-text {
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 15px;
  line-height: 1.5;
  color: var(--color-primary);
}

.message-ai .message-text {
  background: rgba(102, 255, 229, 0.12);
}

.message-user .message-text {
  background: rgba(255, 255, 255, 0.08);
}

/* Self-correction message — yellow/warning style */
.message-correct_self .message-text {
  background: rgba(255, 193, 7, 0.12);
  border: 1px solid rgba(255, 193, 7, 0.35);
}

.message-correct_self .message-type-label {
  font-size: 12px;
  color: #ffc107;
  margin-bottom: 4px;
  font-weight: 600;
}

/* Admit uncertainty message — softer style */
.message-admit_uncertainty .message-text {
  background: rgba(158, 158, 158, 0.1);
  border: 1px solid rgba(158, 158, 158, 0.25);
}

.message-admit_uncertainty .message-type-label {
  font-size: 12px;
  color: #9e9e9e;
  margin-bottom: 4px;
  font-weight: 600;
}

.message-thinking {
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(102, 255, 229, 0.12);
  font-size: 15px;
  color: var(--color-primary);
  opacity: 0.7;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.9; }
}

.message-generated {
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(46, 204, 113, 0.12);
  border: 1px solid rgba(46, 204, 113, 0.3);
}

.generated-label {
  font-size: 12px;
  font-weight: 600;
  color: #1e8449;
  margin-bottom: 6px;
}

.generated-preview {
  font-size: 13px;
  color: var(--color-primary);
  opacity: 0.7;
  line-height: 1.4;
}

.input-area {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.input-textarea {
  width: 100%;
  border: 1px solid var(--color-glass-border);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-primary);
  padding: 12px 16px;
  font-size: 15px;
  line-height: 1.5;
  resize: vertical;
  font-family: inherit;
}

.input-textarea:focus {
  outline: 2px solid rgba(102, 255, 229, 0.35);
}

.input-textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.input-btn {
  padding: 10px 20px;
  border-radius: 12px;
  border: 1px solid var(--color-glass-border);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.input-btn-skip {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-primary);
}

.input-btn-skip:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.16);
}

.input-btn-send {
  background: rgba(102, 255, 229, 0.28);
  color: var(--color-primary);
}

.input-btn-send:hover:not(:disabled) {
  background: rgba(102, 255, 229, 0.44);
}

.input-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.example-preview-card {
  border: 1px solid rgba(102, 255, 229, 0.3);
  border-radius: 16px;
  background: rgba(102, 255, 229, 0.08);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: message-appear 0.3s ease;
}

.example-header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-primary);
}

.example-icon {
  font-size: 20px;
}

.example-content {
  padding: 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--color-glass-border);
}

.example-answer {
  font-size: 15px;
  line-height: 1.6;
  color: var(--color-primary);
}

.example-explanation {
  padding: 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
}

.explanation-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(102, 255, 229, 0.8);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.explanation-text {
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-primary);
  opacity: 0.85;
}

.example-feedback-input {
  margin-top: -4px;
}

.feedback-textarea {
  width: 100%;
  border: 1px solid var(--color-glass-border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-primary);
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.5;
  resize: vertical;
  font-family: inherit;
}

.feedback-textarea:focus {
  outline: 2px solid rgba(102, 255, 229, 0.35);
}

.example-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}

.example-btn {
  padding: 10px 18px;
  border-radius: 10px;
  border: 1px solid var(--color-glass-border);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.example-btn-skip {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-primary);
}

.example-btn-skip:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.16);
}

.example-btn-regenerate {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-primary);
}

.example-btn-regenerate:hover:not(:disabled) {
  background: rgba(255, 193, 7, 0.32);
}

.example-btn-accept {
  background: rgba(46, 204, 113, 0.28);
  color: var(--color-primary);
}

.example-btn-accept:hover:not(:disabled) {
  background: rgba(46, 204, 113, 0.44);
}

.example-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
