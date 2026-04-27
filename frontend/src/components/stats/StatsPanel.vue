<template>
  <div class="stats-panel">
    <template v-if="isBusy">
      <div class="stats-loading">加载中...</div>
    </template>

    <template v-else-if="errorMessage">
      <div class="stats-error">{{ errorMessage }}</div>
    </template>

    <template v-else>
      <!-- Growth stage header -->
      <div class="growth-stage">
        <span class="growth-stage-icon">{{ growthStage.icon }}</span>
        <span class="growth-stage-label">{{ growthStage.label }}</span>
      </div>

      <!-- Review progress bar -->
      <div class="coverage-section">
        <div class="coverage-header">
          <span class="coverage-label">复习覆盖</span>
          <span class="coverage-value">{{ Math.round(reviewCoverage * 100) }}%</span>
        </div>
        <div class="coverage-bar-track">
          <div
            class="coverage-bar-fill"
            :style="{ width: Math.round(reviewCoverage * 100) + '%' }"
          />
        </div>
      </div>

      <!-- Core stats -->
      <div class="stats-overview">
        <div class="stats-card">
          <div class="stats-value">{{ totalNodes }}</div>
          <div class="stats-label">知识点总数</div>
        </div>
        <div class="stats-card">
          <div class="stats-value">{{ Math.round(avgMastery * 100) }}%</div>
          <div class="stats-label">平均掌握度</div>
        </div>
        <div class="stats-card">
          <div class="stats-value">{{ quizzedCount }}</div>
          <div class="stats-label">已测验</div>
        </div>
      </div>

      <!-- Review row -->
      <div v-if="reviewStats" class="stats-overview stats-review-row">
        <div class="stats-card">
          <div class="stats-value">{{ reviewStats.due_count }}</div>
          <div class="stats-label">待复习</div>
        </div>
        <div class="stats-card">
          <div class="stats-value">{{ reviewStats.today_reviewed }}</div>
          <div class="stats-label">今日已复习</div>
        </div>
        <div class="stats-card">
          <div class="stats-value">{{ avgStabilityDays }}天</div>
          <div class="stats-label">平均稳定性</div>
        </div>
      </div>

      <!-- Weak nodes -->
      <div v-if="weakNodes.length > 0" class="stats-section">
        <h3 class="stats-section-title">薄弱知识点</h3>
        <div class="stats-weak-list">
          <GlassWrapper
            v-for="node in weakNodes"
            :key="node.id"
            class="stats-weak-item"
          >
            <div class="stats-weak-content">
              <div class="stats-weak-left">
                <span class="stats-weak-name">{{ node.name }}</span>
                <span class="stats-weak-meta">
                  {{ node.review_count }}次复习 · 稳定性{{ formatStability(node.stability) }}
                </span>
              </div>
              <span class="stats-weak-score">{{ Math.round(node.mastery_score * 100) }}%</span>
            </div>
          </GlassWrapper>
        </div>
      </div>

      <button class="stats-btn" @click="goBack">返回</button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';

import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useStats } from '../../composables/useStats';
import { useReview } from '../../composables/useReview';

const nodeStore = useNodeStore();

const { isBusy, errorMessage, nodes, fetchStats } = useStats();
const { reviewStats, fetchReviewStats } = useReview();

const totalNodes = computed(() => nodes.value.length);

const quizzedCount = computed(() =>
  nodes.value.filter(n => n.review_count > 0).length,
);

const reviewCoverage = computed(() =>
  totalNodes.value > 0 ? quizzedCount.value / totalNodes.value : 0,
);

const avgMastery = computed(() => {
  const quizzed = nodes.value.filter(n => n.review_count > 0);
  if (quizzed.length === 0) return 0;
  const sum = quizzed.reduce((acc, n) => acc + n.mastery_score, 0);
  return sum / quizzed.length;
});

const avgStabilityDays = computed(() => {
  const reviewed = nodes.value.filter(n => n.stability > 0);
  if (reviewed.length === 0) return 0;
  const sum = reviewed.reduce((acc, n) => acc + n.stability, 0);
  return Math.round(sum / reviewed.length * 10) / 10;
});

interface GrowthStageInfo {
  icon: string;
  label: string;
}

const growthStage = computed<GrowthStageInfo>(() => {
  const coverage = reviewCoverage.value;
  const stability = avgStabilityDays.value;
  if (coverage === 0) return { icon: '🌱', label: '种子阶段 · 开始学习吧' };
  if (coverage < 0.3 || stability < 2) return { icon: '🪴', label: '萌芽阶段 · 持续积累' };
  if (coverage < 0.6 || stability < 5) return { icon: '🌿', label: '生长阶段 · 稳步推进' };
  if (coverage < 0.9 || stability < 15) return { icon: '🌳', label: '繁茂阶段 · 知识扎根' };
  return { icon: '🏆', label: '参天大树 · 学识深厚' };
});

const weakNodes = computed(() =>
  [...nodes.value]
    .filter(n => n.review_count > 0 && n.mastery_score < 1)
    .sort((a, b) => a.mastery_score - b.mastery_score)
    .slice(0, 5),
);

function formatStability(s: number): string {
  if (s <= 0) return '未复习';
  if (s < 1) return `${Math.round(s * 24)}小时`;
  if (s < 30) return `${Math.round(s)}天`;
  return `${Math.round(s / 30)}月`;
}

function goBack(): void {
  nodeStore.cancelOperation();
}

onMounted(() => {
  fetchStats();
  fetchReviewStats();
});
</script>

<style scoped>
.stats-panel {
  width: 100%;
  height: 100%;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow: auto;
}

.stats-loading {
  flex: 1;
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-primary);
  opacity: 0.7;
}

.stats-error {
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(255, 80, 80, 0.12);
  color: #c0392b;
  font-size: 14px;
}

.growth-stage {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-radius: 18px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.08);
}

.growth-stage-icon {
  font-size: 32px;
}

.growth-stage-label {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-primary);
}

.coverage-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.coverage-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.coverage-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-primary);
  opacity: 0.7;
}

.coverage-value {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-primary);
}

.coverage-bar-track {
  width: 100%;
  height: 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.coverage-bar-fill {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, #66ffe5, #4caf50, #8bc34a);
  transition: width 600ms cubic-bezier(0.22, 1, 0.36, 1);
}

.stats-overview {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.stats-card {
  padding: 16px;
  border-radius: 18px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.stats-value {
  font-size: 28px;
  font-weight: 800;
  color: var(--color-primary);
}

.stats-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-primary);
  opacity: 0.6;
}

.stats-section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-primary);
}

.stats-weak-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stats-weak-item {
  width: 100%;
}

.stats-weak-item :deep(.glass-raised) {
  box-shadow:
    4px 4px 8px var(--shadow-raised-a),
    -4px -4px 8px var(--shadow-raised-b);
}

.stats-weak-content {
  width: 100%;
  padding: 10px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stats-weak-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stats-weak-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-primary);
}

.stats-weak-meta {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-primary);
  opacity: 0.45;
}

.stats-weak-score {
  font-size: 14px;
  font-weight: 700;
  color: #e74c3c;
}

.stats-btn {
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

.stats-btn:hover {
  background: rgba(102, 255, 229, 0.35);
}
</style>
