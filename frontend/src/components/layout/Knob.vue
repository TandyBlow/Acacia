<template>
  <div class="knob-panel">
    <div class="knob-stage">
      <GlassWrapper inset shape="circle" class="knob-well">
        <div class="knob-well-inner">
          <button
            type="button"
            class="knob-hit-area"
            :class="{ confirmable: inConfirmMode && canConfirm }"
            :disabled="isBusy"
            aria-label="??"
            @mousedown="onPressStart"
            @mouseup="onPressEnd"
            @mouseleave="onPressCancel"
            @touchstart.prevent="onPressStart"
            @touchend.prevent="onPressEnd"
            @touchcancel.prevent="onPressCancel"
          >
            <GlassWrapper class="knob-body" shape="circle" :pressed="pressed || isBusy" interactive>
              <div class="knob-core">
                <span v-if="inConfirmMode && canConfirm && pressed" class="hold-ring" />
              </div>
            </GlassWrapper>
          </button>
        </div>
      </GlassWrapper>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useAuthStore } from '../../stores/authStore';

const HOLD_MS = 700;

const nodeStore = useNodeStore();
const authStore = useAuthStore();
const {
  viewState,
  canConfirm: canNodeConfirm,
  isBusy: nodeBusy,
} = storeToRefs(nodeStore);
const {
  isAuthenticated,
  canSubmit: canAuthSubmit,
  isBusy: authBusy,
} = storeToRefs(authStore);

const pressed = ref(false);
const triggeredByHold = ref(false);
let holdTimer: number | null = null;

const isBusy = computed(() => nodeBusy.value || authBusy.value);
const inAuthMode = computed(() => !isAuthenticated.value);
const inConfirmMode = computed(() => {
  if (inAuthMode.value) {
    return true;
  }
  return viewState.value === 'add' || viewState.value === 'move' || viewState.value === 'delete';
});
const canConfirm = computed(() => {
  if (inAuthMode.value) {
    return canAuthSubmit.value;
  }
  return canNodeConfirm.value;
});

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

  if (canConfirm.value) {
    holdTimer = window.setTimeout(async () => {
      triggeredByHold.value = true;
      pressed.value = false;
      if (inAuthMode.value) {
        await authStore.submitByKnob();
        return;
      }
      await nodeStore.confirmOperation();
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
    if (inAuthMode.value) {
      authStore.toggleMode();
      return;
    }
    await nodeStore.onKnobClick();
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
  place-items: center;
  padding: 1px;
}

.knob-stage {
  width: 100%;
  display: grid;
  place-items: center;
}

.knob-well {
  width: 100%;
  aspect-ratio: 1 / 1;
  padding: 1px;
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

.knob-body :deep(.glass-raised) {
  box-shadow:
    4px 4px 8px rgba(49, 78, 151, 0.16),
    -4px -4px 8px rgba(255, 255, 255, 0.3);
}

.knob-core {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background:
    radial-gradient(circle at 30% 28%, rgba(255, 255, 255, 0.96) 0%, rgba(223, 245, 255, 0.92) 30%, rgba(162, 191, 255, 0.88) 58%, rgba(102, 128, 255, 0.94) 100%);
  animation: knob-idle 2.8s ease-in-out infinite;
}

.confirmable .knob-core::after {
  content: '';
  position: absolute;
  inset: 8px;
  border-radius: 50%;
  border: 1px solid rgba(102, 255, 229, 0.28);
}

.hold-ring {
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  border: 2px solid rgba(102, 255, 229, 0.78);
  border-right-color: transparent;
  animation: knob-hold 700ms linear forwards;
}

@keyframes knob-idle {
  0%,
  100% {
    transform: scale(1);
  }

  50% {
    transform: scale(0.985);
  }
}

@keyframes knob-hold {
  0% {
    transform: rotate(0deg);
    opacity: 0.4;
  }

  100% {
    transform: rotate(360deg);
    opacity: 1;
  }
}

@media (max-width: 1100px) {
  .knob-stage {
    width: 112px;
  }
}
</style>
