<template>
  <div class="panel">
    <section v-if="viewState === ViewStates.ADD" class="block">
      <h2>{{ UI.confirm.addNode }}</h2>
      <input
        v-model="pendingNodeName"
        class="name-input"
        type="text"
        maxlength="80"
      />
    </section>

    <section v-else-if="viewState === ViewStates.DELETE" class="block">
      <h2>{{ UI.confirm.deleteNode }}</h2>
      <div class="target-name">{{ operationNode?.name ?? '' }}</div>

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
      </button>
    </section>

    <section v-else-if="isLoggingOut" class="block">
      <h2>{{ UI.confirm.logout }}</h2>
      <div class="target-name">{{ logoutPrompt }}</div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from './GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useAuthStore } from '../../stores/authStore';
import { useKnobDispatch } from '../../composables/useKnobDispatch';
import { ViewStates } from '../../types/node';
import { UI } from '../../constants/uiStrings';

const nodeStore = useNodeStore();
const authStore = useAuthStore();
const { viewState, pendingNodeName, operationNode, operationHasChildren, deleteWithChildren } =
  storeToRefs(nodeStore);
const { currentUsername } = storeToRefs(authStore);
const { isLoggingOut } = useKnobDispatch();

const logoutPrompt = computed(() => UI.confirm.logoutPrompt(currentUsername.value));
</script>

<style scoped>
.panel {
  width: 100%;
  height: 100%;
  padding: 18px;
  display: grid;
  place-items: center;
  color: var(--color-primary);
}

.block {
  width: min(620px, 100%);
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: stretch;
}

h2 {
  margin: 0;
  font-size: 28px;
  line-height: 1.2;
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

.name-input:focus {
  outline: 2px solid rgba(102, 255, 229, 0.35);
}

.target-name {
  min-height: 52px;
  display: flex;
  align-items: center;
  padding: 0 18px;
  border-radius: 18px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.12);
  font-size: 18px;
  font-weight: 600;
}

.delete-option {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.delete-toggle {
  width: 28px;
  height: 28px;
  padding: 1px;
}

.delete-toggle :deep(.glass-raised) {
  box-shadow:
    3px 3px 6px rgba(49, 78, 151, 0.16),
    -3px -3px 6px rgba(255, 255, 255, 0.3);
}

.delete-toggle-mark {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-primary);
}
</style>
