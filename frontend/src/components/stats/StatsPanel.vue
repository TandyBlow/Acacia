<template>
  <div class="stats-panel">
    <template v-if="isBusy">
      <div class="stats-loading">加载中...</div>
    </template>

    <template v-else-if="errorMessage">
      <div class="stats-error">{{ errorMessage }}</div>
    </template>

    <template v-else>
      <div class="stats-overview">
        <div class="stats-card">
          <div class="stats-value">{{ totalNodes }}</div>
          <div class="stats-label">知识点总数</div>
        </div>
        <div class="stats-card">
          <div class="stats-value">{{ avgMastery }}%</div>
          <div class="stats-label">平均掌握度</div>
        </div>
        <div class="stats-card">
          <div class="stats-value">{{ quizzedCount }}</div>
          <div class="stats-label">已测验</div>
        </div>
      </div>

      <div v-if="weakNodes.length > 0" class="stats-section">
        <h3 class="stats-section-title">薄弱知识点</h3>
        <div class="stats-weak-list">
          <GlassWrapper
            v-for="node in weakNodes"
            :key="node.id"
            class="stats-weak-item"
          >
            <div class="stats-weak-content">
              <span class="stats-weak-name">{{ node.name }}</span>
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
import { storeToRefs } from 'pinia';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useAuthStore } from '../../stores/authStore';
import { useNodeStore } from '../../stores/nodeStore';
import { useStats } from '../../composables/useStats';

const authStore = useAuthStore();
const nodeStore = useNodeStore();
const { user } = storeToRefs(authStore);

const { isBusy, errorMessage, nodes, fetchStats } = useStats();

const totalNodes = computed(() => nodes.value.length);

const quizzedCount = computed(() =>
  nodes.value.filter(n => n.mastery_score > 0).length,
);

const avgMastery = computed(() => {
  const quizzed = nodes.value.filter(n => n.mastery_score > 0);
  if (quizzed.length === 0) return 0;
  const sum = quizzed.reduce((acc, n) => acc + n.mastery_score, 0);
  return Math.round((sum / quizzed.length) * 100);
});

const weakNodes = computed(() =>
  [...nodes.value]
    .filter(n => n.mastery_score > 0 && n.mastery_score < 1)
    .sort((a, b) => a.mastery_score - b.mastery_score)
    .slice(0, 5),
);

function goBack(): void {
  nodeStore.cancelOperation();
}

onMounted(() => {
  if (user.value) {
    fetchStats(user.value.id);
  }
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

.stats-weak-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-primary);
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
