<template>
  <div class="breadcrumbs-shell">
    <button
      v-for="node in pathNodes"
      :key="node.id"
      class="crumb"
      @click="goTo(node.id)"
    >
      {{ node.name }}
    </button>
    <div class="current-node">
      {{ activeNode ? activeNode.name : '主页' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useNodeStore } from '../../stores/nodeStore';

const store = useNodeStore();
const { pathNodes, activeNode } = storeToRefs(store);

async function goTo(nodeId: string): Promise<void> {
  await store.loadNode(nodeId);
}
</script>

<style scoped>
.breadcrumbs-shell {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 2px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.breadcrumbs-shell::-webkit-scrollbar {
  display: none;
}

.crumb,
.current-node {
  flex: 0 0 auto;
  height: 100%;
  border-radius: 20px;
  padding: 0 16px;
  border: 1px solid var(--color-glass-border);
  white-space: nowrap;
  display: flex;
  align-items: center;
  font-size: 14px;
  color: var(--color-primary);
}

.crumb {
  background: rgba(255, 255, 255, 0.12);
  cursor: pointer;
}

.crumb:hover {
  background: rgba(255, 255, 255, 0.2);
}

.current-node {
  border-style: dashed;
  background: rgba(255, 255, 255, 0.08);
}
</style>
