import { ref } from 'vue';
import { apiFetch } from '../utils/api';

export interface DueReviewItem {
  node_id: string;
  node_name: string;
  content: string;
  retrievability: number;
  stability: number;
  difficulty: number;
  review_count: number;
  review_state: string;
  next_review_at: string | null;
}

export interface ReviewResult {
  node_id: string;
  stability: number;
  difficulty: number;
  retrievability: number;
  mastery_score: number;
  review_count: number;
  review_state: string;
  next_review_at: string;
  last_review_at: string;
}

export interface ReviewStats {
  total_nodes: number;
  due_count: number;
  today_reviewed: number;
  avg_stability: number;
  new_count: number;
}

export function useReview() {
  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);
  const dueItems = ref<DueReviewItem[]>([]);
  const reviewStats = ref<ReviewStats | null>(null);

  async function fetchDueReviews(limit = 20): Promise<DueReviewItem[]> {
    isBusy.value = true;
    errorMessage.value = null;
    try {
      const data = await apiFetch<DueReviewItem[]>(`/due-reviews?limit=${limit}`);
      dueItems.value = data;
      return data;
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : '获取复习列表失败';
      return [];
    } finally {
      isBusy.value = false;
    }
  }

  async function submitReview(nodeId: string, rating: number): Promise<ReviewResult | null> {
    isBusy.value = true;
    errorMessage.value = null;
    try {
      return await apiFetch<ReviewResult>(`/review/${nodeId}`, {
        method: 'POST',
        body: JSON.stringify({ rating }),
      });
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : '提交复习失败';
      return null;
    } finally {
      isBusy.value = false;
    }
  }

  async function fetchReviewStats(): Promise<ReviewStats | null> {
    try {
      const data = await apiFetch<ReviewStats>('/review-stats');
      reviewStats.value = data;
      return data;
    } catch (err) {
      return null;
    }
  }

  return { isBusy, errorMessage, dueItems, reviewStats, fetchDueReviews, submitReview, fetchReviewStats };
}
