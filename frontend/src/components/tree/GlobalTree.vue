<template>
  <div class="tree-shell">
    <header class="header">
      <h2>移动节点</h2>
      <p class="hint">
        当前目标：<strong>{{ operationNode?.name ?? '-' }}</strong>
      </p>
      <p class="hint">
        选中的目标父节点：<strong>{{ selectedParentLabel }}</strong>
      </p>
    </header>

    <div class="root-picker">
      <button
        class="root-btn"
        :class="{ selected: moveTargetParentId === null }"
        @click="store.setMoveTargetParent(null)"
      >
        移动到主页
      </button>
    </div>

    <ul class="tree-root">
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
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import TreeNodeItem from './TreeNodeItem.vue';
import { useNodeStore } from '../../stores/nodeStore';
import type { TreeNode } from '../../types/node';

const store = useNodeStore();
const { treeNodes, operationNode, moveTargetParentId, blockedParentIds } = storeToRefs(store);
const expandedIds = ref<string[]>([]);

function collectAllIds(nodes: TreeNode[], result: string[]): void {
  for (const node of nodes) {
    result.push(node.id);
    collectAllIds(node.children, result);
  }
}

function findNodeName(nodes: TreeNode[], id: string): string | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node.name;
    }
    const childHit = findNodeName(node.children, id);
    if (childHit) {
      return childHit;
    }
  }
  return null;
}

function toggleExpand(id: string): void {
  if (expandedIds.value.includes(id)) {
    expandedIds.value = expandedIds.value.filter((item) => item !== id);
    return;
  }
  expandedIds.value = [...expandedIds.value, id];
}

const selectedParentLabel = computed(() => {
  if (moveTargetParentId.value === null) {
    return '主页';
  }
  return findNodeName(treeNodes.value, moveTargetParentId.value) ?? '未知节点';
});

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
  padding: 10px;
  color: var(--color-primary);
}

.header h2 {
  margin: 0;
  color: var(--color-primary);
}

.hint {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--color-hint);
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
</style>
