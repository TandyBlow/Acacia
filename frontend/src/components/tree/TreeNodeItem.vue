<template>
  <li class="tree-item" :data-node-id="node.id">
    <div class="row" :style="{ paddingLeft: `${depth * 16}px` }">
      <button
        v-if="node.children.length > 0"
        class="expand-btn"
        @click="$emit('toggle', node.id)"
      >
        {{ expanded ? '−' : '+' }}
      </button>
      <span v-else class="expand-placeholder" />

      <div
        class="node-btn"
        :class="{
          selected: selectedParentId === node.id,
          blocked: blockedParentIds.includes(node.id),
        }"
        role="button"
        tabindex="0"
        @click="handleClick"
        @keydown.enter.prevent="handleClick"
        @keydown.space.prevent="handleClick"
      >
        {{ node.name }}
      </div>
    </div>

    <ul v-if="expanded && node.children.length > 0" class="children" data-sortable :data-parent-id="node.id">
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

const emit = defineEmits<{
  toggle: [id: string];
  select: [id: string];
}>();

const expanded = computed(() => props.expandedIds.includes(props.node.id));

function handleClick(): void {
  if (props.blockedParentIds.includes(props.node.id)) return;
  emit('select', props.node.id);
}
</script>

<style scoped>
.tree-item {
  list-style: none;
}

.children {
  margin: 0;
  padding: 0;
  border-left: 1px solid var(--color-glass-border);
  margin-left: 12px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  position: relative;
}

/* Horizontal connector to the vertical guide line */
.children .row::before {
  content: '';
  position: absolute;
  left: -12px;
  top: 50%;
  width: 8px;
  height: 1px;
  background: var(--color-glass-border);
}

.expand-btn,
.expand-placeholder {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.expand-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-glass-border);
  border-radius: 8px;
  background: var(--color-glass-bg);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: var(--color-primary-on-light, var(--color-primary));
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition:
    transform 140ms ease,
    background 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.expand-btn:hover {
  border-color: rgba(102, 255, 229, 0.4);
  background: rgba(102, 255, 229, 0.1);
  box-shadow: 0 0 12px rgba(102, 255, 229, 0.06);
}

.expand-placeholder {
  display: inline-block;
}

.node-btn {
  border: 1px solid var(--color-glass-border);
  border-radius: 10px;
  background: var(--color-glass-bg);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: var(--color-primary-on-light, var(--color-primary));
  padding: 5px 12px;
  text-align: left;
  cursor: pointer;
  font-size: 14px;
  transition:
    transform 140ms ease,
    background 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.node-btn:hover {
  border-color: rgba(102, 255, 229, 0.35);
  background: rgba(102, 255, 229, 0.08);
  box-shadow:
    2px 2px 6px var(--shadow-raised-a),
    -2px -2px 6px var(--shadow-raised-b);
}

.expand-btn:active,
.node-btn:active {
  transform: translateY(1px) scale(0.985);
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
