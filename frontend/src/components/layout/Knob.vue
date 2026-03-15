<template>
  <div class="knob-shell">
    <p class="hint top">{{ topHint }}</p>
    <GlassWrapper
      class="knob-body"
      shape="circle"
      :pressed="pressed || isBusy"
      interactive
      @mousedown="onPressStart"
      @mouseup="onPressEnd"
      @mouseleave="onPressEnd"
      @touchstart.prevent="onPressStart"
      @touchend.prevent="onPressEnd"
      @touchcancel.prevent="onPressEnd"
    >
      <div class="knob-core" />
    </GlassWrapper>
    <p class="hint bottom">{{ bottomHint }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';

const HOLD_MS = 700;

const store = useNodeStore();
const { viewState, canConfirm, isBusy } = storeToRefs(store);

const pressed = ref(false);
const triggeredByHold = ref(false);
let holdTimer: number | null = null;

const inConfirmMode = computed(
  () => viewState.value === 'add' || viewState.value === 'move' || viewState.value === 'delete',
);

const topHint = computed(() =>
  inConfirmMode.value ? 'Click knob to cancel' : 'Click knob to go home',
);

const bottomHint = computed(() =>
  inConfirmMode.value ? 'Hold knob to confirm' : '',
);

function clearTimer(): void {
  if (holdTimer !== null) {
    window.clearTimeout(holdTimer);
    holdTimer = null;
  }
}

function onPressStart(): void {
  if (isBusy.value) {
    return;
  }
  pressed.value = true;
  triggeredByHold.value = false;
  clearTimer();

  if (inConfirmMode.value && canConfirm.value) {
    holdTimer = window.setTimeout(async () => {
      triggeredByHold.value = true;
      pressed.value = false;
      await store.confirmOperation();
    }, HOLD_MS);
  }
}

async function onPressEnd(): Promise<void> {
  if (!pressed.value && !holdTimer) {
    return;
  }
  clearTimer();
  const shouldClick = !triggeredByHold.value;
  pressed.value = false;
  triggeredByHold.value = false;
  if (shouldClick) {
    await store.onKnobClick();
  }
}
</script>

<style scoped>
.knob-shell {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  gap: 12px;
}

.knob-body {
  width: min(74px, 100%);
  height: min(74px, 100%);
}

.knob-core {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #c9f8ff 0%, #8edff3 45%, #4f96b8 100%);
}

.hint {
  margin: 0;
  min-height: 16px;
  text-align: center;
  font-size: 12px;
  opacity: 0.9;
  padding: 0 4px;
}

.top {
  align-self: end;
}

.bottom {
  align-self: start;
}
</style>
