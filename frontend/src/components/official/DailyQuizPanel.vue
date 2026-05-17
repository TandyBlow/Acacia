<template>
  <div class="daily-quiz-panel">
    <!-- Loading -->
    <template v-if="isBusy && queue.length === 0">
      <div class="quiz-loading">加载中...</div>
    </template>

    <!-- Error -->
    <template v-else-if="errorMessage && queue.length === 0">
      <div class="quiz-error">{{ errorMessage }}</div>
      <div class="quiz-actions">
        <button class="quiz-btn" @click="startSession">重试</button>
        <button class="quiz-btn secondary" @click="goBack">返回</button>
      </div>
    </template>

    <!-- Empty queue -->
    <template v-else-if="queue.length === 0 && !isBusy">
      <div class="quiz-completed">
        <div class="completed-icon">&#10003;</div>
        <div class="completed-text">{{ UI.official.noDueItems }}</div>
        <button class="quiz-btn" @click="goBack">{{ UI.official.backToHome }}</button>
      </div>
    </template>

    <!-- Session finished -->
    <template v-else-if="sessionFinished">
      <div class="quiz-completed">
        <div class="completed-icon">&#10003;</div>
        <div class="completed-text">{{ UI.official.sessionComplete }}</div>
        <div class="quiz-stats">
          <div class="stat-item">{{ UI.official.reviewStats(sessionCorrect, queue.length) }}</div>
          <div class="stat-item">{{ UI.official.reviewedToday(queue.length) }}</div>
        </div>
        <button class="quiz-btn" @click="goBack">{{ UI.official.backToHome }}</button>
      </div>
    </template>

    <!-- Review session active -->
    <template v-else>
      <!-- Progress bar -->
      <div class="quiz-progress-row">
        <span class="quiz-progress-text">{{ UI.official.sessionProgress(progress.current, progress.total) }}</span>
        <div class="quiz-progress-bar">
          <div class="quiz-progress-fill" :style="{ width: progress.percent + '%' }"></div>
        </div>
        <button class="quiz-finish-btn" @click="finishSession">{{ UI.official.finishEarly }}</button>
      </div>

      <!-- Current node name -->
      <div class="quiz-node-name">{{ currentItem?.node_name ?? '' }}</div>

      <!-- Generating question -->
      <template v-if="isBusy && !currentQuestion">
        <div class="quiz-loading">出题中...</div>
      </template>

      <!-- Question error (non-fatal, skip to next) -->
      <template v-else-if="errorMessage && !currentQuestion">
        <div class="quiz-error">{{ errorMessage }}</div>
        <div class="quiz-actions">
          <button class="quiz-btn" @click="generateQuestion">重试</button>
          <button class="quiz-btn secondary" @click="skipQuestion">跳过</button>
        </div>
      </template>

      <!-- Question active -->
      <template v-else-if="currentQuestion">
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
            <button class="quiz-btn" @click="advanceToNext">
              {{ hasNext ? UI.official.nextQuestion : '完成' }}
            </button>
          </div>
        </template>

        <!-- Confirm button -->
        <button
          v-else
          class="quiz-btn"
          :disabled="!canConfirm"
          @click="confirmAndSubmit"
        >
          确认
        </button>
      </template>

      <!-- No question generated yet (first load) -->
      <template v-else>
        <div class="quiz-generate">
          <p class="quiz-generate-desc">准备为你出题...</p>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useDailyQuiz } from '../../composables/useDailyQuiz';
import { UI } from '../../constants/uiStrings';

const nodeStore = useNodeStore();

const {
  isBusy, errorMessage, currentQuestion, selectedOption, showResult,
  queue, sessionCorrect, sessionFinished,
  currentItem, progress, hasNext,
  generateQuestion, submitAnswer, selectOption, confirmSelection, reset,
  markCompleted, fetchQueue, nextQuestion,
} = useDailyQuiz();

const optionLabels = ['A', 'B', 'C', 'D'];
const shortAnswerText = ref('');

const typeLabel = computed(() => {
  return currentQuestion.value?.type_label ?? '选择题';
});

const isCorrect = computed(() => {
  if (!currentQuestion.value) return false;
  if (currentQuestion.value.question_type === 'short_answer') {
    const options = currentQuestion.value.options as unknown as { keywords?: string[] } | null;
    if (options && Array.isArray(options.keywords) && options.keywords.length > 0) {
      const userLower = shortAnswerText.value.toLowerCase().trim();
      if (userLower.length === 0) return false;
      return options.keywords.some((kw: string) => userLower.includes(kw.toLowerCase()));
    }
    return false;
  }
  if (selectedOption.value === null) return false;
  return selectedOption.value === currentQuestion.value.correct_index;
});

const resultText = computed(() => {
  return isCorrect.value ? UI.official.correct : UI.official.incorrect;
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
      ? isCorrect.value
      : selectedOption.value === currentQuestion.value.correct_index;
    await submitAnswer(correct);
  }
}

async function advanceToNext(): Promise<void> {
  shortAnswerText.value = '';
  await nextQuestion();
}

async function skipQuestion(): Promise<void> {
  shortAnswerText.value = '';
  await nextQuestion();
}

async function startSession(): Promise<void> {
  reset();
  shortAnswerText.value = '';
  await fetchQueue();
  if (queue.value.length > 0) {
    await generateQuestion();
  }
}

async function finishSession(): Promise<void> {
  await markCompleted();
  nodeStore.checkDailyQuizStatus();
  reset();
  shortAnswerText.value = '';
  sessionFinished.value = true;
}

function goBack(): void {
  reset();
  shortAnswerText.value = '';
  nodeStore.checkDailyQuizStatus();
  nodeStore.onKnobClick();
}

onMounted(async () => {
  await fetchQueue();
  if (queue.value.length > 0) {
    await generateQuestion();
  }
});
</script>

<style scoped>
.daily-quiz-panel {
  width: 100%;
  height: 100%;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
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

/* Progress bar */
.quiz-progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.quiz-progress-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-primary);
  opacity: 0.7;
  white-space: nowrap;
  min-width: 36px;
}

.quiz-progress-bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.quiz-progress-fill {
  height: 100%;
  border-radius: 3px;
  background: rgba(102, 255, 229, 0.5);
  transition: width 0.3s ease;
}

.quiz-finish-btn {
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-primary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.quiz-finish-btn:hover {
  opacity: 1;
}

/* Current node name */
.quiz-node-name {
  font-size: 14px;
  font-weight: 600;
  color: #FFBB33;
  opacity: 0.8;
}

/* Completed state */
.quiz-completed {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.completed-icon {
  font-size: 48px;
  color: #27ae60;
}

.completed-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-primary);
  text-align: center;
}

.quiz-stats {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-item {
  font-size: 14px;
  color: var(--color-primary);
  opacity: 0.6;
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

/* Generate mode */
.quiz-generate {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.quiz-generate-desc {
  margin: 0;
  font-size: 14px;
  color: var(--color-primary);
  opacity: 0.6;
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

/* True/false */
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
