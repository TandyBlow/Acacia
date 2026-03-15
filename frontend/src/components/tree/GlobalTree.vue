<template>
  <div class="tree-shell">
    <header class="header">
      <h2>移动节点</h2>
    </header>

    <div class="root-picker">
      <button
        class="root-btn"
        :class="{ selected: moveTargetParentId === null }"
        @click="store.setMoveTargetParent(null)"
      >
        主页
      </button>
    </div>

    <TransitionGroup name="tree-fade" tag="ul" class="tree-root">
      <TreeNodeItem
        v-for="node in treeNodes"
        :key="node.id"
        :node="node"
        :depth="0"
        :expanded-ids="expandedIds"
        :selected-parent-id="moveTargetParentId"
        :blocked-parent-ids="blockedParentIds"
        @toggle="toggleExpand"
        @select="store.setMoveTargetParent"
      />
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import TreeNodeItem from './TreeNodeItem.vue';
import { useNodeStore } from '../../stores/nodeStore';
import type { TreeNode } from '../../types/node';

const store = useNodeStore();
const { treeNodes, moveTargetParentId, blockedParentIds } = storeToRefs(store);
const expandedIds = ref<string[]>([]);

function collectAllIds(nodes: TreeNode[], result: string[]): void {
  for (const node of nodes) {
    result.push(node.id);
    collectAllIds(node.children, result);
  }
}

function toggleExpand(id: string): void {
  if (expandedIds.value.includes(id)) {
    expandedIds.value = expandedIds.value.filter((item) => item !== id);
    return;
  }
  expandedIds.value = [...expandedIds.value, id];
}

watch(
  treeNodes,
  () => {
    const ids: string[] = [];
    collectAllIds(treeNodes.value, ids);
    expandedIds.value = ids;
  },
  { immediate: true },
);

onMounted(async () => {
  if (treeNodes.value.length === 0) {
    await store.refreshTree();
  }
});
</script>

<style scoped>
.tree-shell {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: 8px;
  padding: 8px;
  color: var(--color-primary);
}

.header h2 {
  margin: 0;
}

.root-picker {
  display: flex;
  justify-content: flex-start;
}

.root-btn {
  border: 1px solid var(--color-glass-border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.14);
  color: var(--color-primary);
  padding: 6px 12px;
  cursor: pointer;
}

.root-btn.selected {
  border-color: rgba(102, 255, 229, 0.54);
  background: rgba(102, 255, 229, 0.12);
}

.tree-root {
  margin: 0;
  padding: 0;
  min-height: 0;
  overflow: auto;
}

.tree-fade-enter-active,
.tree-fade-leave-active,
.tree-fade-move {
  transition:
    opacity 220ms ease,
    transform 220ms ease;
}

.tree-fade-enter-from,
.tree-fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
