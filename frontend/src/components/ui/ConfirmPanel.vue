<template>
  <div ref="panelRef" class="panel">
    <div class="activity-layout">
      <div class="activity-glass-host">
        <GlassWrapper>
          <div class="activity-scroll">
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
          </div>
        </GlassWrapper>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from './GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { usePageTransition } from '../../composables/usePageTransition';
import { ViewStates } from '../../types/node';
import { UI } from '../../constants/uiStrings';

const nodeStore = useNodeStore();
const { viewState, pendingNodeName, operationNode, operationHasChildren, deleteWithChildren } =
  storeToRefs(nodeStore);
const { registerRegion, unregisterRegion } = usePageTransition();
const panelRef = ref<HTMLElement | null>(null);

onMounted(() => {
  registerRegion({
    id: 'content-confirm',
    type: 'glass',
    element: panelRef,
    shouldShow: (state) => {
      return state.viewState === 'add' ||
             state.viewState === 'delete' ||
             state.viewState === 'move';
    },
    parent: 'content',
  });
});

onBeforeUnmount(() => {
  unregisterRegion('content-confirm');
});
</script>

<style scoped>
.panel {
  width: 100%;
  height: 100%;
}

.block {
  width: min(620px, 100%);
  margin: 0 auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: stretch;
}

h2 {
  margin: 0;
  font-size: 28px;
  line-height: 1.2;
  color: var(--color-primary);
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
  color: var(--color-primary);
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

.delete-toggle :deep(.glass-pressed) {
  box-shadow: none;
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
