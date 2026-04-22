<template>
  <div class="quiz-panel">
    <template v-if="!activeNode">
      <div class="quiz-no-node">请先选择一个知识点再出题</div>
      <button class="quiz-btn" @click="goBack">返回</button>
    </template>

    <template v-else-if="isBusy">
      <div class="quiz-loading">出题中...</div>
    </template>

    <template v-else-if="errorMessage">
      <div class="quiz-error">{{ errorMessage }}</div>
      <button class="quiz-btn" @click="retry">重试</button>
    </template>

    <template v-else-if="currentQuestion">
      <div class="quiz-question">{{ currentQuestion.question }}</div>

      <div class="quiz-options">
        <GlassWrapper
          v-for="(option, idx) in currentQuestion.options"
          :key="idx"
          class="quiz-option"
          :class="optionClasses(idx)"
          interactive
          @click="onOptionClick(idx)"
        >
          <div class="quiz-option-content">
            <span class="quiz-option-label">{{ optionLabels[idx] }}</span>
            <span class="quiz-option-text">{{ option }}</span>
          </div>
        </GlassWrapper>
      </div>

      <template v-if="showResult">
        <div class="quiz-result" :class="isCorrect ? 'correct' : 'wrong'">
          {{ isCorrect ? '回答正确！' : '回答错误' }}
        </div>
        <div v-if="currentQuestion.explanation" class="quiz-explanation">
          {{ currentQuestion.explanation }}
        </div>
        <button class="quiz-btn" @click="goBack">继续学习</button>
      </template>

      <button
        v-else
        class="quiz-btn"
        :disabled="selectedOption === null"
        @click="confirmAndSubmit"
      >
        确认
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useAuthStore } from '../../stores/authStore';
import { useQuiz } from '../../composables/useQuiz';

const nodeStore = useNodeStore();
const authStore = useAuthStore();
const { activeNode } = storeToRefs(nodeStore);
const { user } = storeToRefs(authStore);

const {
  isBusy, errorMessage, currentQuestion, selectedOption, showResult,
  generateQuestion, submitAnswer, selectOption, confirmSelection, reset,
} = useQuiz();

const optionLabels = ['A', 'B', 'C', 'D'];

const isCorrect = computed(() => {
  if (!currentQuestion.value || selectedOption.value === null) return false;
  return selectedOption.value === currentQuestion.value.correct_index;
});

function optionClasses(idx: number): Record<string, boolean> {
  return {
    selected: selectedOption.value === idx && !showResult.value,
    correct: showResult.value && idx === currentQuestion.value!.correct_index,
    wrong: showResult.value && idx === selectedOption.value && idx !== currentQuestion.value!.correct_index,
  };
}

function onOptionClick(idx: number): void {
  if (showResult.value) return;
  selectOption(idx);
}

async function confirmAndSubmit(): Promise<void> {
  confirmSelection();
  if (currentQuestion.value && selectedOption.value !== null) {
    const correct = selectedOption.value === currentQuestion.value.correct_index;
    await submitAnswer(currentQuestion.value.node_id, correct);
  }
}

function retry(): void {
  if (user.value && activeNode.value) {
    generateQuestion(user.value.id, activeNode.value.id);
  }
}

function goBack(): void {
  reset();
  nodeStore.cancelOperation();
}

onMounted(() => {
  if (user.value && activeNode.value) {
    generateQuestion(user.value.id, activeNode.value.id);
  }
});
</script>

<style scoped>
.quiz-panel {
  width: 100%;
  height: 100%;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
}

.quiz-loading {
  flex: 1;
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-primary);
  opacity: 0.7;
}

.quiz-no-node {
  flex: 1;
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-primary);
  opacity: 0.7;
}

.quiz-error {
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(255, 80, 80, 0.12);
  color: #c0392b;
  font-size: 14px;
}

.quiz-question {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-primary);
  line-height: 1.5;
}

.quiz-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quiz-option {
  width: 100%;
  cursor: pointer;
  transition: background 160ms ease;
}

.quiz-option :deep(.glass-raised) {
  box-shadow:
    4px 4px 8px var(--shadow-raised-a),
    -4px -4px 8px var(--shadow-raised-b);
}

.quiz-option :deep(.glass-pressed) {
  box-shadow: none;
}

.quiz-option.selected :deep(.glass-content) {
  background: rgba(102, 255, 229, 0.15);
}

.quiz-option.correct :deep(.glass-content) {
  background: rgba(46, 204, 113, 0.25);
}

.quiz-option.wrong :deep(.glass-content) {
  background: rgba(255, 80, 80, 0.2);
}

.quiz-option-content {
  width: 100%;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.quiz-option-label {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--color-glass-border);
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-primary);
  flex-shrink: 0;
}

.quiz-option-text {
  font-size: 15px;
  color: var(--color-primary);
  line-height: 1.4;
}

.quiz-result {
  font-size: 20px;
  font-weight: 700;
  text-align: center;
  padding: 8px;
}

.quiz-result.correct {
  color: #27ae60;
}

.quiz-result.wrong {
  color: #e74c3c;
}

.quiz-explanation {
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-primary);
}

.quiz-btn {
  padding: 12px 28px;
  border-radius: 14px;
  border: 1px solid var(--color-glass-border);
  background: rgba(102, 255, 229, 0.18);
  color: var(--color-primary);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  align-self: center;
  transition: background 0.2s;
}

.quiz-btn:hover:not(:disabled) {
  background: rgba(102, 255, 229, 0.35);
}

.quiz-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
