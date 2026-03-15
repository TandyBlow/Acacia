<template>
  <div class="nav-shell">
    <div class="node-list">
      <div v-if="childNodes.length === 0" class="empty">
        暂无子节点
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
            <span class="row-tip">右键操作</span>
          </div>
        </GlassWrapper>

        <div v-else class="row-actions">
          <button class="action move" @click="moveNode(node)">移动</button>
          <button class="action delete" @click="deleteNode(node)">删除</button>
          <button class="action cancel" @click="actionNodeId = null">取消</button>
        </div>
      </div>
    </div>

    <button class="add-button" @click="store.startAdd()">
      + 添加节点
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
  padding: 2px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.node-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: 2px;
}

.row {
  height: 54px;
  flex: 0 0 54px;
}

.row-glass,
.row-actions {
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
  color: var(--color-primary);
}

.row-tip {
  font-size: 11px;
  color: var(--color-hint);
}

.row-actions {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 2px;
}

.action,
.add-button {
  border: 1px solid var(--color-glass-border);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.16);
  color: var(--color-primary);
  cursor: pointer;
}

.action.move,
.action.delete,
.action.cancel {
  color: var(--color-primary);
}

.empty {
  min-height: 60px;
  display: grid;
  place-items: center;
  font-size: 13px;
  color: var(--color-hint);
}

.add-button {
  flex: 0 0 54px;
  background: rgba(102, 255, 229, 0.16);
  border-color: rgba(102, 255, 229, 0.48);
  font-size: 15px;
  font-weight: 700;
}
</style>
