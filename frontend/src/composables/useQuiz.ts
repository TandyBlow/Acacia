import { ref } from 'vue';
import { apiFetch } from '../utils/api';

export interface QuizQuestion {
  id?: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  node_id: string;
  question_type?: string;
  type_label?: string;
  difficulty?: string;
}

export interface QuizQuestionListItem {
  id: string;
  node_id: string;
  question: string;
  options: any;
  explanation: string;
  question_type: string;
  type_label: string;
  difficulty: string;
  created_at: string;
  answered: boolean;
  last_correct: boolean;
}

export interface BatchGenerateResult {
  node_id: string;
  questions: QuizQuestion[];
}

export function useQuiz() {
  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);
  const currentQuestion = ref<QuizQuestion | null>(null);
  const selectedOption = ref<number | null>(null);
  const showResult = ref(false);
  const questions = ref<QuizQuestionListItem[]>([]);
  const wrongQuestions = ref<QuizQuestion[]>([]);

  async function generateQuestion(
    nodeId: string,
    questionType: string = 'single_choice',
  ): Promise<void> {
    isBusy.value = true;
    errorMessage.value = null;
    currentQuestion.value = null;
    selectedOption.value = null;
    showResult.value = false;
    try {
      const params = new URLSearchParams({ question_type: questionType });
      currentQuestion.value = await apiFetch<QuizQuestion>(
        `/generate-question/${nodeId}?${params}`,
        { method: 'POST' },
      );
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : '出题失败';
    } finally {
      isBusy.value = false;
    }
  }

  async function generateBatch(
    nodeId: string,
    count: number = 5,
    includeChildren: boolean = false,
    questionTypes: string[] = ['single_choice'],
  ): Promise<BatchGenerateResult | null> {
    isBusy.value = true;
    errorMessage.value = null;
    try {
      return await apiFetch<BatchGenerateResult>(`/generate-batch/${nodeId}`, {
        method: 'POST',
        body: JSON.stringify({
          count,
          include_children: includeChildren,
          question_types: questionTypes,
        }),
      });
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : '批量出题失败';
      return null;
    } finally {
      isBusy.value = false;
    }
  }

  async function fetchQuestions(nodeId: string): Promise<void> {
    isBusy.value = true;
    errorMessage.value = null;
    try {
      questions.value = await apiFetch<QuizQuestionListItem[]>(`/quiz-questions/${nodeId}`);
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : '获取题目列表失败';
    } finally {
      isBusy.value = false;
    }
  }

  async function fetchWrongQuestions(limit: number = 20): Promise<void> {
    isBusy.value = true;
    errorMessage.value = null;
    try {
      wrongQuestions.value = await apiFetch<QuizQuestion[]>(`/wrong-questions?limit=${limit}`);
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : '获取错题失败';
    } finally {
      isBusy.value = false;
    }
  }

  async function loadQuestion(nodeId: string, questionId: string): Promise<void> {
    isBusy.value = true;
    errorMessage.value = null;
    currentQuestion.value = null;
    selectedOption.value = null;
    showResult.value = false;
    try {
      currentQuestion.value = await apiFetch<QuizQuestion>(`/quiz-questions/${nodeId}/${questionId}`);
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : '加载题目失败';
    } finally {
      isBusy.value = false;
    }
  }

  async function submitAnswer(nodeId: string, isCorrect: boolean, questionId?: string): Promise<void> {
    try {
      await apiFetch(`/submit-answer/${nodeId}`, {
        method: 'POST',
        body: JSON.stringify({ is_correct: isCorrect, question_id: questionId }),
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
    if (selectedOption.value === null && currentQuestion.value?.question_type !== 'short_answer') return;
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
    questions,
    wrongQuestions,
    generateQuestion,
    generateBatch,
    fetchQuestions,
    fetchWrongQuestions,
    loadQuestion,
    submitAnswer,
    selectOption,
    confirmSelection,
    reset,
  };
}
