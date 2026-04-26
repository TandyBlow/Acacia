import { ref } from 'vue';
import { apiFetch } from '../utils/api';

export interface QuizQuestion {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  node_id: string;
}

export function useQuiz() {
  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);
  const currentQuestion = ref<QuizQuestion | null>(null);
  const selectedOption = ref<number | null>(null);
  const showResult = ref(false);

  async function generateQuestion(nodeId: string): Promise<void> {
    isBusy.value = true;
    errorMessage.value = null;
    currentQuestion.value = null;
    selectedOption.value = null;
    showResult.value = false;
    try {
      currentQuestion.value = await apiFetch<QuizQuestion>(`/generate-question/${nodeId}`, {
        method: 'POST',
      });
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : '出题失败';
    } finally {
      isBusy.value = false;
    }
  }

  async function submitAnswer(nodeId: string, isCorrect: boolean): Promise<void> {
    try {
      await apiFetch(`/submit-answer/${nodeId}`, {
        method: 'POST',
        body: JSON.stringify({ is_correct: isCorrect }),
      });
    } catch {
      // Silent fail for answer recording
    }
  }

  function selectOption(index: number): void {
    if (showResult.value) return;
    selectedOption.value = index;
  }

  function confirmSelection(): void {
    if (selectedOption.value === null || !currentQuestion.value) return;
    showResult.value = true;
  }

  function reset(): void {
    currentQuestion.value = null;
    selectedOption.value = null;
    showResult.value = false;
    errorMessage.value = null;
  }

  return {
    isBusy, errorMessage, currentQuestion, selectedOption, showResult,
    generateQuestion, submitAnswer, selectOption, confirmSelection, reset,
  };
}
