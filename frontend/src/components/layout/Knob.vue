<template>
  <div class="knob-panel">
    <!-- Hint columns (desktop) -->
    <!--
    <div v-if="isAuthenticated && layoutType !== 'small'" class="hint-column hint-left">
      <Transition name="cell">
        <span v-if="showClickHintLocal" class="knob-hint">{{ UI.knob.clickToHome }}</span>
      </Transition>
      <Transition name="cell">
        <span v-if="showHoldHintLocal" class="knob-hint">{{ UI.knob.holdToConfirm }}</span>
      </Transition>
    </div>
    -->

    <!-- Compact hints (mobile, stacked above) -->
    <!--
    <div v-if="isAuthenticated && isCompactLayout && (showClickHintLocal || showHoldHintLocal)" class="hint-compact hint-compact-top">
      <Transition name="cell">
        <span v-if="showClickHintLocal" class="knob-hint-compact">{{ UI.knob.clickToHome }}</span>
      </Transition>
      <Transition name="cell">
        <span v-if="showHoldHintLocal" class="knob-hint-compact">{{ UI.knob.holdToConfirm }}</span>
      </Transition>
    </div>
    -->

    <div class="knob-stage">
      <div class="knob-well">
        <div class="knob-well-inner">
          <button
            type="button"
            class="knob-hit-area"
            :class="{ confirmable: inConfirmMode && canConfirm }"
            :disabled="isBusy"
            aria-label="旋钮"
            @mousedown="onPressStart"
            @mouseup="onPressEnd"
            @mouseleave="onPressCancel"
            @touchstart.prevent="onPressStart"
            @touchend.prevent="onPressEnd"
            @touchcancel.prevent="onPressCancel"
          >
            <GlassWrapper
              class="knob-body"
              shape="circle"
              :pressed="glassPressed"
              :style="glassPressed ? 'box-shadow: inset 4px 4px 10px var(--shadow-inset-a), inset -4px -4px 10px var(--shadow-inset-b)' : undefined"
              interactive
            />
            <span v-if="showHoldRing" class="hold-ring" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, type Ref } from 'vue';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useKnobDispatch } from '../../composables/useKnobDispatch';
// import { useKnobHints } from '../../composables/useKnobHints';
import { KNOB_HOLD_MS, KNOB_DOUBLE_CLICK_MS } from '../../constants/app';

// Inject content animation state from MainLayout
const contentAnimating = inject<Ref<boolean>>('contentAnimating', ref(false));

const {
  isBusy,
  inConfirmMode,
  canConfirm,
  onHoldConfirm,
  onClick,
  onDoubleClick,
  layoutType,
} = useKnobDispatch();

// const { recordAction, showClickHint, showHoldHint } = useKnobHints();

// --- Animation state ---
const isHolding = ref(false);
const isClickAnimating = ref(false);

const glassPressed = computed(() =>
  isClickAnimating.value || contentAnimating.value || isBusy.value,
);

const showHoldRing = computed(() =>
  inConfirmMode.value && canConfirm.value && isHolding.value,
);

const isInteractable = computed(() =>
  !isClickAnimating.value && !contentAnimating.value && !isBusy.value,
);

// --- Hint visibility ---
// const showClickHintLocal = computed(() =>
//   showClickHint.value && !nodeStore.isEditState,
// );
//
// const showHoldHintLocal = computed(() =>
//   showHoldHint.value && inConfirmMode.value,
// );

// --- Timers ---
let holdTimer: number | null = null;
let clickAnimTimer: number | null = null;
let doubleClickTimer: number | null = null;
let lastClickTime = 0;
let triggeredByHold = false;

// --- Click animation: sink phase (~260ms) + stay phase (~80ms) then CSS transition rises ---
const CLICK_ANIM_MS = 420;

function playClickAnimation(): void {
  isClickAnimating.value = true;
  if (clickAnimTimer !== null) {
    window.clearTimeout(clickAnimTimer);
  }
  clickAnimTimer = window.setTimeout(() => {
    isClickAnimating.value = false;
    clickAnimTimer = null;
  }, CLICK_ANIM_MS);
}

// --- Timer helpers ---
function clearHoldTimer(): void {
  if (holdTimer !== null) {
    window.clearTimeout(holdTimer);
    holdTimer = null;
  }
}

function clearDblClickTimer(): void {
  if (doubleClickTimer !== null) {
    window.clearTimeout(doubleClickTimer);
    doubleClickTimer = null;
  }
  lastClickTime = 0;
}

// --- Press handlers ---
function onPressStart(): void {
  if (!isInteractable.value) return;

  isHolding.value = true;
  triggeredByHold = false;
  clearHoldTimer();

  holdTimer = window.setTimeout(async () => {
    triggeredByHold = true;
    isHolding.value = false;
    clearHoldTimer();
    if (canConfirm.value) {
      playClickAnimation();
      await onHoldConfirm();
    }
  }, KNOB_HOLD_MS);
}

async function onPressEnd(): Promise<void> {
  if (triggeredByHold) {
    triggeredByHold = false;
    return;
  }

  if (!isHolding.value) return;

  clearHoldTimer();
  isHolding.value = false;

  if (layoutType.value === 'small') {
    const now = Date.now();
    if (now - lastClickTime < KNOB_DOUBLE_CLICK_MS && lastClickTime > 0) {
      clearDblClickTimer();
      // recordAction('click');
      playClickAnimation();
      await onDoubleClick();
      return;
    }

    lastClickTime = now;
    // Wait for potential second click before committing to single-click
    doubleClickTimer = window.setTimeout(async () => {
      doubleClickTimer = null;
      lastClickTime = 0;
      // recordAction('click');
      playClickAnimation();
      await onClick();
    }, KNOB_DOUBLE_CLICK_MS);
    return;
  }

  // recordAction('click');
  playClickAnimation();
  await onClick();
}

function onPressCancel(): void {
  if (!isHolding.value && !holdTimer && !triggeredByHold) return;
  clearHoldTimer();
  isHolding.value = false;
  triggeredByHold = false;
}

onBeforeUnmount(() => {
  clearHoldTimer();
  if (clickAnimTimer !== null) window.clearTimeout(clickAnimTimer);
  clearDblClickTimer();
});
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

/*
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
*/

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

.knob-body :deep(.glass) {
  transition: transform 160ms ease, box-shadow 320ms ease, border-color 320ms ease,
              background 240ms ease, backdrop-filter 240ms ease, -webkit-backdrop-filter 240ms ease;
}

.knob-body :deep(.glass-raised) {
  box-shadow:
    4px 4px 8px var(--shadow-raised-a),
    0 -4px 8px var(--shadow-raised-b);
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
