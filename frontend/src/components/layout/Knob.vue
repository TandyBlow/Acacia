<template>
  <div class="knob-panel">
    <p class="hint top">{{ topHint }}</p>

    <div class="knob-stage">
      <GlassWrapper inset shape="circle" class="knob-well">
        <div class="knob-well-inner">
          <button
            type="button"
            class="knob-hit-area"
            :disabled="isBusy"
            :aria-label="inConfirmMode ? '点击旋钮返回，长按旋钮确认' : '点击旋钮返回主页'"
            @mousedown="onPressStart"
            @mouseup="onPressEnd"
            @mouseleave="onPressCancel"
            @touchstart.prevent="onPressStart"
            @touchend.prevent="onPressEnd"
            @touchcancel.prevent="onPressCancel"
          >
            <GlassWrapper class="knob-body" shape="circle" :pressed="pressed || isBusy" interactive>
              <div class="knob-core" />
            </GlassWrapper>
          </button>
        </div>
      </GlassWrapper>
    </div>

    <p class="hint bottom" :class="{ hidden: !bottomHint }">{{ bottomHint }}</p>
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
  inConfirmMode.value ? '点击旋钮返回' : '点击旋钮返回主页',
);

const bottomHint = computed(() =>
  inConfirmMode.value ? '长按旋钮确认' : '',
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

function onPressCancel(): void {
  if (!pressed.value && !holdTimer) {
    return;
  }

  clearTimer();
  pressed.value = false;
  triggeredByHold.value = false;
}
</script>

<style scoped>
.knob-panel {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-rows: auto auto auto;
  align-content: center;
  justify-items: center;
  gap: 8px;
  padding: 0;
}

.knob-stage {
  width: 100%;
  display: grid;
  place-items: center;
}

.knob-well {
  width: 100%;
  aspect-ratio: 1 / 1;
  padding: 2px;
}

.knob-well-inner {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
}

.knob-hit-area {
  width: 100%;
  height: 100%;
  max-width: 74px;
  max-height: 74px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}

.knob-hit-area:disabled {
  cursor: wait;
}

.knob-hit-area:focus-visible {
  outline: 2px solid rgba(102, 255, 229, 0.54);
  outline-offset: 4px;
}

.knob-body {
  width: 100%;
  height: 100%;
}

.knob-core {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background:
    radial-gradient(circle at 30% 28%, rgba(255, 255, 255, 0.96) 0%, rgba(223, 245, 255, 0.92) 30%, rgba(162, 191, 255, 0.88) 58%, rgba(102, 128, 255, 0.94) 100%);
}

.hint {
  margin: 0;
  min-height: 16px;
  text-align: center;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-hint);
}

.hint.hidden {
  visibility: hidden;
}

@media (max-width: 1100px) {
  .knob-panel {
    grid-template-columns: 1fr auto 1fr;
    grid-template-rows: 1fr;
    gap: 12px;
  }

  .hint.top {
    text-align: right;
  }

  .hint.bottom {
    text-align: left;
  }

  .knob-stage {
    width: 112px;
  }
}
</style>
