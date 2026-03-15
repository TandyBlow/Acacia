<template>
  <div class="panel">
    <section v-if="viewState === 'add'" class="block">
      <h2>添加节点</h2>
      <p class="hint">新节点将被添加到当前节点下方。</p>
      <input
        v-model="pendingNodeName"
        class="name-input"
        type="text"
        maxlength="80"
        placeholder="请输入新节点名称"
      />
    </section>

    <section v-else-if="viewState === 'delete'" class="block">
      <h2>是否删除该节点？</h2>
      <p class="hint">
        当前目标：<strong>{{ operationNode?.name ?? '-' }}</strong>
      </p>

      <button
        v-if="operationHasChildren"
        type="button"
        class="delete-option"
        @click="deleteWithChildren = !deleteWithChildren"
      >
        <GlassWrapper
          class="delete-toggle"
          shape="circle"
          :pressed="deleteWithChildren"
          interactive
        >
          <span class="delete-toggle-mark">{{ deleteWithChildren ? '√' : '' }}</span>
        </GlassWrapper>
        <span class="delete-option-text">同时删除其子节点内容</span>
      </button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import GlassWrapper from './GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';

const store = useNodeStore();
const { viewState, pendingNodeName, operationNode, operationHasChildren, deleteWithChildren } =
  storeToRefs(store);
</script>

<style scoped>
.panel {
  width: 100%;
  height: 100%;
  padding: 22px 24px;
  display: grid;
  place-items: center;
  color: var(--color-primary);
}

.block {
  width: min(620px, 100%);
  display: flex;
  flex-direction: column;
  gap: 18px;
  align-items: stretch;
}

h2 {
  margin: 0;
  font-size: 28px;
  line-height: 1.2;
  color: var(--color-primary);
}

.hint {
  margin: 0;
  font-size: 15px;
  color: var(--color-hint);
}

.name-input {
  width: 100%;
  border: 1px solid var(--color-glass-border);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.14);
  color: var(--color-primary);
  padding: 16px 18px;
  font-size: 17px;
}

.name-input::placeholder {
  color: var(--color-hint);
}

.name-input:focus {
  outline: 2px solid rgba(102, 255, 229, 0.35);
}

.delete-option {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.delete-toggle {
  width: 24px;
  height: 24px;
  padding: 2px;
}

.delete-toggle-mark {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-primary);
}

.delete-option-text {
  font-size: 13px;
  color: var(--color-hint);
}
</style>
