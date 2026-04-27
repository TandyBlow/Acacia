<template>
  <div class="history-panel">
    <!-- Header tabs -->
    <div class="history-tabs">
      <button
        class="history-tab"
        :class="{ active: tab === 'node' }"
        @click="switchTab('node')"
      >
        本节点题库
      </button>
      <button
        class="history-tab"
        :class="{ active: tab === 'wrong' }"
        @click="switchTab('wrong')"
      >
        所有错题
      </button>
    </div>

    <!-- Loading -->
    <template v-if="isBusy">
      <div class="history-loading">加载中...</div>
    </template>

    <!-- Error -->
    <template v-else-if="errorMessage">
      <div class="history-error">{{ errorMessage }}</div>
      <button class="history-btn" @click="refresh">重试</button>
    </template>

    <!-- Quiz mode: showing a single question inline -->
    <template v-else-if="activeQuestion">
      <button class="history-back" @click="activeQuestion = null">
        ← 返回列表
      </button>

      <div class="history-quiz">
        <span class="quiz-type-badge">{{ activeQuestion.type_label }}</span>
        <div class="history-question-text">{{ activeQuestion.question }}</div>

        <!-- Single choice -->
        <div v-if="activeQuestion.question_type === 'single_choice'" class="history-options">
          <GlassWrapper
            v-for="(option, idx) in activeQuestion.options"
            :key="idx"
            class="history-option"
            :class="quizOptionClasses(idx)"
            interactive
            @click="onQuizOptionClick(idx)"
          >
            <div class="history-option-content">
              <span class="quiz-option-label">{{ optionLabels[idx] }}</span>
              <span class="quiz-option-text">{{ option }}</span>
            </div>
          </GlassWrapper>
        </div>

        <!-- True/false -->
        <div v-else-if="activeQuestion.question_type === 'true_false'" class="quiz-tf-options">
          <GlassWrapper
            class="quiz-tf-option"
            :class="quizTfClasses(0)"
            interactive
            @click="onQuizOptionClick(0)"
          >
            <div class="quiz-tf-content">正确</div>
          </GlassWrapper>
          <GlassWrapper
            class="quiz-tf-option"
            :class="quizTfClasses(1)"
            interactive
            @click="onQuizOptionClick(1)"
          >
            <div class="quiz-tf-content">错误</div>
          </GlassWrapper>
        </div>

        <!-- Short answer -->
        <div v-else-if="activeQuestion.question_type === 'short_answer'" class="quiz-sa-area">
          <textarea
            v-model="quizShortAnswer"
            class="quiz-sa-input"
            placeholder="请输入你的答案..."
            :disabled="quizShowResult"
            rows="4"
          />
        </div>

        <template v-if="quizShowResult">
          <div class="quiz-result" :class="quizIsCorrect ? 'correct' : 'wrong'">
            {{ quizResultText }}
          </div>
          <div v-if="activeQuestion.explanation" class="quiz-explanation">
            {{ activeQuestion.explanation }}
          </div>
          <button class="history-btn" @click="activeQuestion = null">返回列表</button>
        </template>

        <button
          v-else
          class="history-btn"
          :disabled="!quizCanConfirm"
          @click="confirmQuizAnswer"
        >
          确认
        </button>
      </div>
    </template>

    <!-- List mode: question list -->
    <template v-else>
      <template v-if="tab === 'node' && !activeNode">
        <div class="history-empty">请先选择一个知识点</div>
      </template>

      <template v-else-if="tab === 'node' && nodeQuestions.length === 0">
        <div class="history-empty">该知识点暂无题目，前去出题生成吧</div>
      </template>

      <template v-else-if="tab === 'wrong' && wrongList.length === 0">
        <div class="history-empty">暂无错题，继续保持！</div>
      </template>

      <div v-else class="history-list">
        <GlassWrapper
          v-for="q in displayList"
          :key="q.id"
          class="history-item"
          interactive
          @click="openQuestion(q)"
        >
          <div class="history-item-content">
            <div class="history-item-header">
              <span class="quiz-type-badge">{{ q.type_label }}</span>
              <span
                v-if="tab === 'node' && hasResult(q)"
                class="history-status"
                :class="getResult(q).last_correct ? 'correct' : 'wrong'"
              >
                {{ getResult(q).last_correct ? '答对' : '答错' }}
              </span>
            </div>
            <div class="history-item-question">{{ q.question }}</div>
          </div>
        </GlassWrapper>
      </div>
    </template>

    <!-- Bottom actions -->
    <div class="history-footer">
      <button class="history-btn secondary" @click="goBack">返回</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useQuiz } from '../../composables/useQuiz';
import type { QuizQuestionListItem, QuizQuestion } from '../../composables/useQuiz';
import { apiFetch } from '../../utils/api';

const nodeStore = useNodeStore();
const { activeNode } = storeToRefs(nodeStore);

const {
  isBusy, errorMessage,
  questions: nodeQuestions, wrongQuestions,
  fetchQuestions, fetchWrongQuestions, submitAnswer,
} = useQuiz();

const tab = ref<'node' | 'wrong'>('node');

// Inline quiz state
const activeQuestion = ref<QuizQuestion | null>(null);
const quizSelectedOption = ref<number | null>(null);
const quizShowResult = ref(false);
const quizShortAnswer = ref('');

const optionLabels = ['A', 'B', 'C', 'D'];

const wrongList = computed(() => wrongQuestions.value);

const displayList = computed(() => {
  if (tab.value === 'node') return nodeQuestions.value;
  return wrongList.value;
});

const quizIsCorrect = computed(() => {
  if (!activeQuestion.value) return false;
  if (activeQuestion.value.question_type === 'short_answer') return true;
  if (quizSelectedOption.value === null) return false;
  return quizSelectedOption.value === activeQuestion.value.correct_index;
});

const quizResultText = computed(() => {
  if (!activeQuestion.value) return '';
  if (activeQuestion.value.question_type === 'short_answer') {
    return '简答题——请对照参考答案自行评估';
  }
  return quizIsCorrect.value ? '回答正确！' : '回答错误';
});

const quizCanConfirm = computed(() => {
  if (!activeQuestion.value) return false;
  if (activeQuestion.value.question_type === 'short_answer') {
    return quizShortAnswer.value.trim().length > 0;
  }
  return quizSelectedOption.value !== null;
});

function hasResult(q: QuizQuestionListItem | QuizQuestion): boolean {
  return 'answered' in q && q.answered;
}

function getResult(q: QuizQuestionListItem | QuizQuestion) {
  return q as QuizQuestionListItem;
}

function quizOptionClasses(idx: number): Record<string, boolean> {
  return {
    selected: quizSelectedOption.value === idx && !quizShowResult.value,
    correct: quizShowResult.value && idx === activeQuestion.value!.correct_index,
    wrong: quizShowResult.value && idx === quizSelectedOption.value && idx !== activeQuestion.value!.correct_index,
  };
}

function quizTfClasses(idx: number): Record<string, boolean> {
  return {
    selected: quizSelectedOption.value === idx && !quizShowResult.value,
    correct: quizShowResult.value && idx === activeQuestion.value!.correct_index,
    wrong: quizShowResult.value && idx === quizSelectedOption.value && idx !== activeQuestion.value!.correct_index,
  };
}

function onQuizOptionClick(idx: number): void {
  if (quizShowResult.value) return;
  quizSelectedOption.value = idx;
}

async function openQuestion(q: QuizQuestionListItem | QuizQuestion): Promise<void> {
  try {
    // Fetch full question with correct_index (not exposed in list)
    const full = await apiFetch<QuizQuestion>(`/quiz-questions/${q.node_id || activeNode.value?.id}/${q.id}`);
    activeQuestion.value = full;
    quizSelectedOption.value = null;
    quizShowResult.value = false;
    quizShortAnswer.value = '';
  } catch {
    // If fetch fails, try to use what we have
  }
}

async function confirmQuizAnswer(): Promise<void> {
  quizShowResult.value = true;
  if (activeQuestion.value) {
    const correct = activeQuestion.value.question_type === 'short_answer'
      ? true
      : quizSelectedOption.value === activeQuestion.value.correct_index;
    await submitAnswer(
      activeQuestion.value.node_id,
      correct,
      activeQuestion.value.id,
    );
  }
}

function switchTab(t: 'node' | 'wrong'): void {
  tab.value = t;
  activeQuestion.value = null;
  refresh();
}

function refresh(): void {
  if (tab.value === 'node' && activeNode.value) {
    fetchQuestions(activeNode.value.id);
  } else if (tab.value === 'wrong') {
    fetchWrongQuestions();
  }
}

function goBack(): void {
  activeQuestion.value = null;
  nodeStore.cancelOperation();
}

onMounted(() => {
  if (activeNode.value) {
    fetchQuestions(activeNode.value.id);
  }
});
</script>

<style scoped>
.history-panel {
  width: 100%;
  height: 100%;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
}

.history-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-glass-border);
}

.history-tab {
  flex: 1;
  padding: 8px 0;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.history-tab.active {
  background: rgba(102, 255, 229, 0.18);
}

.history-tab:hover:not(.active) {
  background: rgba(255, 255, 255, 0.06);
}

.history-loading {
  flex: 1;
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-primary);
  opacity: 0.7;
}

.history-error {
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(255, 80, 80, 0.12);
  color: #c0392b;
  font-size: 14px;
}

.history-empty {
  flex: 1;
  display: grid;
  place-items: center;
  font-size: 16px;
  color: var(--color-primary);
  opacity: 0.5;
}

.history-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
}

.history-item {
  width: 100%;
  cursor: pointer;
}

.history-item :deep(.glass-raised) {
  box-shadow:
    4px 4px 8px var(--shadow-raised-a),
    -4px -4px 8px var(--shadow-raised-b);
}

.history-item :deep(.glass-content):hover {
  background: rgba(255, 255, 255, 0.04);
}

.history-item-content {
  width: 100%;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.history-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.quiz-type-badge {
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(102, 255, 229, 0.15);
  border: 1px solid var(--color-glass-border);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-primary);
}

.history-status {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
}

.history-status.correct {
  color: #27ae60;
  background: rgba(46, 204, 113, 0.15);
}

.history-status.wrong {
  color: #e74c3c;
  background: rgba(255, 80, 80, 0.12);
}

.history-item-question {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-primary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.history-back {
  align-self: flex-start;
  padding: 6px 14px;
  border-radius: 10px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.history-back:hover {
  background: rgba(255, 255, 255, 0.12);
}

/* Inline quiz styles */
.history-quiz {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
}

.history-question-text {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-primary);
  line-height: 1.5;
}

.history-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-option {
  width: 100%;
  cursor: pointer;
}

.history-option :deep(.glass-raised) {
  box-shadow:
    4px 4px 8px var(--shadow-raised-a),
    -4px -4px 8px var(--shadow-raised-b);
}

.history-option.selected :deep(.glass-content) {
  background: rgba(102, 255, 229, 0.15);
}

.history-option.correct :deep(.glass-content) {
  background: rgba(46, 204, 113, 0.25);
}

.history-option.wrong :deep(.glass-content) {
  background: rgba(255, 80, 80, 0.2);
}

.history-option-content {
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
}

.quiz-sa-input::placeholder {
  color: var(--color-primary);
  opacity: 0.35;
}

.quiz-result {
  font-size: 20px;
  font-weight: 700;
  text-align: center;
  padding: 8px;
}

.quiz-result.correct { color: #27ae60; }
.quiz-result.wrong { color: #e74c3c; }

.quiz-explanation {
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-primary);
}

.history-footer {
  display: flex;
  justify-content: center;
}

.history-btn {
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

.history-btn:hover:not(:disabled) {
  background: rgba(102, 255, 229, 0.35);
}

.history-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.history-btn.secondary {
  background: rgba(255, 255, 255, 0.06);
}

.history-btn.secondary:hover {
  background: rgba(255, 255, 255, 0.12);
}
</style>
