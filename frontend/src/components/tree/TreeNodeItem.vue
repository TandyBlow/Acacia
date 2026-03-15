<template>
  <li class="tree-item">
    <div class="row" :style="{ paddingLeft: `${depth * 16}px` }">
      <button
        v-if="node.children.length > 0"
        class="expand-btn"
        @click="$emit('toggle', node.id)"
      >
        {{ expanded ? '-' : '+' }}
      </button>
      <span v-else class="expand-placeholder" />

      <button
        class="node-btn"
        :class="{
          selected: selectedParentId === node.id,
          blocked: blockedParentIds.includes(node.id),
        }"
        :disabled="blockedParentIds.includes(node.id)"
        @click="$emit('select', node.id)"
      >
        {{ node.name }}
      </button>
    </div>

    <ul v-if="expanded && node.children.length > 0" class="children">
      <TreeNodeItem
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :expanded-ids="expandedIds"
        :selected-parent-id="selectedParentId"
        :blocked-parent-ids="blockedParentIds"
        @toggle="$emit('toggle', $event)"
        @select="$emit('select', $event)"
      />
    </ul>
  </li>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TreeNode } from '../../types/node';

const props = defineProps<{
  node: TreeNode;
  depth: number;
  expandedIds: string[];
  selectedParentId: string | null;
  blockedParentIds: string[];
}>();

defineEmits<{
  toggle: [id: string];
  select: [id: string];
}>();

const expanded = computed(() => props.expandedIds.includes(props.node.id));
</script>

<style scoped>
.tree-item {
  list-style: none;
}

.children {
  margin: 0;
  padding: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
}

.expand-btn,
.expand-placeholder {
  width: 24px;
  height: 24px;
}

.expand-btn {
  border: 1px solid var(--color-glass-border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.14);
  color: var(--color-primary);
  cursor: pointer;
}

.expand-placeholder {
  display: inline-block;
}

.node-btn {
  border: 1px solid var(--color-glass-border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.12);
  color: var(--color-primary);
  padding: 5px 10px;
  text-align: left;
  cursor: pointer;
}

.node-btn.selected {
  border-color: rgba(102, 255, 229, 0.54);
  background: rgba(102, 255, 229, 0.12);
}

.node-btn.blocked {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
