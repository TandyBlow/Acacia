<template>
  <div class="nav-shell">
    <div class="node-list">
      <div v-if="childNodes.length === 0" class="empty">
        No child nodes
      </div>

      <div v-for="node in childNodes" :key="node.id" class="row">
        <GlassWrapper
          v-if="actionNodeId !== node.id"
          class="row-glass"
          interactive
          @click="openNode(node.id)"
          @contextmenu.prevent="toggleActions(node.id)"
        >
          <div class="row-content">
            <span class="row-name">{{ node.name }}</span>
            <span class="row-tip">right click</span>
          </div>
        </GlassWrapper>

        <div v-else class="row-actions">
          <button class="action move" @click="moveNode(node)">Move</button>
          <button class="action delete" @click="deleteNode(node)">Delete</button>
          <button class="action cancel" @click="actionNodeId = null">Cancel</button>
        </div>
      </div>
    </div>

    <button class="add-button" @click="store.startAdd()">
      + Add Node
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import type { NodeRecord } from '../../types/node';

const store = useNodeStore();
const { childNodes } = storeToRefs(store);

const actionNodeId = ref<string | null>(null);

async function openNode(nodeId: string): Promise<void> {
  actionNodeId.value = null;
  await store.loadNode(nodeId);
}

function toggleActions(nodeId: string): void {
  actionNodeId.value = actionNodeId.value === nodeId ? null : nodeId;
}

async function moveNode(node: NodeRecord): Promise<void> {
  actionNodeId.value = null;
  await store.startMove(node);
}

async function deleteNode(node: NodeRecord): Promise<void> {
  actionNodeId.value = null;
  await store.startDelete(node);
}
</script>

<style scoped>
.nav-shell {
  width: 100%;
  height: 100%;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.node-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 2px;
}

.row {
  height: 54px;
  flex: 0 0 54px;
}

.row-glass {
  width: 100%;
  height: 100%;
}

.row-content {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
}

.row-name {
  font-size: 14px;
  font-weight: 600;
}

.row-tip {
  font-size: 11px;
  opacity: 0.7;
}

.row-actions {
  height: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 4px;
}

.action {
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 14px;
  color: #eefcff;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.12);
}

.action.move {
  color: #ddf6ff;
}

.action.delete {
  color: #ffd4d4;
}

.action.cancel {
  color: #eefcff;
}

.empty {
  min-height: 60px;
  display: grid;
  place-items: center;
  font-size: 13px;
  opacity: 0.8;
}

.add-button {
  flex: 0 0 54px;
  border: 1px solid rgba(102, 209, 120, 0.58);
  border-radius: 16px;
  background: rgba(50, 156, 66, 0.2);
  color: #e9ffe9;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}
</style>
