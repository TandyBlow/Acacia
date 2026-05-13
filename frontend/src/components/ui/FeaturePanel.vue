<template>
  <div ref="featureRef" class="activity-layout">
    <div
      v-for="(feature, index) in features"
      :key="feature.id"
      class="feature-card-host"
      :style="{ animationDelay: index * 50 + 'ms' }"
    >
      <GlassWrapper interactive class="feature-card" @click="feature.action">
        <div class="feature-card-inner">
          <span class="feature-icon">{{ feature.icon }}</span>
          <span class="feature-label">{{ feature.label }}</span>
        </div>
      </GlassWrapper>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useKnobDispatch } from '../../composables/useKnobDispatch';
import { useNodeStore } from '../../stores/nodeStore';
import { usePageTransition } from '../../composables/usePageTransition';
import GlassWrapper from '../ui/GlassWrapper.vue';

const { closeFeaturePanel, startLogout } = useKnobDispatch();
const nodeStore = useNodeStore();
const { registerRegion, unregisterRegion } = usePageTransition();
const featureRef = ref<HTMLElement | null>(null);

interface FeatureItem {
  id: string;
  icon: string;
  label: string;
  action: () => void;
}

const features = computed<FeatureItem[]>(() => [
  { id: 'logout', icon: '↪', label: '退出登录', action: handleLogout },
  { id: 'review', icon: '📅', label: '每日复习', action: handleReview },
  { id: 'quiz', icon: '?', label: '出题', action: handleQuiz },
  { id: 'quiz-history', icon: '📋', label: '题库', action: handleQuizHistory },
  { id: 'stats', icon: '📊', label: '学习统计', action: handleStats },
]);

function handleLogout() {
  closeFeaturePanel();
  startLogout();
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

onMounted(() => {
  registerRegion({
    id: 'content-feature',
    type: 'glass',
    element: featureRef,
    shouldShow: (state) => state.isFeaturePanel,
  });
});

onBeforeUnmount(() => {
  unregisterRegion('content-feature');
});
</script>

<style scoped>
.feature-card-host {
  flex: 1;
  min-height: 0;
  animation: feature-card-rise 400ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.feature-card-host :deep(.glass) {
  transition: border-color 240ms ease, background 240ms ease;
}

.feature-card-host:hover :deep(.glass) {
  border-color: var(--color-hint, rgba(102, 255, 229, 0.54));
}

.feature-card-host:hover :deep(.glass-content) {
  background: rgba(255, 255, 255, 0.12);
}

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

.feature-card-inner {
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
