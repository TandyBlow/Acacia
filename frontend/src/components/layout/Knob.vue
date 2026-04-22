<template>
  <div class="knob-panel">
    <!-- Hint columns (desktop) -->
    <div v-if="isAuthenticated && !isCompactLayout" class="hint-column hint-left">
      <Transition name="hint-fade">
        <span v-if="showClickHintLocal" class="knob-hint">{{ UI.knob.clickToHome }}</span>
      </Transition>
      <Transition name="hint-fade">
        <span v-if="showHoldHintLocal" class="knob-hint">{{ UI.knob.holdToConfirm }}</span>
      </Transition>
    </div>
    <div v-if="isAuthenticated && !isCompactLayout" class="hint-column hint-right">
      <Transition name="hint-fade">
        <span v-if="showDblClickHintLocal" class="knob-hint">{{ UI.knob.dblClickFeature }}</span>
      </Transition>
    </div>

    <!-- Compact hints (mobile, stacked above/below) -->
    <div v-if="isAuthenticated && isCompactLayout && (showClickHintLocal || showHoldHintLocal)" class="hint-compact hint-compact-top">
      <Transition name="hint-fade">
        <span v-if="showClickHintLocal" class="knob-hint-compact">{{ UI.knob.clickToHome }}</span>
      </Transition>
      <Transition name="hint-fade">
        <span v-if="showHoldHintLocal" class="knob-hint-compact">{{ UI.knob.holdToConfirm }}</span>
      </Transition>
    </div>

    <div class="knob-stage">
      <div class="knob-well">
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
      </div>
    </div>

    <!-- Compact hint below (mobile) -->
    <div v-if="isAuthenticated && isCompactLayout && showDblClickHintLocal" class="hint-compact hint-compact-bottom">
      <Transition name="hint-fade">
        <span class="knob-hint-compact">{{ UI.knob.dblClickFeature }}</span>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useAuthStore } from '../../stores/authStore';
import { useKnobDispatch } from '../../composables/useKnobDispatch';
import { useKnobHints } from '../../composables/useKnobHints';
import { KNOB_HOLD_MS, KNOB_DBLCLICK_MS } from '../../constants/app';
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
  onDoubleClick,
  isFeaturePanel,
  isCompactLayout,
} = useKnobDispatch();

const { recordAction, showClickHint, showHoldHint, showDblClickHint } = useKnobHints();

const pressed = ref(false);
const triggeredByHold = ref(false);
const lastPressTime = ref(0);
const dblPressDetected = ref(false);
let holdTimer: number | null = null;
let clickTimer: number | null = null;

// Context-aware hint visibility
const showClickHintLocal = computed(() =>
  showClickHint.value && (!nodeStore.isEditState || isFeaturePanel.value),
);

const showHoldHintLocal = computed(() =>
  showHoldHint.value && inConfirmMode.value && !isFeaturePanel.value,
);

const showDblClickHintLocal = computed(() =>
  showDblClickHint.value,
);

function clearTimer(): void {
  if (holdTimer !== null) {
    window.clearTimeout(holdTimer);
    holdTimer = null;
  }
}

function clearClickTimer(): void {
  if (clickTimer !== null) {
    window.clearTimeout(clickTimer);
    clickTimer = null;
  }
}

function onPressStart(): void {
  const now = Date.now();
  const isDblPress = now - lastPressTime.value < KNOB_DBLCLICK_MS;
  lastPressTime.value = now;

  if (isBusy.value) return;

  if (isDblPress) {
    clearClickTimer();
    dblPressDetected.value = true;
    lastPressTime.value = 0;
    return;
  }

  dblPressDetected.value = false;
  pressed.value = true;
  triggeredByHold.value = false;
  clearTimer();

  if (canConfirm.value) {
    holdTimer = window.setTimeout(async () => {
      triggeredByHold.value = true;
      pressed.value = false;
      recordAction('hold');
      await onHoldConfirm();
    }, KNOB_HOLD_MS);
  }
}

async function onPressEnd(): Promise<void> {
  if (dblPressDetected.value) {
    dblPressDetected.value = false;
    recordAction('dblclick');
    await onDoubleClick();
    return;
  }

  if (!pressed.value && !holdTimer) return;

  clearTimer();
  const shouldClick = !triggeredByHold.value;
  pressed.value = false;
  triggeredByHold.value = false;

  if (shouldClick) {
    recordAction('click');
    clickTimer = window.setTimeout(async () => {
      clickTimer = null;
      await onClick();
    }, KNOB_DBLCLICK_MS);
  }
}

function onPressCancel(): void {
  if (!pressed.value && !holdTimer) return;

  clearTimer();
  clearClickTimer();
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

.knob-hint {
  font-size: 11px;
  color: var(--color-primary);
  opacity: 0.6;
  white-space: nowrap;
  line-height: 1.3;
}

.knob-hint-compact {
  font-size: 10px;
  color: var(--color-primary);
  opacity: 0.6;
  text-align: center;
  line-height: 1.3;
}

.hint-column {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
}

.hint-left {
  right: calc(100% + 8px);
  text-align: right;
}

.hint-right {
  left: calc(100% + 8px);
  text-align: left;
}

.hint-compact {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  pointer-events: none;
}

.hint-compact-top {
  margin-bottom: 2px;
}

.hint-compact-bottom {
  margin-top: 2px;
}

.hint-fade-enter-active,
.hint-fade-leave-active {
  transition: opacity 300ms ease;
}

.hint-fade-enter-from,
.hint-fade-leave-to {
  opacity: 0;
}

.knob-stage {
  width: 100%;
  display: grid;
  place-items: center;
}

.knob-well {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  border: 1px solid var(--color-glass-border);
  overflow: hidden;
  box-shadow:
    inset 9px 9px 18px var(--shadow-inset-a),
    inset -9px -9px 18px var(--shadow-inset-b);
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

.knob-body :deep(.glass-pressed) {
  box-shadow: none;
}

.knob-body :deep(.glass-content) {
  position: relative;
  animation: knob-idle 2.8s ease-in-out infinite;
}

.knob-body :deep(.glass-pressed .glass-content) {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  animation: none;
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

@media (max-width: 900px) {
  .knob-stage {
    width: 82px;
  }
}
</style>
