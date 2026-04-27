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
      <div class="quiz-actions">
        <button class="quiz-btn" @click="retry">重试</button>
        <button class="quiz-btn secondary" @click="goBack">返回</button>
      </div>
    </template>

    <template v-else-if="currentQuestion">
      <!-- Question type label -->
      <div class="quiz-type-row">
        <span class="quiz-type-badge">{{ typeLabel }}</span>
        <span v-if="currentQuestion.difficulty" class="quiz-difficulty">{{ currentQuestion.difficulty }}</span>
      </div>

      <div class="quiz-question">{{ currentQuestion.question }}</div>

      <!-- Single choice options -->
      <div v-if="currentQuestion.question_type === 'single_choice'" class="quiz-options">
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

      <!-- True/False options -->
      <div v-else-if="currentQuestion.question_type === 'true_false'" class="quiz-tf-options">
        <GlassWrapper
          class="quiz-tf-option"
          :class="tfOptionClasses(0)"
          interactive
          @click="onOptionClick(0)"
        >
          <div class="quiz-tf-content">正确</div>
        </GlassWrapper>
        <GlassWrapper
          class="quiz-tf-option"
          :class="tfOptionClasses(1)"
          interactive
          @click="onOptionClick(1)"
        >
          <div class="quiz-tf-content">错误</div>
        </GlassWrapper>
      </div>

      <!-- Short answer input -->
      <div v-else-if="currentQuestion.question_type === 'short_answer'" class="quiz-sa-area">
        <textarea
          v-model="shortAnswerText"
          class="quiz-sa-input"
          placeholder="请输入你的答案..."
          :disabled="showResult"
          rows="4"
        />
      </div>

      <!-- Result feedback -->
      <template v-if="showResult">
        <div class="quiz-result" :class="isCorrect ? 'correct' : 'wrong'">
          {{ resultText }}
        </div>
        <div v-if="currentQuestion.explanation" class="quiz-explanation">
          {{ currentQuestion.explanation }}
        </div>
        <div class="quiz-actions">
          <button class="quiz-btn" @click="nextQuestion">下一题</button>
          <button class="quiz-btn secondary" @click="goBack">返回列表</button>
        </div>
      </template>

      <!-- Confirm button (not yet shown result) -->
      <button
        v-else
        class="quiz-btn"
        :disabled="!canConfirm"
        @click="confirmAndSubmit"
      >
        确认
      </button>
    </template>

    <!-- No question yet: show generate options -->
    <template v-else>
      <div class="quiz-generate">
        <h3 class="quiz-generate-title">出题</h3>
        <div class="quiz-type-options">
          <button
            v-for="qt in questionTypes"
            :key="qt.value"
            class="quiz-type-btn"
            :class="{ active: selectedType === qt.value }"
            @click="selectedType = qt.value"
          >
            {{ qt.label }}
          </button>
        </div>
        <button class="quiz-btn" @click="retry">生成题目</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useQuiz } from '../../composables/useQuiz';

const nodeStore = useNodeStore();
const { activeNode } = storeToRefs(nodeStore);

const {
  isBusy, errorMessage, currentQuestion, selectedOption, showResult,
  generateQuestion, submitAnswer, selectOption, confirmSelection, reset,
} = useQuiz();

const optionLabels = ['A', 'B', 'C', 'D'];
const shortAnswerText = ref('');
const selectedType = ref('single_choice');

const questionTypes = [
  { value: 'single_choice', label: '选择题' },
  { value: 'true_false', label: '判断题' },
  { value: 'short_answer', label: '简答题' },
];

const typeLabel = computed(() => {
  return currentQuestion.value?.type_label ?? '选择题';
});

const isCorrect = computed(() => {
  if (!currentQuestion.value) return false;
  if (currentQuestion.value.question_type === 'short_answer') {
    return true; // Short answer is self-graded or LLM-graded
  }
  if (selectedOption.value === null) return false;
  return selectedOption.value === currentQuestion.value.correct_index;
});

const resultText = computed(() => {
  if (!currentQuestion.value) return '';
  if (currentQuestion.value.question_type === 'short_answer') {
    return '简答题——请对照参考答案自行评估';
  }
  return isCorrect.value ? '回答正确！' : '回答错误';
});

const canConfirm = computed(() => {
  if (!currentQuestion.value) return false;
  if (currentQuestion.value.question_type === 'short_answer') {
    return shortAnswerText.value.trim().length > 0;
  }
  return selectedOption.value !== null;
});

function optionClasses(idx: number): Record<string, boolean> {
  return {
    selected: selectedOption.value === idx && !showResult.value,
    correct: showResult.value && idx === currentQuestion.value!.correct_index,
    wrong: showResult.value && idx === selectedOption.value && idx !== currentQuestion.value!.correct_index,
  };
}

function tfOptionClasses(idx: number): Record<string, boolean> {
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
  if (currentQuestion.value) {
    const correct = currentQuestion.value.question_type === 'short_answer'
      ? true // Self-graded
      : selectedOption.value === currentQuestion.value.correct_index;
    await submitAnswer(
      currentQuestion.value.node_id,
      correct,
      currentQuestion.value.id,
    );
  }
}

function retry(): void {
  if (activeNode.value) {
    generateQuestion(activeNode.value.id, selectedType.value);
  }
}

function nextQuestion(): void {
  if (activeNode.value) {
    reset();
    shortAnswerText.value = '';
    generateQuestion(activeNode.value.id, selectedType.value);
  }
}

function goBack(): void {
  reset();
  shortAnswerText.value = '';
  nodeStore.cancelOperation();
}

onMounted(() => {
  if (activeNode.value) {
    generateQuestion(activeNode.value.id, selectedType.value);
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

.quiz-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}

/* Question type row */
.quiz-type-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.quiz-type-badge {
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(102, 255, 229, 0.15);
  border: 1px solid var(--color-glass-border);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary);
}

.quiz-difficulty {
  font-size: 12px;
  color: var(--color-primary);
  opacity: 0.5;
}

/* Generate options */
.quiz-generate {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.quiz-generate-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--color-primary);
}

.quiz-type-options {
  display: flex;
  gap: 8px;
}

.quiz-type-btn {
  padding: 8px 20px;
  border-radius: 12px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.quiz-type-btn.active {
  background: rgba(102, 255, 229, 0.2);
  border-color: rgba(102, 255, 229, 0.4);
}

.quiz-type-btn:hover {
  background: rgba(102, 255, 229, 0.12);
}

/* Question text */
.quiz-question {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-primary);
  line-height: 1.5;
}

/* Single choice */
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

/* True/false options */
.quiz-tf-options {
  display: flex;
  gap: 12px;
}

.quiz-tf-option {
  flex: 1;
  cursor: pointer;
}

.quiz-tf-option :deep(.glass-raised) {
  box-shadow:
    4px 4px 8px var(--shadow-raised-a),
    -4px -4px 8px var(--shadow-raised-b);
}

.quiz-tf-option.selected :deep(.glass-content) {
  background: rgba(102, 255, 229, 0.15);
}

.quiz-tf-option.correct :deep(.glass-content) {
  background: rgba(46, 204, 113, 0.25);
}

.quiz-tf-option.wrong :deep(.glass-content) {
  background: rgba(255, 80, 80, 0.2);
}

.quiz-tf-content {
  width: 100%;
  padding: 16px;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-primary);
}

/* Short answer */
.quiz-sa-area {
  display: flex;
  flex-direction: column;
}

.quiz-sa-input {
  width: 100%;
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-primary);
  font-size: 15px;
  line-height: 1.5;
  resize: vertical;
  font-family: inherit;
}

.quiz-sa-input:focus {
  outline: none;
  border-color: rgba(102, 255, 229, 0.4);
  background: rgba(255, 255, 255, 0.12);
}

.quiz-sa-input:disabled {
  opacity: 0.5;
}

.quiz-sa-input::placeholder {
  color: var(--color-primary);
  opacity: 0.35;
}

/* Result */
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

/* Buttons */
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

.quiz-btn.secondary {
  background: rgba(255, 255, 255, 0.06);
}

.quiz-btn.secondary:hover {
  background: rgba(255, 255, 255, 0.12);
}
</style>
