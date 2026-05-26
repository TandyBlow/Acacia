<template>
  <div class="daily-quiz-panel">
    <div class="activity-layout">
      <div class="activity-glass-host">
        <GlassWrapper>
          <div class="activity-scroll">
            <div class="quiz-inner">
              <!-- Loading (initial) -->
              <template v-if="isBusy && queue.length === 0">
                <div class="quiz-state-center">
                  <div class="quiz-spinner"></div>
                  <div class="quiz-state-label">加载中...</div>
                </div>
              </template>

              <!-- Error (initial) -->
              <template v-else-if="errorMessage && queue.length === 0">
                <div class="quiz-state-center">
                  <div class="quiz-state-icon-circle quiz-state-error">
                    <span class="quiz-state-icon">!</span>
                  </div>
                  <div class="quiz-state-label">{{ errorMessage }}</div>
                  <div class="quiz-state-actions">
                    <button class="quiz-btn-ghost" @click="startSession">重试</button>
                    <GlassWrapper class="quiz-btn-glass" interactive @click="goBack">
                      <div class="quiz-btn-glass-label">返回</div>
                    </GlassWrapper>
                  </div>
                </div>
              </template>

              <!-- Empty queue -->
              <template v-else-if="queue.length === 0 && !isBusy">
                <div class="quiz-state-center">
                  <div class="quiz-state-icon-host">
                    <GlassWrapper shape="circle">
                      <div class="quiz-state-icon check">&#10003;</div>
                    </GlassWrapper>
                  </div>
                  <div class="quiz-state-label">{{ UI.official.noDueItems }}</div>
                  <GlassWrapper class="quiz-btn-glass" interactive @click="goBack">
                    <div class="quiz-btn-glass-label">{{ UI.official.backToHome }}</div>
                  </GlassWrapper>
                </div>
              </template>

              <!-- Session finished -->
              <template v-else-if="sessionFinished">
                <div class="quiz-state-center">
                  <div class="quiz-state-icon-host">
                    <GlassWrapper shape="circle">
                      <div class="quiz-state-icon check">&#10003;</div>
                    </GlassWrapper>
                  </div>
                  <div class="quiz-state-label">{{ UI.official.sessionComplete }}</div>
                  <div class="quiz-stats">
                    <div class="quiz-stat">{{ UI.official.reviewStats(sessionCorrect, queue.length) }}</div>
                    <div class="quiz-stat">{{ UI.official.reviewedToday(queue.length) }}</div>
                  </div>
                  <GlassWrapper class="quiz-btn-glass" interactive @click="goBack">
                    <div class="quiz-btn-glass-label">{{ UI.official.backToHome }}</div>
                  </GlassWrapper>
                </div>
              </template>

              <!-- Active session -->
              <template v-else>
                <!-- Progress bar -->
                <div class="quiz-progress-row">
                  <span class="quiz-progress-text">{{ UI.official.sessionProgress(progress.current, progress.total) }}</span>
                  <div class="quiz-progress-track">
                    <div class="quiz-progress-fill" :style="{ width: progress.percent + '%' }"></div>
                  </div>
                  <button class="quiz-finish-btn" @click="finishSession">{{ UI.official.finishEarly }}</button>
                </div>

                <!-- Node name -->
                <div class="quiz-node-name">{{ currentItem?.node_name ?? '' }}</div>

                <!-- Generating question -->
                <template v-if="isBusy && !currentQuestion">
                  <div class="quiz-state-center quiz-state-compact">
                    <div class="quiz-spinner quiz-spinner-sm"></div>
                    <div class="quiz-state-label">出题中...</div>
                  </div>
                </template>

                <!-- Question error (non-fatal) -->
                <template v-else-if="errorMessage && !currentQuestion">
                  <div class="quiz-error-card">
                    <div class="quiz-error-card-text">{{ errorMessage }}</div>
                    <div class="quiz-state-actions">
                      <button class="quiz-btn-ghost" @click="generateQuestion">重试</button>
                      <button class="quiz-btn-ghost" @click="skipQuestion">跳过</button>
                    </div>
                  </div>
                </template>

                <!-- Question active -->
                <template v-else-if="currentQuestion">
                  <!-- Type + difficulty row -->
                  <div class="quiz-meta-row">
                    <span class="quiz-type-badge">{{ typeLabel }}</span>
                    <span v-if="currentQuestion.difficulty" class="quiz-difficulty">{{ currentQuestion.difficulty }}</span>
                  </div>

                  <!-- Question text -->
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
                    <GlassWrapper inset class="quiz-sa-wrapper">
                      <textarea
                        v-model="shortAnswerText"
                        class="quiz-sa-input"
                        placeholder="请输入你的答案..."
                        :disabled="showResult"
                        rows="4"
                      />
                    </GlassWrapper>
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
                      <GlassWrapper class="quiz-btn-glass" interactive @click="advanceToNext">
                        <div class="quiz-btn-glass-label">{{ hasNext ? UI.official.nextQuestion : '完成' }}</div>
                      </GlassWrapper>
                    </div>
                  </template>

                  <!-- Confirm button -->
                  <div v-else class="quiz-actions">
                    <GlassWrapper
                      class="quiz-btn-glass"
                      :class="{ 'quiz-btn-glass--disabled': !canConfirm }"
                      :interactive="canConfirm"
                      @click="canConfirm && confirmAndSubmit()"
                    >
                      <div class="quiz-btn-glass-label">确认</div>
                    </GlassWrapper>
                  </div>
                </template>

                <!-- No question generated yet -->
                <template v-else>
                  <div class="quiz-state-center quiz-state-compact">
                    <div class="quiz-spinner quiz-spinner-sm"></div>
                    <div class="quiz-state-label">准备为你出题...</div>
                  </div>
                </template>
              </template>
            </div>
          </div>
        </GlassWrapper>
      </div>
    </div>
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
/* ============================================
   Layout
   ============================================ */
.daily-quiz-panel {
  width: 100%;
  height: 100%;
}

.activity-layout {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  height: 100%;
  padding: 1px;
}

.activity-glass-host {
  flex: 1;
  min-height: 0;
}

.activity-scroll {
  width: 100%;
  height: 100%;
  overflow-y: auto;
}

.quiz-inner {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
}

/* ============================================
   State center (loading / error / empty / completed)
   ============================================ */
.quiz-state-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px 0;
}

.quiz-state-compact {
  flex: 1;
}

.quiz-state-label {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-primary);
  opacity: 0.7;
  text-align: center;
}

.quiz-state-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

/* Checkmark circle host */
.quiz-state-icon-host {
  width: 72px;
  height: 72px;
}

.quiz-state-icon {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  font-size: 32px;
  font-weight: 700;
}

.quiz-state-icon.check {
  color: #27ae60;
}

/* Error icon circle */
.quiz-state-icon-circle {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 1px solid var(--color-glass-border);
  background: var(--color-glass-bg);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow:
    5px 5px 10px var(--shadow-raised-a),
    -5px -5px 10px var(--shadow-raised-b);
  display: grid;
  place-items: center;
}

.quiz-state-icon-circle .quiz-state-icon {
  color: #e74c3c;
}

/* ============================================
   Spinner
   ============================================ */
.quiz-spinner {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 3px solid rgba(102, 255, 229, 0.15);
  border-top-color: var(--color-hint);
  animation: quiz-spin 0.8s linear infinite;
}

.quiz-spinner-sm {
  width: 28px;
  height: 28px;
  border-width: 2px;
}

@keyframes quiz-spin {
  to { transform: rotate(360deg); }
}

/* ============================================
   Stats (session complete)
   ============================================ */
.quiz-stats {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.quiz-stat {
  font-size: 14px;
  color: var(--color-primary);
  opacity: 0.55;
}

/* ============================================
   Progress bar
   ============================================ */
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

.quiz-progress-track {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  box-shadow:
    inset 2px 2px 4px var(--shadow-inset-a),
    inset -2px -2px 4px var(--shadow-inset-b);
  overflow: hidden;
}

.quiz-progress-fill {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, rgba(102, 255, 229, 0.35), rgba(102, 255, 229, 0.7));
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
  opacity: 0.55;
  transition: opacity 0.2s;
}

.quiz-finish-btn:hover {
  opacity: 0.9;
}

/* ============================================
   Node name
   ============================================ */
.quiz-node-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-hint);
  opacity: 0.85;
}

/* ============================================
   Question meta (type badge + difficulty)
   ============================================ */
.quiz-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.quiz-type-badge {
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(102, 255, 229, 0.12);
  border: 1px solid var(--color-glass-border);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary);
}

.quiz-difficulty {
  font-size: 12px;
  color: var(--color-primary);
  opacity: 0.45;
}

/* ============================================
   Question text
   ============================================ */
.quiz-question {
  font-size: 19px;
  font-weight: 700;
  color: var(--color-primary);
  line-height: 1.55;
}

/* ============================================
   Error card (non-fatal)
   ============================================ */
.quiz-error-card {
  padding: 16px;
  border-radius: 16px;
  background: rgba(255, 80, 80, 0.1);
  border: 1px solid rgba(255, 80, 80, 0.2);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.quiz-error-card-text {
  font-size: 14px;
  color: #c0392b;
  text-align: center;
}

/* ============================================
   Single choice options
   ============================================ */
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
  padding: 14px 16px;
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
  font-size: 13px;
  font-weight: 700;
  color: var(--color-primary);
  flex-shrink: 0;
}

.quiz-option-text {
  font-size: 15px;
  color: var(--color-primary);
  line-height: 1.4;
}

/* ============================================
   True/False options
   ============================================ */
.quiz-tf-options {
  display: flex;
  gap: 12px;
}

.quiz-tf-option {
  flex: 1;
  cursor: pointer;
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

/* ============================================
   Short answer
   ============================================ */
.quiz-sa-area {
  display: flex;
  flex-direction: column;
}

.quiz-sa-wrapper {
  width: 100%;
}

.quiz-sa-input {
  width: 100%;
  padding: 14px 16px;
  border: none;
  background: transparent;
  color: var(--color-primary);
  font-size: 15px;
  line-height: 1.5;
  resize: vertical;
  font-family: inherit;
}

.quiz-sa-input:focus {
  outline: none;
}

.quiz-sa-input:disabled {
  opacity: 0.45;
}

.quiz-sa-input::placeholder {
  color: var(--color-primary);
  opacity: 0.3;
}

/* ============================================
   Result feedback
   ============================================ */
.quiz-result {
  font-size: 20px;
  font-weight: 700;
  text-align: center;
  padding: 8px 0 0;
}

.quiz-result.correct {
  color: #27ae60;
}

.quiz-result.wrong {
  color: #e74c3c;
}

.quiz-explanation {
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--color-glass-border);
  font-size: 14px;
  line-height: 1.55;
  color: var(--color-primary);
}

/* ============================================
   Action buttons
   ============================================ */
.quiz-actions {
  display: flex;
  justify-content: center;
  padding-top: 4px;
}

/* GlassWrapper action button (primary) */
.quiz-btn-glass {
  width: fit-content;
  min-width: 150px;
  align-self: center;
}

.quiz-btn-glass :deep(.glass-content) {
  background: rgba(102, 255, 229, 0.16);
  transition: background 160ms ease;
}

.quiz-btn-glass:hover :deep(.glass-content) {
  background: rgba(102, 255, 229, 0.32);
}

.quiz-btn-glass--disabled {
  opacity: 0.4;
  pointer-events: none;
}

.quiz-btn-glass-label {
  width: 100%;
  padding: 12px 28px;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-primary);
}

/* Ghost button (secondary) */
.quiz-btn-ghost {
  padding: 10px 22px;
  border-radius: 14px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.quiz-btn-ghost:hover {
  background: rgba(255, 255, 255, 0.14);
}
</style>
