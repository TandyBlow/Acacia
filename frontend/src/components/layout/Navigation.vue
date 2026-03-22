<template>
  <div class="nav-shell">
    <template v-if="isAuthenticated">
      <TransitionGroup name="nav-row" tag="div" class="node-list">
        <div v-if="childNodes.length === 0" key="empty" class="empty" />

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
            </div>
          </GlassWrapper>

          <div v-else class="row-actions">
            <GlassWrapper class="action-shell" interactive @click="moveNode(node)">
              <button type="button" class="action">移动</button>
            </GlassWrapper>
            <GlassWrapper class="action-shell" interactive @click="deleteNode(node)">
              <button type="button" class="action">删除</button>
            </GlassWrapper>
            <GlassWrapper class="action-shell" interactive @click="actionNodeId = null">
              <button type="button" class="action">取消</button>
            </GlassWrapper>
          </div>
        </div>
      </TransitionGroup>

      <GlassWrapper class="add-shell" interactive @click="store.startAdd()">
        <button type="button" class="add-button">
          + 添加节点
        </button>
      </GlassWrapper>
    </template>

    <div v-else class="auth-tip-shell">
      <GlassWrapper class="auth-tip-card">
        <div class="auth-tip">注册或登录以继续</div>
      </GlassWrapper>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useAuthStore } from '../../stores/authStore';
import type { NodeRecord } from '../../types/node';

const store = useNodeStore();
const authStore = useAuthStore();
const { childNodes } = storeToRefs(store);
const { isAuthenticated } = storeToRefs(authStore);

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
  padding: 1px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.node-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-right: 2px;
}

.row {
  height: 54px;
  flex: 0 0 54px;
}

.row-glass,
.row-actions,
.action-shell,
.add-shell {
  width: 100%;
  height: 100%;
}

.row-glass :deep(.glass-raised),
.action-shell :deep(.glass-raised),
.add-shell :deep(.glass-raised) {
  box-shadow:
    4px 4px 8px rgba(49, 78, 151, 0.15),
    -4px -4px 8px rgba(255, 255, 255, 0.3);
}

.row-content {
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 14px;
}

.row-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-primary);
}

.row-actions {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1px;
}

.action,
.add-button {
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 14px;
}

.add-shell {
  flex: 0 0 54px;
}

.add-shell :deep(.glass-content) {
  background: rgba(102, 255, 229, 0.12);
}

.add-button {
  font-weight: 700;
}

.empty {
  min-height: 54px;
}

.auth-tip-shell {
  flex: 1;
  min-height: 0;
}

.auth-tip-card {
  width: 100%;
  height: 100%;
}

.auth-tip {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  padding: 16px;
  text-align: center;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-primary);
}

.nav-row-enter-active,
.nav-row-leave-active,
.nav-row-move {
  transition:
    opacity 220ms ease,
    transform 220ms ease;
}

.nav-row-enter-from,
.nav-row-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.97);
}
</style>
