import { ref, onUnmounted } from 'vue';
import { apiFetch } from '../utils/api';
import { useGlobalLoading } from './useGlobalLoading';

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
  const { registerLoadingSource, setLoading, unregisterLoadingSource } = useGlobalLoading();
  registerLoadingSource('stats');

  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);
  const nodes = ref<StatsNode[]>([]);

  onUnmounted(() => {
    unregisterLoadingSource('stats');
  });

  async function fetchStats(): Promise<void> {
    isBusy.value = true;
    setLoading('stats', true);
    errorMessage.value = null;
    try {
      const data = await apiFetch<{ nodes: StatsNode[] }>('/quiz-stats');
      nodes.value = data.nodes || [];
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : '获取统计失败';
    } finally {
      isBusy.value = false;
      setLoading('stats', false);
    }
  }

  return { isBusy, errorMessage, nodes, fetchStats };
}
