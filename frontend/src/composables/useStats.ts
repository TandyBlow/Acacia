import { ref } from 'vue';
import { apiFetch } from '../utils/api';

export interface StatsNode {
  id: string;
  name: string;
  mastery_score: number;
  stability: number;
  difficulty: number;
  review_count: number;
  review_state: string;
  depth: number;
  question_count: number;
}

export function useStats() {
  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);
  const nodes = ref<StatsNode[]>([]);

  async function fetchStats(): Promise<void> {
    isBusy.value = true;
    errorMessage.value = null;
    try {
      const data = await apiFetch<{ nodes: StatsNode[] }>('/quiz-stats');
      nodes.value = data.nodes || [];
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : '获取统计失败';
    } finally {
      isBusy.value = false;
    }
  }

  return { isBusy, errorMessage, nodes, fetchStats };
}
