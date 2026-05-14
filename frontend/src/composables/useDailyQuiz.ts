import { ref } from 'vue';
import { getToken } from '../utils/api';

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

  async function checkStatus(): Promise<{ completed: boolean }> {
    const url = `${getBackendUrl()}/daily-quiz/status`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as any).detail ?? '获取每日答题状态失败');
    }
    return res.json();
  }

  async function generateQuestion(): Promise<void> {
    isBusy.value = true;
    errorMessage.value = null;
    currentQuestion.value = null;
    selectedOption.value = null;
    showResult.value = false;

    try {
      const url = `${getBackendUrl()}/generate-daily-quiz`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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
    } catch {
      // Submit failure is non-blocking
    }
  }

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
  }

  return {
    isBusy,
    errorMessage,
    currentQuestion,
    selectedOption,
    showResult,
    checkStatus,
    generateQuestion,
    submitAnswer,
    markCompleted,
    selectOption,
    confirmSelection,
    reset,
  };
}
