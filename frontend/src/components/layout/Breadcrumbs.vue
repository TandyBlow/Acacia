<template>
  <div class="breadcrumbs-shell">
    <div
      v-if="isAuthenticated"
      class="crumb-track"
      ref="crumbTrackRef"
      @wheel.passive="onWheel"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @touchend.passive="onTouchEnd"
    >
      <GlassWrapper
        v-for="(node, i) in displayNodes"
        :key="node.id"
        class="crumb-wrap"
        :class="{
          'current-wrap': i === displayNodes.length - 1,
          'crumb-slide-out': slideOutIds.has(node.id),
          'crumb-slide-in-prep': enteringIds.has(node.id),
        }"
        :data-crumb-id="node.id"
        :pressed="i === displayNodes.length - 1 || isAnimating"
        interactive
        @click="i < displayNodes.length - 1 && !busy && goTo(node.id)"
      >
        <component
          :is="i === displayNodes.length - 1 ? 'div' : 'button'"
          :class="i === displayNodes.length - 1 ? 'current-node' : 'crumb'"
          :type="i === displayNodes.length - 1 ? undefined : 'button'"
        >
          {{ node.name }}
        </component>
      </GlassWrapper>
    </div>

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
import { ref, watch, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useAuthStore } from '../../stores/authStore';
import type { NodeRecord } from '../../types/node';
import { UI } from '../../constants/uiStrings';

// Animation durations (ms)
const SINK_MS = 240;
const SLIDE_MS = 280;
const RISE_MS = 240;

// Home placeholder shown when at root level (no active node)
const HOME_PLACEHOLDER: NodeRecord = {
  id: '__home__',
  name: UI.breadcrumbs.home,
  content: '',
  parentId: null,
  sortOrder: 0,
};

// Scroll animation constants
const BREADCRUMB_ANIM_MS = 180;
const BREADCRUMB_SCROLL_MIN_ANIM_MS = 80;
const BREADCRUMB_SCROLL_MAX_ANIM_MS = 240;
const BREADCRUMB_SCROLL_INPUT_WINDOW_MS = 150;

const store = useNodeStore();
const authStore = useAuthStore();
const { pathNodes, activeNode } = storeToRefs(store);
const { isAuthenticated } = storeToRefs(authStore);

function buildFullPath(): NodeRecord[] {
  const ancestors = pathNodes.value;
  const current = activeNode.value;
  if (current) return [...ancestors, current];
  // At root level — show home placeholder as current node
  if (ancestors.length === 0) return [HOME_PLACEHOLDER];
  return [...ancestors];
}

// Unified render list: ancestors + current node as last item
const displayNodes = ref<NodeRecord[]>(buildFullPath());

// Animation state
const busy = ref(false);
const isAnimating = ref(false);
const slideOutIds = ref<Set<string>>(new Set());
const enteringIds = ref<Set<string>>(new Set());

// Track last rendered path IDs to detect structural changes
let lastPathIds: string[] = [];

// Scroll engine state
const scrollQueue = ref<Array<{ direction: 'left' | 'right' }>>([]);
const isScrolling = ref(false);
const lastWheelTime = ref(0);
const currentSpeed = ref(0);
const currentAnimMs = ref(BREADCRUMB_ANIM_MS);
const crumbTrackRef = ref<HTMLElement | null>(null);
let scrollCancelToken = 0;

// Touch support state
const touchStartX = ref(0);
const touchStartTime = ref(0);
const touchStartScrollLeft = ref(0);

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function goTo(nodeId: string): Promise<void> {
  if (busy.value) return;

  // Record navigation transition (fire-and-forget)
  const fromId = store.activeNode?.id ?? null;
  if (fromId && fromId !== nodeId) {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:7860';
    const token = localStorage.getItem('acacia_backend_token');
    fetch(`${backendUrl}/context/record-transition`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        from_node_id: fromId,
        to_node_id: nodeId,
        transition_type: 'navigation',
        reason: '',
      }),
    }).catch(() => {});
  }

  await store.loadNode(nodeId);
}

// Cancel token for rapid navigation — invalidates stale animation callbacks
let animToken = 0;

// ================================================================
// 4-phase breadcrumb animation
// ================================================================
async function animateBreadcrumb(oldIds: string[], newIds: string[]) {
  if (busy.value) return;
  busy.value = true;
  isAnimating.value = true;
  const token = ++animToken;
  if (token !== animToken) return;

  const oldSet = new Set(oldIds);
  const newSet = new Set(newIds);
  const leavingIds = oldIds.filter(id => !newSet.has(id));
  const enteringIdsList = newIds.filter(id => !oldSet.has(id));

  // Phase 1: Sink — all active items → pressed (sunken)
  // isAnimating=true triggers :pressed on all GlassWrappers
  await nextTick();
  if (token !== animToken) return;
  await sleep(SINK_MS);
  if (token !== animToken) return;

  // Phase 2: Slide out — unwanted items move up behind the page
  if (leavingIds.length > 0) {
    slideOutIds.value = new Set(leavingIds);
    await sleep(SLIDE_MS);
    if (token !== animToken) return;
    slideOutIds.value = new Set();
  }

  // Commit new path to DOM
  displayNodes.value = buildFullPath();
  if (enteringIdsList.length > 0) {
    enteringIds.value = new Set(enteringIdsList);
  }

  await nextTick();
  if (token !== animToken) return;

  // Phase 3: Slide in — new items arrive from above
  if (enteringIdsList.length > 0) {
    const track = crumbTrackRef.value;
    if (track) {
      const newItems = track.querySelectorAll<HTMLElement>('.crumb-slide-in-prep');
      // Force reflow so slide-in-prep (no transition) is applied
      void track.offsetHeight;
      for (const el of newItems) {
        el.classList.remove('crumb-slide-in-prep');
        el.classList.add('crumb-slide-in');
      }
    }
    await sleep(SLIDE_MS);
    if (token !== animToken) return;

    // Clean up slide-in classes
    const track2 = crumbTrackRef.value;
    if (track2) {
      for (const el of track2.querySelectorAll<HTMLElement>('.crumb-slide-in')) {
        el.classList.remove('crumb-slide-in');
      }
    }
    enteringIds.value = new Set();
  }

  // Phase 4: Rise — all except current node regain shadow
  isAnimating.value = false;
  await nextTick();
  if (token !== animToken) return;
  await sleep(RISE_MS);
  busy.value = false;
}

// Watch for path changes
watch(
  [pathNodes, activeNode],
  () => {
    const newIds = buildFullPath().map(n => n.id);

    // Initial mount or first data load — render without animation
    if (lastPathIds.length === 0) {
      displayNodes.value = buildFullPath();
      lastPathIds = newIds;
      return;
    }

    // Content-only update (e.g. rename) — update text, skip animation
    if (arraysEqual(newIds, lastPathIds)) {
      displayNodes.value = buildFullPath();
      return;
    }

    // Rapid navigation — cancel in-progress animation, snap to new state
    if (busy.value) {
      animToken++;
      slideOutIds.value = new Set();
      enteringIds.value = new Set();
      busy.value = false;
      isAnimating.value = false;
      displayNodes.value = buildFullPath();
      lastPathIds = newIds;
      return;
    }

    // Structural change — run 4-phase animation
    const oldIds = lastPathIds;
    lastPathIds = newIds;

    // Reset scroll state on path change
    scrollQueue.value = [];
    currentSpeed.value = 0;
    isScrolling.value = false;
    scrollCancelToken++;

    animateBreadcrumb(oldIds, newIds);
  },
  { immediate: true },
);

// ================================================================
// Scroll engine (unchanged)
// ================================================================
function calcAnimDuration(): number {
  const speed = currentSpeed.value;
  if (speed <= 0) return BREADCRUMB_ANIM_MS;

  const clampedSpeed = Math.max(1, Math.min(speed, 12));
  const duration = BREADCRUMB_SCROLL_MAX_ANIM_MS -
    (clampedSpeed - 1) * (BREADCRUMB_SCROLL_MAX_ANIM_MS - BREADCRUMB_SCROLL_MIN_ANIM_MS) / 11;

  return Math.round(duration);
}

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
      if (itemLeft > currentScrollLeft + 10) return itemLeft;
    }
    return container.scrollWidth - container.clientWidth;
  } else {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!;
      const itemRect = item.getBoundingClientRect();
      const itemLeft = itemRect.left - containerLeft + currentScrollLeft;
      if (itemLeft < currentScrollLeft - 10) return itemLeft;
    }
    return 0;
  }
}

async function animateSingleScroll(direction: 'left' | 'right', duration: number): Promise<void> {
  const container = crumbTrackRef.value;
  if (!container) return;

  const targetScrollLeft = findNextScrollTarget(direction);
  const token = ++scrollCancelToken;

  container.style.scrollBehavior = 'smooth';
  container.scrollLeft = targetScrollLeft;

  await sleep(duration);

  if (token !== scrollCancelToken) return;
  container.style.scrollBehavior = 'auto';
}

async function processScrollQueue(): Promise<void> {
  isScrolling.value = true;

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

  isScrolling.value = false;
  currentSpeed.value = 0;
}

function onWheel(e: WheelEvent): void {
  if (e.deltaY === 0) return;

  const now = Date.now();
  const dt = now - lastWheelTime.value;
  lastWheelTime.value = now;

  if (dt > 0 && dt < BREADCRUMB_SCROLL_INPUT_WINDOW_MS * 3) {
    const delta = Math.abs(e.deltaY);
    const itemsEquiv = delta / 120;
    currentSpeed.value = itemsEquiv / (dt / 1000);
  } else {
    currentSpeed.value = Math.max(1, currentSpeed.value * 0.5);
  }

  const direction: 'left' | 'right' = e.deltaY > 0 ? 'right' : 'left';

  if (scrollQueue.value.length < 20) {
    scrollQueue.value.push({ direction });
  }

  if (!isScrolling.value) {
    processScrollQueue();
  }
}

function onTouchStart(e: TouchEvent): void {
  const container = crumbTrackRef.value;
  if (!container || e.touches.length === 0) return;

  touchStartX.value = e.touches[0]!.clientX;
  touchStartTime.value = Date.now();
  touchStartScrollLeft.value = container.scrollLeft;
}

function onTouchMove(e: TouchEvent): void {
  const container = crumbTrackRef.value;
  if (!container || e.touches.length === 0) return;

  const touchX = e.touches[0]!.clientX;
  const deltaX = touchStartX.value - touchX;
  container.scrollLeft = touchStartScrollLeft.value + deltaX;
}

function onTouchEnd(e: TouchEvent): void {
  const container = crumbTrackRef.value;
  if (!container) return;

  const now = Date.now();
  const dt = now - touchStartTime.value;

  if (dt > 0 && dt < 300 && e.changedTouches.length > 0) {
    const touchEndX = e.changedTouches[0]!.clientX;
    const deltaX = touchStartX.value - touchEndX;
    const velocity = Math.abs(deltaX) / dt;

    if (velocity > 0.5) {
      const direction: 'left' | 'right' = deltaX > 0 ? 'right' : 'left';
      const steps = Math.min(3, Math.ceil(velocity * 2));

      for (let i = 0; i < steps; i++) {
        if (scrollQueue.value.length < 20) {
          scrollQueue.value.push({ direction });
        }
      }

      if (!isScrolling.value) {
        processScrollQueue();
      }
    }
  }
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
  color: var(--color-primary-on-light, var(--color-primary));
  font-size: 14px;
  transition: filter 160ms ease, text-shadow 160ms ease;
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

.crumb-wrap :deep(.glass-pressed) .crumb,
.crumb-wrap :deep(.glass-pressed) .current-node {
  filter: brightness(0.88);
  transform: translateY(1px);
  text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.18), 0 1px 0 rgba(255, 255, 255, 0.1);
}

/* ================================================================
   Phase 2: Slide out — sunken items move upward behind the page
   ================================================================ */
.crumb-slide-out {
  transform: translateY(-64px);
  opacity: 0;
  transition:
    transform 280ms cubic-bezier(0.4, 0, 0.6, 1),
    opacity 280ms ease;
}

/* ================================================================
   Phase 3: Slide in — new items start above, slide down into place
   ================================================================ */
.crumb-slide-in-prep {
  transform: translateY(-64px);
  opacity: 0;
  transition: none;
}

.crumb-slide-in {
  transform: translateY(0);
  opacity: 1;
  transition:
    transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
    opacity 280ms ease;
}
</style>
