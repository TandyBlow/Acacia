import { ref } from 'vue';
import { config } from '../config';

export interface StatsNode {
  id: string;
  name: string;
  mastery_score: number;
  depth: number;
}

export function useStats() {
  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);
  const nodes = ref<StatsNode[]>([]);

  async function fetchStats(userId: string): Promise<void> {
    isBusy.value = true;
    errorMessage.value = null;
    try {
      const res = await fetch(`${config.backendUrl}/quiz-stats/${userId}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `请求失败: ${res.status}`);
      }
      const data = await res.json();
      nodes.value = data.nodes || [];
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : '获取统计失败';
    } finally {
      isBusy.value = false;
    }
  }

  return { isBusy, errorMessage, nodes, fetchStats };
}
