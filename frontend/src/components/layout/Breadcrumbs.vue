<template>
  <div class="breadcrumbs-shell">
    <TransitionGroup v-if="isAuthenticated" name="crumb" tag="div" class="crumb-track">
      <GlassWrapper
        v-for="node in pathNodes"
        :key="node.id"
        class="crumb-wrap"
        interactive
        @click="goTo(node.id)"
      >
        <button type="button" class="crumb">
          {{ node.name }}
        </button>
      </GlassWrapper>

      <GlassWrapper key="current-node" class="crumb-wrap current-wrap">
        <div class="current-node">
          {{ activeNode ? activeNode.name : '主页' }}
        </div>
      </GlassWrapper>
    </TransitionGroup>

    <div v-else class="crumb-track">
      <GlassWrapper class="crumb-wrap current-wrap">
        <div class="current-node">
          欢迎！
        </div>
      </GlassWrapper>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useAuthStore } from '../../stores/authStore';

const store = useNodeStore();
const authStore = useAuthStore();
const { pathNodes, activeNode } = storeToRefs(store);
const { isAuthenticated } = storeToRefs(authStore);

async function goTo(nodeId: string): Promise<void> {
  await store.loadNode(nodeId);
}
</script>

<style scoped>
.breadcrumbs-shell {
  width: 100%;
  height: 100%;
  padding: 1px;
  overflow: hidden;
}

.crumb-track {
  width: 100%;
  height: 100%;
  display: flex;
  gap: 1px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.crumb-track::-webkit-scrollbar {
  display: none;
}

.crumb-wrap {
  flex: 0 0 auto;
  width: max-content;
  min-width: 0;
  height: 100%;
}

.current-wrap {
  border-color: rgba(109, 138, 255, 0.34);
}

.current-wrap :deep(.glass) {
  border-style: solid;
}

.crumb,
.current-node {
  height: 100%;
  width: auto;
  min-width: 0;
  padding: 0 16px;
  border: 0;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  color: var(--color-primary);
  font-size: 14px;
}

.crumb {
  cursor: pointer;
}

.crumb-wrap :deep(.glass) {
  width: auto;
  height: 100%;
  display: inline-flex;
}

.crumb-wrap :deep(.glass-content) {
  width: auto;
  display: inline-flex;
}

.crumb-wrap :deep(.glass-raised) {
  box-shadow:
    4px 4px 8px rgba(49, 78, 151, 0.16),
    -4px -4px 8px rgba(255, 255, 255, 0.3);
}

.crumb-enter-active,
.crumb-leave-active,
.crumb-move {
  transition:
    opacity 220ms ease,
    transform 220ms ease;
}

.crumb-enter-from,
.crumb-leave-to {
  opacity: 0;
  transform: translateX(18px) scale(0.96);
}
</style>
