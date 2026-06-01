<template>
  <div ref="panelRef" class="panel">
    <div class="activity-layout">
      <div class="activity-glass-host">
        <GlassWrapper>
          <div class="activity-scroll">
            <section v-if="viewState === ViewStates.ADD" class="block add-block">
              <h2>{{ $t('confirm.addNode') }}</h2>
              <input
                v-model="pendingNodeName"
                class="name-input"
                type="text"
                maxlength="80"
              />
              <p class="confirm-hint">{{ $t('confirm.holdKnobHint') }}</p>
            </section>

            <section v-else-if="viewState === ViewStates.DELETE" class="block delete-block">
              <h2>{{ $t('confirm.deleteNode') }}</h2>
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
                <span class="delete-option-label">{{ $t('confirm.deleteWithChildren') }}</span>
              </button>
              <p v-if="operationHasChildren" class="delete-hint">{{ $t('confirm.deleteHint') }}</p>
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

.add-block {
  min-height: 100%;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 14px;
}

.add-block h2 {
  align-self: end;
}

.add-block .name-input {
  align-self: center;
}

.confirm-hint {
  margin: 0;
  align-self: start;
  font-size: 13px;
  line-height: 1.5;
  color: color-mix(in srgb, var(--color-primary) 58%, var(--color-hint) 42%);
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
  background: var(--color-glass-bg);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  color: var(--color-primary);
  padding: 16px 18px;
  font-size: 17px;
  box-shadow:
    5px 5px 10px var(--shadow-raised-a),
    -5px -5px 10px var(--shadow-raised-b);
  transition: box-shadow 240ms ease, border-color 240ms ease;
}

.name-input:focus {
  outline: 2px solid rgba(102, 255, 229, 0.35);
  border-color: rgba(102, 255, 229, 0.4);
  box-shadow:
    5px 5px 10px var(--shadow-raised-a),
    -5px -5px 10px var(--shadow-raised-b),
    0 0 18px rgba(102, 255, 229, 0.08);
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

.delete-block {
  justify-content: center;
  min-height: 100%;
}

.delete-option {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.delete-option-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-primary);
}

.delete-hint {
  margin: 0;
  font-size: 13px;
  color: var(--color-hint);
  line-height: 1.5;
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
