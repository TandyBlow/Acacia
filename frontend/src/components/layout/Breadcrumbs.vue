<template>
  <div class="breadcrumbs-shell">
    <TransitionGroup v-if="isAuthenticated" name="crumb" tag="div" class="crumb-track">
      <GlassWrapper
        v-for="node in displayNodes"
        :key="node.id"
        class="crumb-wrap"
        interactive
        @click="goTo(node.id)"
      >
        <button type="button" class="crumb">
          {{ node.name }}
        </button>
      </GlassWrapper>

      <GlassWrapper v-if="showCurrentNode" key="current-node" class="crumb-wrap current-wrap" :class="{ sinking: phase === 'collapsing' }" pressed>
        <div class="current-node">
          {{ activeNode ? activeNode.name : UI.breadcrumbs.home }}
        </div>
      </GlassWrapper>
    </TransitionGroup>

    <div v-else class="crumb-track">
      <GlassWrapper class="crumb-wrap current-wrap" pressed>
        <div class="current-node">
          {{ UI.breadcrumbs.welcome }}
        </div>
      </GlassWrapper>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useAuthStore } from '../../stores/authStore';
import type { NodeRecord } from '../../types/node';
import { UI } from '../../constants/uiStrings';

// Scroll animation constants
const BREADCRUMB_ANIM_MS = 180;
const BREADCRUMB_SCROLL_MIN_ANIM_MS = 80;
const BREADCRUMB_SCROLL_MAX_ANIM_MS = 240;
// Used by wheel event handler in Task 6
// @ts-ignore - used in subsequent tasks
const BREADCRUMB_SCROLL_INPUT_WINDOW_MS = 150;

const store = useNodeStore();
const authStore = useAuthStore();
const { pathNodes, activeNode } = storeToRefs(store);
const { isAuthenticated } = storeToRefs(authStore);

type Phase = 'idle' | 'collapsing' | 'expanding';
const phase = ref<Phase>('idle');
const displayNodes = ref<NodeRecord[]>([...pathNodes.value]);
const showCurrentNode = ref(true);

// Scroll engine state
// Used by processScrollQueue in Task 5
// @ts-ignore - used in subsequent tasks
const scrollQueue = ref<Array<{ direction: 'left' | 'right' }>>([]);
// Used by processScrollQueue in Task 5
// @ts-ignore - used in subsequent tasks
const isAnimating = ref(false);
// Used by wheel event handler in Task 6
// @ts-ignore - used in subsequent tasks
const lastWheelTime = ref(0);
const currentSpeed = ref(0);
// Used by calcAnimDuration in Task 5
// @ts-ignore - used in subsequent tasks
const currentAnimMs = ref(BREADCRUMB_ANIM_MS);
const crumbTrackRef = ref<HTMLElement | null>(null);
// Used by animateSingleScroll in Task 5
// @ts-ignore - used in subsequent tasks
let scrollCancelToken = 0;

// [Bug6 fix] cancel token to invalidate stale animation callbacks
let animToken = 0;

watch(pathNodes, (newPath, oldPath) => {
  // [Bug5 fix] initial mount — skip animation, just set directly
  if (oldPath === undefined) {
    displayNodes.value = [...newPath];
    return;
  }

  // [Bug6 fix] rapid navigation — cancel pending animation, reset state
  if (phase.value !== 'idle') {
    animToken++;
    phase.value = 'idle';
    showCurrentNode.value = true;
    displayNodes.value = [...newPath];
    return;
  }

  const old = oldPath;
  const next = newPath;

  // Find divergence point
  let diverge = 0;
  while (
    diverge < old.length &&
    diverge < next.length &&
    old[diverge]!.id === next[diverge]!.id
  ) {
    diverge++;
  }

  const hasRemovals = diverge < old.length;
  const hasAdditions = diverge < next.length;

  if (!hasRemovals && !hasAdditions) {
    displayNodes.value = [...next];
    return;
  }

  const token = ++animToken;

  if (hasRemovals) {
    phase.value = 'collapsing';

    setTimeout(() => {
      if (token !== animToken) return;
      displayNodes.value = [...next];
      showCurrentNode.value = true;
      phase.value = 'idle';
    }, 200);
  } else {
    // Only additions, just expand
    phase.value = 'expanding';
    displayNodes.value = [...next];
    showCurrentNode.value = true;

    setTimeout(() => {
      if (token !== animToken) return;
      phase.value = 'idle';
    }, 240);
  }
}, { immediate: true });

// Used by processScrollQueue in Task 5
// @ts-ignore - used in subsequent tasks
function calcAnimDuration(): number {
  const speed = currentSpeed.value;
  if (speed <= 0) return BREADCRUMB_ANIM_MS;

  const clampedSpeed = Math.max(1, Math.min(speed, 12));
  const duration = BREADCRUMB_SCROLL_MAX_ANIM_MS -
    (clampedSpeed - 1) * (BREADCRUMB_SCROLL_MAX_ANIM_MS - BREADCRUMB_SCROLL_MIN_ANIM_MS) / 11;

  return Math.round(duration);
}

// Used by animateSingleScroll in Task 4
function findNextScrollTarget(direction: 'left' | 'right'): number {
  const container = crumbTrackRef.value;
  if (!container) return 0;

  const currentScrollLeft = container.scrollLeft;
  const containerLeft = container.getBoundingClientRect().left;

  const items = Array.from(container.querySelectorAll('.crumb-wrap')) as HTMLElement[];

  if (direction === 'right') {
    for (const item of items) {
      const itemRect = item.getBoundingClientRect();
      const itemLeft = itemRect.left - containerLeft + currentScrollLeft;

      if (itemLeft > currentScrollLeft + 10) {
        return itemLeft;
      }
    }
    return container.scrollWidth - container.clientWidth;
  } else {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!;
      const itemRect = item.getBoundingClientRect();
      const itemLeft = itemRect.left - containerLeft + currentScrollLeft;

      if (itemLeft < currentScrollLeft - 10) {
        return itemLeft;
      }
    }
    return 0;
  }
}

// Used by processScrollQueue in Task 5
// @ts-ignore - used in subsequent tasks
async function animateSingleScroll(direction: 'left' | 'right', duration: number): Promise<void> {
  const container = crumbTrackRef.value;
  if (!container) return;

  const targetScrollLeft = findNextScrollTarget(direction);
  const token = ++scrollCancelToken;

  container.style.scrollBehavior = 'smooth';
  container.scrollLeft = targetScrollLeft;

  await new Promise(resolve => setTimeout(resolve, duration));

  if (token !== scrollCancelToken) return;

  container.style.scrollBehavior = 'auto';
}

// Used by wheel event handler in Task 6
// @ts-ignore - used in subsequent tasks
async function processScrollQueue(): Promise<void> {
  isAnimating.value = true;

  while (scrollQueue.value.length > 0) {
    const entry = scrollQueue.value.shift()!;

    const container = crumbTrackRef.value;
    if (!container) break;

    const canScroll = entry.direction === 'right'
      ? container.scrollLeft < container.scrollWidth - container.clientWidth
      : container.scrollLeft > 0;

    if (!canScroll) continue;

    const duration = calcAnimDuration();
    currentAnimMs.value = duration;

    await animateSingleScroll(entry.direction, duration);
  }

  isAnimating.value = false;
  currentSpeed.value = 0;
}

async function goTo(nodeId: string): Promise<void> {
  if (phase.value !== 'idle') return;
  await store.loadNode(nodeId);
}
</script>

<style scoped>
.breadcrumbs-shell {
  width: 100%;
  height: 100%;
  padding: 1px;
  overflow: hidden;
}

.crumb-track {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  gap: 1px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.crumb-track::-webkit-scrollbar {
  display: none;
}

.crumb-wrap {
  flex: 0 0 auto;
  width: max-content;
  min-width: 0;
  height: 100%;
}

.current-wrap {
  border-color: rgba(109, 138, 255, 0.34);
}

.current-wrap :deep(.glass) {
  border-style: solid;
}

.current-wrap.sinking :deep(.glass) {
  transform: translateY(3px) scale(0.98);
  opacity: 0.6;
}

.crumb,
.current-node {
  height: 100%;
  width: auto;
  min-width: 0;
  padding: 0 16px;
  border: 0;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  color: var(--color-primary);
  font-size: 14px;
}

.crumb {
  cursor: pointer;
}

.crumb-wrap :deep(.glass) {
  width: auto;
  height: 100%;
  display: inline-flex;
}

.crumb-wrap :deep(.glass-content) {
  width: auto;
  display: inline-flex;
}

.crumb-wrap :deep(.glass-raised) {
  box-shadow:
    4px 4px 8px rgba(49, 78, 151, 0.16),
    -4px -4px 8px rgba(255, 255, 255, 0.3);
}

.crumb-wrap :deep(.glass-pressed) {
  box-shadow: none;
}

.crumb-enter-active,
.crumb-move {
  transition:
    opacity 240ms ease,
    transform 240ms ease;
}

.crumb-leave-active {
  position: absolute;
  transition:
    opacity 240ms ease,
    transform 240ms ease;
}

.crumb-enter-from {
  opacity: 0;
  transform: translateX(18px) scale(0.96);
}

.crumb-leave-to {
  opacity: 0;
  transform: translateX(-18px) scale(0.96);
}

.current-wrap.crumb-enter-from {
  opacity: 0;
  transform: translateY(6px) scale(0.97);
}

.current-wrap.crumb-enter-active {
  transition:
    opacity 280ms ease,
    transform 280ms ease;
}
</style>
