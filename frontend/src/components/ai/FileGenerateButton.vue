<template>
  <button
    v-if="shouldShow"
    class="file-generate-btn"
    @click="handleClick"
  >
    <span class="btn-icon">✨</span>
    <span class="btn-text">从文件生成</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useNodeStore } from '../../stores/nodeStore';
import { useFileGenerate } from '../../composables/useFileGenerate';

const nodeStore = useNodeStore();
const { activeNode } = storeToRefs(nodeStore);
const { openDialog } = useFileGenerate();

const shouldShow = computed(() => {
  if (!activeNode.value) return false;
  const content = activeNode.value.content || '';
  return content.trim().length === 0;
});

function handleClick() {
  openDialog();
}
</script>

<style scoped>
.file-generate-btn {
  position: absolute;
  top: 8px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 12px;
  border: 1px solid var(--color-glass-border);
  background: rgba(102, 255, 229, 0.18);
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  z-index: 10;
  animation: button-appear 0.3s ease;
}

@keyframes button-appear {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.file-generate-btn:hover {
  background: rgba(102, 255, 229, 0.32);
  border-color: rgba(102, 255, 229, 0.6);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 255, 229, 0.2);
}

.btn-icon {
  font-size: 16px;
}

.btn-text {
  font-family: inherit;
}
</style>
