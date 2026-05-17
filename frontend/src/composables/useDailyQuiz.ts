import { ref, computed } from 'vue';
import { getToken } from '../utils/api';
import type { DueReviewItem } from '../types/node';

export interface QuizQuestion {
  id: string;
  node_id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  question_type: 'single_choice' | 'true_false' | 'short_answer';
  difficulty: string;
  type_label: string;
}

export function useDailyQuiz() {
  // Queue state
  const queue = ref<DueReviewItem[]>([]);
  const currentIndex = ref(0);
  const sessionCorrect = ref(0);
  const sessionFinished = ref(false);

  // Question state (reused from existing)
  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);
  const currentQuestion = ref<QuizQuestion | null>(null);
  const selectedOption = ref<number | null>(null);
  const showResult = ref(false);

  function getBackendUrl(): string {
    return import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:7860';
  }

  function authHeaders(): Record<string, string> {
    const token = getToken();
    if (token) {
      return { Authorization: `Bearer ${token}` };
    }
    return {};
  }

  // Computed
  const currentItem = computed<DueReviewItem | null>(() => {
    if (currentIndex.value < queue.value.length) {
      return queue.value[currentIndex.value] ?? null;
    }
    return null;
  });

  const progress = computed(() => {
    const total = queue.value.length;
    const current = currentIndex.value;
    return {
      current: total > 0 ? current + 1 : 0,
      total,
      percent: total > 0 ? Math.round(((current) / total) * 100) : 0,
    };
  });

  const hasNext = computed(() => {
    return currentIndex.value < queue.value.length - 1;
  });

  // Fetch review queue
  async function fetchQueue(): Promise<void> {
    isBusy.value = true;
    errorMessage.value = null;
    try {
      const url = `${getBackendUrl()}/daily-review/queue`;
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).detail ?? '获取复习队列失败');
      }
      const data = await res.json();
      queue.value = data.queue ?? [];
      currentIndex.value = 0;
      sessionCorrect.value = 0;
      sessionFinished.value = false;
    } catch (error: unknown) {
      errorMessage.value = error instanceof Error ? error.message : '获取复习队列失败';
    } finally {
      isBusy.value = false;
    }
  }

  // Generate question for current node in queue
  async function generateQuestion(): Promise<void> {
    const item = currentItem.value;
    if (!item) return;

    isBusy.value = true;
    errorMessage.value = null;
    currentQuestion.value = null;
    selectedOption.value = null;
    showResult.value = false;

    try {
      const url = `${getBackendUrl()}/daily-review/generate-question`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: item.node_id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).detail ?? '生成题目失败');
      }
      currentQuestion.value = await res.json();
    } catch (error: unknown) {
      errorMessage.value = error instanceof Error ? error.message : '生成题目失败';
    } finally {
      isBusy.value = false;
    }
  }

  // Submit answer for current question
  async function submitAnswer(isCorrect: boolean): Promise<void> {
    if (!currentQuestion.value) return;
    try {
      const url = `${getBackendUrl()}/submit-answer/${currentQuestion.value.node_id}`;
      await fetch(url, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_correct: isCorrect,
          question_id: currentQuestion.value.id,
        }),
      });
      if (isCorrect) {
        sessionCorrect.value++;
      }
    } catch {
      // Submit failure is non-blocking
    }
  }

  // Move to next item and generate its question
  async function nextQuestion(): Promise<void> {
    if (hasNext.value) {
      currentIndex.value++;
      await generateQuestion();
    } else {
      // Queue exhausted
      sessionFinished.value = true;
    }
  }

  // Check daily review status (due count)
  async function checkStatus(): Promise<{ due_count: number; today_reviewed: number; new_count: number }> {
    const url = `${getBackendUrl()}/daily-quiz/status`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as any).detail ?? '获取状态失败');
    }
    return res.json();
  }

  // Mark daily session complete (optional, for backward compat)
  async function markCompleted(): Promise<void> {
    try {
      const url = `${getBackendUrl()}/daily-quiz/complete`;
      await fetch(url, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      });
    } catch {
      // Non-blocking
    }
  }

  function selectOption(idx: number): void {
    if (showResult.value) return;
    selectedOption.value = idx;
  }

  function confirmSelection(): void {
    showResult.value = true;
  }

  function reset(): void {
    currentQuestion.value = null;
    selectedOption.value = null;
    showResult.value = false;
    errorMessage.value = null;
    queue.value = [];
    currentIndex.value = 0;
    sessionCorrect.value = 0;
    sessionFinished.value = false;
  }

  return {
    // Queue
    queue,
    currentIndex,
    sessionCorrect,
    sessionFinished,
    currentItem,
    progress,
    hasNext,
    fetchQueue,
    nextQuestion,
    // Question
    isBusy,
    errorMessage,
    currentQuestion,
    selectedOption,
    showResult,
    generateQuestion,
    submitAnswer,
    markCompleted,
    selectOption,
    confirmSelection,
    checkStatus,
    reset,
  };
}
