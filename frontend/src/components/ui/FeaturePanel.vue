<template>
  <div class="feature-panel">
    <GlassWrapper
      v-for="feature in features"
      :key="feature.id"
      interactive
      class="feature-card"
      @click="feature.action"
    >
      <div class="feature-card-content">
        <span class="feature-icon">{{ feature.icon }}</span>
        <span class="feature-label">{{ feature.label }}</span>
      </div>
    </GlassWrapper>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import GlassWrapper from './GlassWrapper.vue';
import { useKnobDispatch } from '../../composables/useKnobDispatch';
import { useAiGenerate } from '../../composables/useAiGenerate';

const { closeFeaturePanel, startLogout } = useKnobDispatch();
const { requestOpenPopup } = useAiGenerate();

interface FeatureItem {
  id: string;
  icon: string;
  label: string;
  action: () => void;
}

const features = computed<FeatureItem[]>(() => [
  { id: 'logout', icon: '↪', label: '退出登录', action: handleLogout },
  { id: 'ai-generate', icon: '✦', label: '知识点生成', action: handleAiGenerate },
]);

function handleLogout() {
  closeFeaturePanel();
  startLogout();
}

function handleAiGenerate() {
  closeFeaturePanel();
  requestOpenPopup();
}
</script>

<style scoped>
.feature-panel {
  width: 100%;
  height: 100%;
  padding: 18px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.feature-card {
  min-width: 0;
  min-height: 0;
}

.feature-card-content {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
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
