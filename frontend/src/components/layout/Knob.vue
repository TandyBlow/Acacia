<template>
  <div class="knob-panel">
    <p v-if="showLabels" class="knob-label knob-label-top">{{ topLabel }}</p>
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
            <GlassWrapper class="knob-body" shape="circle" :pressed="pressed || isBusy" interactive />
            <span v-if="inConfirmMode && canConfirm && pressed" class="hold-ring" />
          </button>
        </div>
      </GlassWrapper>
    </div>
    <p v-if="showBottomLabel" class="knob-label knob-label-bottom">{{ UI.knob.holdToConfirm }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useAuthStore } from '../../stores/authStore';
import { useKnobDispatch } from '../../composables/useKnobDispatch';
import { KNOB_HOLD_MS } from '../../constants/app';
import { UI } from '../../constants/uiStrings';

const nodeStore = useNodeStore();
const authStore = useAuthStore();
const { isAuthenticated } = storeToRefs(authStore);

const {
  isBusy,
  inConfirmMode,
  canConfirm,
  onHoldConfirm,
  onClick,
  isLoggingOut,
} = useKnobDispatch();

const pressed = ref(false);
const triggeredByHold = ref(false);
let holdTimer: number | null = null;

const showLabels = computed(() => isAuthenticated.value);
const showBottomLabel = computed(() =>
  isAuthenticated.value && inConfirmMode.value,
);
const topLabel = computed(() =>
  !nodeStore.isEditState && !isLoggingOut.value ? UI.knob.clickToHome : UI.knob.clickToReturn,
);

function clearTimer(): void {
  if (holdTimer !== null) {
    window.clearTimeout(holdTimer);
    holdTimer = null;
  }
}

function onPressStart(): void {
  if (isBusy.value) return;

  pressed.value = true;
  triggeredByHold.value = false;
  clearTimer();

  if (canConfirm.value) {
    holdTimer = window.setTimeout(async () => {
      triggeredByHold.value = true;
      pressed.value = false;
      await onHoldConfirm();
    }, KNOB_HOLD_MS);
  }
}

async function onPressEnd(): Promise<void> {
  if (!pressed.value && !holdTimer) return;

  clearTimer();
  const shouldClick = !triggeredByHold.value;
  pressed.value = false;
  triggeredByHold.value = false;

  if (shouldClick) {
    await onClick();
  }
}

function onPressCancel(): void {
  if (!pressed.value && !holdTimer) return;

  clearTimer();
  pressed.value = false;
  triggeredByHold.value = false;
}
</script>

<style scoped>
.knob-panel {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1px;
}

.knob-label {
  position: absolute;
  left: 0;
  right: 0;
  margin: 0;
  font-size: 11px;
  color: var(--color-primary);
  opacity: 0.6;
  text-align: center;
  line-height: 1.3;
  word-break: break-all;
}

.knob-label-top {
  top: 8px;
}

.knob-label-bottom {
  bottom: 8px;
}

.knob-stage {
  width: 100%;
  display: grid;
  place-items: center;
}

.knob-well {
  width: 76px;
  height: 76px;
  padding: 1px;
}

.knob-well-inner {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
}

.knob-hit-area {
  position: relative;
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
    4px 4px 8px var(--shadow-raised-a),
    -4px -4px 8px var(--shadow-raised-b);
}

.knob-body :deep(.glass-content) {
  position: relative;
  animation: knob-idle 2.8s ease-in-out infinite;
}

.confirmable .knob-body :deep(.glass-content)::after {
  content: '';
  position: absolute;
  inset: 8px;
  border-radius: 50%;
  border: 1px solid rgba(102, 255, 229, 0.28);
}

.hold-ring {
  position: absolute;
  inset: 4px;
  z-index: 1;
  pointer-events: none;
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
