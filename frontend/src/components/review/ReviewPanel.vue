<template>
  <div class="review-panel">
    <template v-if="isBusy">
      <div class="review-loading">加载中...</div>
    </template>

    <template v-else-if="errorMessage">
      <div class="review-error">{{ errorMessage }}</div>
      <button class="review-btn" @click="goBack">返回</button>
    </template>

    <!-- Stats bar -->
    <template v-else-if="!allDone">
      <div class="review-stats-bar">
        <div class="review-stat">
          <span class="review-stat-value">{{ reviewedCount }}</span>
          <span class="review-stat-label">已复习</span>
        </div>
        <div class="review-stat">
          <span class="review-stat-value">{{ totalCount }}</span>
          <span class="review-stat-label">待复习</span>
        </div>
      </div>

      <!-- Current card -->
      <div v-if="currentItem" class="review-card">
        <div class="review-card-header">
          <span class="review-card-index">{{ reviewedCount + 1 }} / {{ totalCount }}</span>
          <span v-if="currentItem.review_state === 'new'" class="review-tag review-tag-new">新</span>
          <span v-else-if="currentItem.review_state === 'relearning'" class="review-tag review-tag-relearn">重学</span>
          <span v-else class="review-tag review-tag-review">复习</span>
        </div>

        <h3 class="review-node-name">{{ currentItem.node_name }}</h3>

        <div class="review-meta">
          <span v-if="currentItem.retrievability > 0">
            记忆度 {{ Math.round(currentItem.retrievability * 100) }}%
          </span>
          <span v-else>首次复习</span>
        </div>

        <Transition name="content-expand">
          <div v-if="showContent" class="review-content">
            <div v-if="currentItem.content" class="review-content-text">
              {{ currentItem.content }}
            </div>
            <div v-else class="review-content-empty">暂无笔记内容</div>
          </div>
        </Transition>

        <button
          v-if="!showContent"
          class="review-btn review-btn-show"
          @click="showContent = true"
        >
          显示内容（回忆后点击核对）
        </button>

        <div v-else class="review-rating-group">
          <button class="review-rating rating-again" @click="rate(1)">忘了</button>
          <button class="review-rating rating-hard" @click="rate(2)">困难</button>
          <button class="review-rating rating-good" @click="rate(3)">正常</button>
          <button class="review-rating rating-easy" @click="rate(4)">轻松</button>
        </div>
      </div>

      <button class="review-btn review-btn-back" @click="goBack">返回</button>
    </template>

    <!-- All done -->
    <template v-else>
      <div class="review-done">
        <div class="review-done-icon">✅</div>
        <h2 class="review-done-title">今日复习完成</h2>
        <p class="review-done-sub">共复习 {{ reviewedCount }} 个知识点</p>
        <button class="review-btn" @click="goBack">返回</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useReview, type DueReviewItem } from '../../composables/useReview';

const nodeStore = useNodeStore();
const { isBusy, errorMessage, fetchDueReviews, submitReview } = useReview();

const items = ref<DueReviewItem[]>([]);
const currentIndex = ref(0);
const showContent = ref(false);
const reviewedCount = ref(0);
const allDone = ref(false);

const totalCount = computed(() => items.value.length);
const currentItem = computed(() => items.value[currentIndex.value] ?? null);

onMounted(async () => {
  items.value = await fetchDueReviews(20);
  if (items.value.length === 0) {
    allDone.value = true;
  }
});

async function rate(rating: number): Promise<void> {
  const item = currentItem.value;
  if (!item) return;

  const result = await submitReview(item.node_id, rating);
  if (!result) return;

  reviewedCount.value++;
  showContent.value = false;

  if (currentIndex.value < items.value.length - 1) {
    currentIndex.value++;
  } else {
    allDone.value = true;
  }
}

function goBack(): void {
  nodeStore.cancelOperation();
}
</script>

<style scoped>
.review-panel {
  width: 100%;
  height: 100%;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow: auto;
}

.review-loading {
  flex: 1;
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-primary);
  opacity: 0.7;
}

.review-error {
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(255, 80, 80, 0.12);
  color: #c0392b;
  font-size: 14px;
}

.review-stats-bar {
  display: flex;
  gap: 12px;
}

.review-stat {
  flex: 1;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.review-stat-value {
  font-size: 24px;
  font-weight: 800;
  color: var(--color-primary);
}

.review-stat-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-primary);
  opacity: 0.6;
}

.review-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border-radius: 20px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.08);
}

.review-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.review-card-index {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-primary);
  opacity: 0.6;
}

.review-tag {
  padding: 2px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
}

.review-tag-new {
  background: rgba(102, 255, 229, 0.22);
  color: #0e7c5b;
}

.review-tag-relearn {
  background: rgba(255, 180, 60, 0.22);
  color: #b07812;
}

.review-tag-review {
  background: rgba(100, 140, 255, 0.22);
  color: #2c5eb5;
}

.review-node-name {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: var(--color-primary);
  line-height: 1.4;
}

.review-meta {
  font-size: 14px;
  color: var(--color-primary);
  opacity: 0.55;
}

.review-content {
  padding: 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--color-glass-border);
  max-height: 280px;
  overflow: auto;
}

.review-content-text {
  font-size: 15px;
  line-height: 1.7;
  color: var(--color-primary);
  white-space: pre-wrap;
}

.review-content-empty {
  font-size: 14px;
  color: var(--color-primary);
  opacity: 0.5;
}

.review-btn-show {
  width: 100%;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--color-glass-border);
  background: rgba(102, 255, 229, 0.14);
  color: var(--color-primary);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.review-btn-show:hover {
  background: rgba(102, 255, 229, 0.28);
}

.review-rating-group {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.review-rating {
  padding: 14px 8px;
  border-radius: 14px;
  border: 1px solid var(--color-glass-border);
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.rating-again {
  background: rgba(255, 80, 80, 0.14);
  color: #c0392b;
}

.rating-again:hover {
  background: rgba(255, 80, 80, 0.26);
}

.rating-hard {
  background: rgba(255, 180, 60, 0.14);
  color: #b07812;
}

.rating-hard:hover {
  background: rgba(255, 180, 60, 0.26);
}

.rating-good {
  background: rgba(46, 204, 113, 0.14);
  color: #1e8449;
}

.rating-good:hover {
  background: rgba(46, 204, 113, 0.26);
}

.rating-easy {
  background: rgba(102, 255, 229, 0.18);
  color: #0e7c5b;
}

.rating-easy:hover {
  background: rgba(102, 255, 229, 0.32);
}

.review-btn {
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

.review-btn:hover {
  background: rgba(102, 255, 229, 0.35);
}

.review-btn-back {
  align-self: center;
}

.review-done {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.review-done-icon {
  font-size: 48px;
}

.review-done-title {
  margin: 0;
  font-size: 24px;
  font-weight: 800;
  color: var(--color-primary);
}

.review-done-sub {
  margin: 0;
  font-size: 16px;
  color: var(--color-primary);
  opacity: 0.6;
}

.content-expand-enter-active {
  transition: max-height 250ms ease, opacity 200ms ease;
  max-height: 280px;
  overflow: hidden;
}

.content-expand-leave-active {
  transition: max-height 200ms ease, opacity 150ms ease;
  max-height: 280px;
  overflow: hidden;
}

.content-expand-enter-from {
  max-height: 0;
  opacity: 0;
}

.content-expand-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
