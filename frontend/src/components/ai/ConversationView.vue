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

    <!-- Messages -->
    <div ref="messagesContainer" class="messages-container">
      <div
        v-for="(message, index) in messages"
        :key="index"
        class="message"
        :class="'message-' + message.role"
      >
        <div class="message-avatar">
          {{ message.role === 'ai' ? '🤖' : '👤' }}
        </div>
        <div class="message-content">
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
}

interface Props {
  sessionId: string;
  currentIndex: number;
  total: number;
  currentKpTitle?: string;
  isCompleted: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  answer: [answer: string];
  skip: [];
}>();

const messages = ref<Message[]>([]);
const userInput = ref('');
const isThinking = ref(false);
const messagesContainer = ref<HTMLElement | null>(null);

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
  isThinking.value = true;

  emit('answer', answer);
}

function skipCurrent() {
  if (isThinking.value) return;

  messages.value.push({
    role: 'user',
    content: '[已跳过]',
  });

  isThinking.value = true;
  emit('skip');
}

function addAiMessage(content: string, generatedContent?: string) {
  messages.value.push({
    role: 'ai',
    content,
    generatedContent,
  });
  isThinking.value = false;

  nextTick(() => {
    scrollToBottom();
  });
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

watch(() => props.currentIndex, () => {
  nextTick(() => {
    scrollToBottom();
  });
});

defineExpose({
  addAiMessage,
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
</style>
