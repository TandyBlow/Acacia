<template>
  <div class="feature-panel">
    <div
      v-for="feature in features"
      :key="feature.id"
      class="feature-card"
      @click="feature.action"
    >
      <div class="feature-card-content">
        <span class="feature-icon">{{ feature.icon }}</span>
        <span class="feature-label">{{ feature.label }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useKnobDispatch } from '../../composables/useKnobDispatch';
import { useAiGenerate } from '../../composables/useAiGenerate';
import { useNodeStore } from '../../stores/nodeStore';

const { closeFeaturePanel, startLogout } = useKnobDispatch();
const { requestOpenPopup, requestAnalysis } = useAiGenerate();
const nodeStore = useNodeStore();

interface FeatureItem {
  id: string;
  icon: string;
  label: string;
  action: () => void;
}

const features = computed<FeatureItem[]>(() => [
  { id: 'logout', icon: '↪', label: '退出登录', action: handleLogout },
  { id: 'ai-generate', icon: '✦', label: '知识点生成', action: handleAiGenerate },
  { id: 'ai-analyze', icon: '🔍', label: 'AI分析', action: handleAnalyze },
  { id: 'review', icon: '📅', label: '每日复习', action: handleReview },
  { id: 'quiz', icon: '?', label: '出题', action: handleQuiz },
  { id: 'quiz-history', icon: '📋', label: '题库', action: handleQuizHistory },
  { id: 'stats', icon: '📊', label: '学习统计', action: handleStats },
]);

function handleLogout() {
  closeFeaturePanel();
  startLogout();
}

function handleAiGenerate() {
  closeFeaturePanel();
  requestOpenPopup();
}

function handleAnalyze() {
  closeFeaturePanel();
  requestAnalysis();
}

function handleQuiz() {
  closeFeaturePanel();
  nodeStore.startQuiz();
}

function handleQuizHistory() {
  closeFeaturePanel();
  nodeStore.startQuizHistory();
}

function handleStats() {
  closeFeaturePanel();
  nodeStore.startStats();
}

function handleReview() {
  closeFeaturePanel();
  nodeStore.startReview();
}
</script>

<style scoped>
.feature-panel {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
}

.feature-card {
  min-width: 0;
  min-height: 0;
  border-radius: 18px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease;
  animation: feature-card-rise 400ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.feature-card:nth-child(1) { animation-delay: 0ms; }
.feature-card:nth-child(2) { animation-delay: 50ms; }
.feature-card:nth-child(3) { animation-delay: 100ms; }
.feature-card:nth-child(4) { animation-delay: 150ms; }
.feature-card:nth-child(5) { animation-delay: 200ms; }
.feature-card:nth-child(6) { animation-delay: 250ms; }
.feature-card:nth-child(7) { animation-delay: 300ms; }

@keyframes feature-card-rise {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.feature-card:hover {
  background: rgba(255, 255, 255, 0.16);
  border-color: var(--color-hint, rgba(102, 255, 229, 0.54));
}

.feature-card-content {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  pointer-events: none;
}

.feature-icon {
  font-size: 36px;
}

.feature-label {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-primary);
}
</style>
