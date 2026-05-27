<template>
  <div class="nav-shell" :class="{
    'nav-sinking': navPhase === 'sinking',
    'nav-slide-out': navPhase === 'sliding-out',
    'nav-slide-in-prep': navPhase === 'sliding-in-prep',
    'nav-slide-in': navPhase === 'sliding-in',
    'nav-rising': navPhase === 'rising',
    'official-sunken': otPhase === 'sinking' || otPhase === 'sliding' || otPhase === 'anchor-sliding',
    'official-sliding': otPhase === 'sliding',
  }">
    <template v-if="isAuthenticated">
      <TransitionGroup
        v-show="!hideNodeList && !hideNonAnchorItems"
        ref="nodeListRef"
        :name="effectiveTransitionName"
        :style="{ '--cell-anim-ms': `${currentAnimMs}ms` }"
        tag="div"
        class="node-list"
        :class="{ 'official-sliding': otPhase === 'sliding', 'scroll-dir-up': scrollDirection === 'up' }"
        @before-leave="onBeforeLeave"
        @wheel.prevent="onWheel"
        @touchstart.passive="onTouchStart"
        @touchend="onTouchEnd"
      >
        <div v-if="displayItems.length === 0" key="empty" class="empty" />

        <div v-for="item in displayItems" :key="item.id" class="row" :data-item-id="item.id" :class="{ 'clicked-target': otPhase === 'sliding' && item.id === otClickedItemId }">
          <GlassWrapper
            class="row-glass"
            :class="{ 'official-glass': item.isOfficial }"
            interactive
            :pressed="(item.isOfficial && pressedOfficialId === item.id) || (!item.isOfficial && (pressedNodeId === item.id || scrollingTopId === item.id || scrollingBottomId === item.id))"
            @click="item.isOfficial ? onOfficialClick(item) : onRowClick(item.id)"
            @contextmenu.prevent="!item.isOfficial && onContextMenu(item.id)"
          >
            <div class="row-content" :class="{ 'official-content': item.isOfficial }">
              <template v-if="!item.isOfficial && actionNodeId === item.id">
                <div class="inline-actions">
                  <button type="button" class="action-half" @click.stop="moveNode(item.nodeData!)">{{ UI.nav.move }}</button>
                  <button type="button" class="action-half" @click.stop="deleteNode(item.nodeData!)">{{ UI.nav.delete }}</button>
                </div>
              </template>
              <template v-else>
                <span class="row-name" :class="{ 'official-name': item.isOfficial }">{{ item.name }}</span>
              </template>
            </div>
          </GlassWrapper>
        </div>
      </TransitionGroup>

      <GlassWrapper v-if="!anchorOfficial" class="add-shell" interactive :pressed="addPressed" @click="onAddClick">
        <button type="button" class="add-button">
          {{ UI.nav.addNode }}
        </button>
      </GlassWrapper>
      <GlassWrapper v-if="anchorOfficial" class="add-shell anchor-official-shell" :class="{ 'anchor-prep': anchorSlidingDown || otAnchorPrep, 'anchor-sinking': otPhase === 'sinking' || otPhase === 'sliding' || otPhase === 'anchor-sliding' }" :style="otAnchorDeltaY ? { '--anchor-delta-y': otAnchorDeltaY + 'px' } : {}" interactive pressed @click="onAnchorOfficialClick">
        <div class="official-content">
          <span class="official-name">{{ anchorOfficial.name }}</span>
        </div>
      </GlassWrapper>

    </template>

    <div v-else class="auth-tip-shell" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, inject, type ComponentPublicInstance } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useAuthStore } from '../../stores/authStore';
import { useDevStore } from '../../stores/devStore';
import { useKnobDispatch } from '../../composables/useKnobDispatch';
import { useOfficialTransition } from '../../composables/useOfficialTransition';
import type { NodeRecord } from '../../types/node';
import {
  NAV_ROW_H,
  NAV_ROW_GAP,
  NAV_ANIM_MS,
  NAV_SCROLL_MIN_ANIM_MS,
  NAV_SCROLL_MAX_ANIM_MS,
  NAV_SCROLL_MOMENTUM_FRICTION,
  NAV_SCROLL_MOMENTUM_THRESHOLD,
  NAV_SCROLL_INPUT_WINDOW_MS,
} from '../../constants/app';
import { UI } from '../../constants/uiStrings';

const ROW_STEP = NAV_ROW_H + NAV_ROW_GAP;

// Page navigation animation durations (mirrors breadcrumbs: sink → slide-out → slide-in → rise)
const NAV_SINK_MS = 240;
const NAV_SLIDE_MS = 280;
const NAV_RISE_MS = 240;

const store = useNodeStore();
const authStore = useAuthStore();
const { childNodes, officialNodes, activeNode, viewState } = storeToRefs(store);
const { isAuthenticated } = storeToRefs(authStore);
const { layoutType } = useKnobDispatch();
const {
  phase: otPhase,
  animating: otAnimating,
  anchorItemId: otAnchorItemId,
  clickedItemId: otClickedItemId,
  anchorDeltaY: otAnchorDeltaY,
  anchorPrep: otAnchorPrep,
  hideNonAnchorItems,
  reset: resetOfficialTransition,
} = useOfficialTransition();

const startSmallLayoutOfficialTransition = inject<(item: NavItem, rowEl: HTMLElement) => void>(
  'startSmallLayoutOfficialTransition',
  () => {},
);

const visibleOfficialNodes = computed(() =>
  officialNodes.value.filter(n => n.visible),
);

const pressedOfficialId = computed<string | null>(() => {
  const state = viewState.value;
  if (state === 'daily_quiz') return 'daily_quiz';
  if (state === 'tree_overview') return 'tree_overview';
  if (state === 'official_content') return store.officialNodeContent?.id ?? null;
  return null;
});

// Official section visibility, synchronized with page nav animation
const showOfficialNodes = ref(visibleOfficialNodes.value.length > 0 && !activeNode.value);

// Keep showOfficialNodes and displayItems in sync when not mid-animation
// Covers: dailyQuizVisible async update, viewState transitions in non-compact layout
watch([visibleOfficialNodes, activeNode], () => {
  if (navAnimating.value || isAnimating.value) return;
  const next = visibleOfficialNodes.value.length > 0 && !activeNode.value;
  showOfficialNodes.value = next;
  displayItems.value = scrollSource.value.slice(scrollOffset.value, scrollOffset.value + maxVisible.value);
});

interface NavItem {
  id: string;
  name: string;
  isOfficial: boolean;
  action?: () => void;
  nodeData?: NodeRecord;
}

// Full scrollable list: official nodes (when shown) + child nodes
const scrollSource = computed<NavItem[]>(() => {
  const items: NavItem[] = [];
  if (showOfficialNodes.value) {
    for (const n of visibleOfficialNodes.value) {
      items.push({ id: n.id, name: n.name, isOfficial: true, action: n.action });
    }
  }
  for (const n of childNodes.value) {
    items.push({ id: n.id, name: n.name, isOfficial: false, nodeData: n });
  }
  return items;
});

// --- page navigation animation state ---
const navPhase = ref<'idle' | 'sinking' | 'sliding-out' | 'sliding-in-prep' | 'sliding-in' | 'rising'>('idle');
const navAnimating = ref(false);
let navAnimToken = 0;
let hasInitialized = false;
let pendingFirstData = true;

// --- small layout add/official animation state ---
const hideNodeList = ref(false);
const anchorOfficial = ref<NavItem | null>(null);
const anchorSlidingDown = ref(false);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- scroll state ---
const nodeListRef = ref<ComponentPublicInstance | HTMLElement | null>(null);
const containerH = ref(0);
const scrollOffset = ref(0);
const isAnimating = ref(false);
const displayItems = ref<NavItem[]>([]);
const scrollingTopId = ref<string | null>(null);
const scrollingBottomId = ref<string | null>(null);
const scrollDirection = ref<'up' | 'down' | null>(null);
const transitionName = ref('cell');
const devStore = useDevStore();
const effectiveTransitionName = computed(() => {
  if (!devStore.enableTransition || navAnimating.value || otAnimating.value) return 'none';
  return transitionName.value;
});

// Animation queue
interface ScrollEntry {
  direction: 'up' | 'down';
}
const scrollQueue = ref<ScrollEntry[]>([]);
const lastScrollDirection = ref<'up' | 'down'>('down');

// Speed tracking
const lastWheelTime = ref(0);
const currentSpeed = ref(0); // rows/second

// Current animation duration (for CSS variable)
const currentAnimMs = ref(NAV_ANIM_MS);

// [Bug3 fix] cancel token to invalidate stale scroll callbacks
let scrollCancelToken = 0;

const maxVisible = computed(() => {
  if (containerH.value <= 0) return 20;
  // ROW_STEP = ROW_H + GAP, but the last row has no trailing gap.
  // N rows need N*ROW_H + (N-1)*GAP = N*ROW_STEP - GAP pixels.
  return Math.floor((containerH.value + NAV_ROW_GAP) / ROW_STEP);
});

// Calculate animation duration based on current speed
function calcAnimDuration(): number {
  const speed = currentSpeed.value;
  if (speed <= 0) return NAV_ANIM_MS;
  const clampedSpeed = Math.max(1, Math.min(speed, 12));
  const duration = NAV_SCROLL_MAX_ANIM_MS - (clampedSpeed - 1) * (NAV_SCROLL_MAX_ANIM_MS - NAV_SCROLL_MIN_ANIM_MS) / 11;
  return Math.round(duration);
}

// ================================================================
// 4-phase page navigation animation (mirrors breadcrumbs)
// Sink → slide-out-left → commit DOM → slide-in-from-left → rise
// ================================================================
async function animateNavPageTransition() {
  transitionName.value = 'none';

  if (navAnimating.value) {
    navAnimToken++;
    navPhase.value = 'idle';
    navAnimating.value = false;
    pressedNodeId.value = null;
    displayItems.value = scrollSource.value.slice(0, maxVisible.value);
    nextTick(() => { transitionName.value = 'cell'; });
    return;
  }

  navAnimating.value = true;
  const token = ++navAnimToken;
  const el = nodeListRef.value as HTMLElement | null;

  // Phase 1: Sink — all glass items become pressed/sunken
  navPhase.value = 'sinking';
  await nextTick();
  if (token !== navAnimToken) return;
  await sleep(NAV_SINK_MS);
  if (token !== navAnimToken) return;

  // Phase 2: Slide out left — old content slides left behind the page
  navPhase.value = 'sliding-out';
  await sleep(NAV_SLIDE_MS);
  if (token !== navAnimToken) return;

  // Commit new DOM in prep position (off-screen left, no transition)
  showOfficialNodes.value = visibleOfficialNodes.value.length > 0 && !activeNode.value;
  pressedNodeId.value = null;
  displayItems.value = scrollSource.value.slice(0, maxVisible.value);
  navPhase.value = 'sliding-in-prep';

  await nextTick();
  if (token !== navAnimToken) return;

  // Force reflow so prep position is painted, then trigger slide-in
  if (el) void el.offsetHeight;
  navPhase.value = 'sliding-in';

  // Phase 3: Slide in from left — new content arrives from behind the page
  await sleep(NAV_SLIDE_MS);
  if (token !== navAnimToken) return;

  // Phase 4: Rise — glass items regain shadow
  navPhase.value = 'rising';
  await nextTick();
  if (token !== navAnimToken) return;
  await sleep(NAV_RISE_MS);

  navPhase.value = 'idle';
  navAnimating.value = false;
  nextTick(() => { transitionName.value = 'cell'; });
}

// --- interaction state ---
const actionNodeId = ref<string | null>(null);
const addPressed = computed(() => store.viewState === 'add');
const pressedNodeId = ref<string | null>(null);

// [Bug2 fix] reset when child nodes change — cancel any in-flight scroll
watch(childNodes, () => {
  scrollCancelToken++;
  scrollQueue.value = [];
  isAnimating.value = false;
  scrollOffset.value = 0;
  scrollingTopId.value = null;
  scrollingBottomId.value = null;
  scrollDirection.value = null;
  currentSpeed.value = 0;
  currentAnimMs.value = NAV_ANIM_MS;

  if (!hasInitialized) {
    // Setup fire (immediate: true)
    hasInitialized = true;
    showOfficialNodes.value = visibleOfficialNodes.value.length > 0 && !activeNode.value;
    pressedNodeId.value = null;
    displayItems.value = scrollSource.value.slice(0, maxVisible.value);
    transitionName.value = 'none';
    nextTick(() => { transitionName.value = 'cell'; });
  } else if (pendingFirstData) {
    // Initial data load
    pendingFirstData = false;
    showOfficialNodes.value = visibleOfficialNodes.value.length > 0 && !activeNode.value;
    pressedNodeId.value = null;
    displayItems.value = scrollSource.value.slice(0, maxVisible.value);
    transitionName.value = 'none';
    nextTick(() => { transitionName.value = 'cell'; });
  } else {
    // Page navigation
    animateNavPageTransition();
  }
}, { immediate: true });

// Without this reset, resizing to large layout while in add/daily_quiz/official_content
// leaves the node list permanently hidden.
watch(layoutType, (lt) => {
  if (lt !== 'small') {
    hideNodeList.value = false;
    hideNonAnchorItems.value = false;
    otAnchorItemId.value = null;
    otClickedItemId.value = null;
    otAnchorDeltaY.value = 0;
    otAnchorPrep.value = false;
    anchorOfficial.value = null;
    anchorSlidingDown.value = false;
  }
});

// Reset hideNodeList when leaving add state in small layout.
// animateSmallLayoutAdd sets hideNodeList=true; cancelOperation (or any
// other exit from add) must clear it so the node list reappears.
// Also reset official transition state when leaving daily_quiz/official_content.
watch(() => store.viewState, (newState, oldState) => {
  if (oldState === 'add' && newState !== 'add') {
    hideNodeList.value = false;
  }
  if ((oldState === 'daily_quiz' || oldState === 'official_content') && newState === 'display') {
    resetOfficialTransition();
  }
});

// Sync anchorOfficial from shared composable during official transition
watch(otAnchorItemId, (id) => {
  if (id) {
    const item = scrollSource.value.find(i => i.id === id);
    if (item) anchorOfficial.value = item;
  } else if (!otAnimating.value) {
    anchorOfficial.value = null;
  }
});

// [Bug4 fix] update visible window when container resizes
watch(maxVisible, (mv) => {
  if (!isAnimating.value && !navAnimating.value) {
    displayItems.value = scrollSource.value.slice(scrollOffset.value, scrollOffset.value + mv);
  }
});

function onRowClick(nodeId: string): void {
  if (isAnimating.value || navAnimating.value || otAnimating.value) return;
  if (actionNodeId.value === nodeId) return;
  openNode(nodeId);
}

function onContextMenu(nodeId: string): void {
  if (isAnimating.value || navAnimating.value || otAnimating.value) return;
  toggleActions(nodeId);
}

function openNode(nodeId: string): void {
  if (pressedNodeId.value || navAnimating.value || otAnimating.value) return;
  actionNodeId.value = null;
  pressedNodeId.value = nodeId;

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

  setTimeout(() => {
    store.loadNode(nodeId).catch(() => {
      pressedNodeId.value = null;
    });
    // 安全超时：若 childNodes 未变化（watcher 未触发），3s 后强制重置
    setTimeout(() => {
      if (pressedNodeId.value === nodeId) {
        pressedNodeId.value = null;
      }
    }, 3000);
  }, 200);
}

function onAddClick(): void {
  if (addPressed.value) {
    store.cancelOperation();
    return;
  }
  if (layoutType.value === 'small') {
    animateSmallLayoutAdd();
  } else {
    store.startAdd();
  }
}

function onOfficialClick(item: NavItem): void {
  if (pressedOfficialId.value === item.id) {
    resetOfficialTransition();
    store.cancelOperation();
  } else if (layoutType.value === 'small') {
    const rowEl = getRowElement(item.id);
    if (rowEl) {
      startSmallLayoutOfficialTransition(item, rowEl as HTMLElement);
    }
  } else {
    item.action!();
  }
}

function getRowElement(itemId: string): Element | null {
  const inst = nodeListRef.value;
  if (!inst) return null;
  const el = '$el' in inst ? (inst as ComponentPublicInstance).$el : inst;
  if (!(el instanceof HTMLElement)) return null;
  return el.querySelector(`[data-item-id="${itemId}"]`) ?? null;
}

function onAnchorOfficialClick(): void {
  resetOfficialTransition();
  store.cancelOperation();
}

// ================================================================
// Small layout add animation — reuse navPhase state machine
// Add: sink → node list slides out left (add button stays) → startAdd
// ================================================================
async function animateSmallLayoutAdd() {
  if (navAnimating.value) {
    navAnimToken++;
    navPhase.value = 'idle';
    navAnimating.value = false;
    hideNodeList.value = false;
  }

  navAnimating.value = true;
  const token = ++navAnimToken;

  navPhase.value = 'sinking';
  await nextTick();
  await sleep(NAV_SINK_MS);
  if (token !== navAnimToken) return;

  navPhase.value = 'sliding-out';
  await sleep(NAV_SLIDE_MS);
  if (token !== navAnimToken) return;

  hideNodeList.value = true;
  navPhase.value = 'idle';
  navAnimating.value = false;

  store.startAdd();
}


function onBeforeLeave(el: Element): void {
  const htmlEl = el as HTMLElement;
  const rect = htmlEl.getBoundingClientRect();
  const parentRect = htmlEl.parentElement?.getBoundingClientRect();
  if (parentRect) {
    htmlEl.style.top = `${rect.top - parentRect.top}px`;
    htmlEl.style.left = `${rect.left - parentRect.left}px`;
    htmlEl.style.width = `${rect.width}px`;
  }
}


function toggleActions(nodeId: string): void {
  actionNodeId.value = actionNodeId.value === nodeId ? null : nodeId;
}

function onDocumentClick(e: MouseEvent): void {
  if (actionNodeId.value === null) return;
  if ((e.target as HTMLElement).closest('.inline-actions')) return;
  actionNodeId.value = null;
}

onMounted(() => document.addEventListener('click', onDocumentClick, true));
onUnmounted(() => document.removeEventListener('click', onDocumentClick, true));

async function moveNode(node: NodeRecord): Promise<void> {
  actionNodeId.value = null;
  await store.startMove(node);
}

async function deleteNode(node: NodeRecord): Promise<void> {
  actionNodeId.value = null;
  await store.startDelete(node);
}

// --- scroll animation engine ---
function onWheel(e: WheelEvent): void {
  if (e.deltaY === 0) return;

  const now = Date.now();
  const dt = now - lastWheelTime.value;
  lastWheelTime.value = now;

  if (dt > 0 && dt < NAV_SCROLL_INPUT_WINDOW_MS * 3) {
    const delta = Math.abs(e.deltaY);
    const rowsEquiv = delta / 120;
    currentSpeed.value = rowsEquiv / (dt / 1000);
  } else {
    currentSpeed.value = Math.max(1, currentSpeed.value * 0.5);
  }

  const direction: 'up' | 'down' = e.deltaY > 0 ? 'down' : 'up';
  lastScrollDirection.value = direction;

  if (scrollQueue.value.length < 6) {
    scrollQueue.value.push({ direction });
  }

  if (!isAnimating.value) {
    processScrollQueue();
  }
}

let touchY = 0;
let touchStartTime = 0;
function onTouchStart(e: TouchEvent): void {
  if (e.touches[0]) {
    touchY = e.touches[0].clientY;
    touchStartTime = Date.now();
  }
}
function onTouchEnd(e: TouchEvent): void {
  if (!e.changedTouches[0]) return;
  const dy = touchY - e.changedTouches[0].clientY;
  if (Math.abs(dy) < 30) return;

  const direction: 'up' | 'down' = dy > 0 ? 'down' : 'up';
  const rows = Math.max(1, Math.round(Math.abs(dy) / ROW_STEP));

  // Track speed for momentum (rows per second)
  const dt = Date.now() - touchStartTime;
  if (dt > 0) {
    currentSpeed.value = rows / (dt / 1000);
  }

  for (let i = 0; i < rows && scrollQueue.value.length < 20; i++) {
    scrollQueue.value.push({ direction });
  }
  lastScrollDirection.value = direction;

  if (!isAnimating.value) {
    processScrollQueue();
  }
}

async function processScrollQueue(): Promise<void> {
  isAnimating.value = true;

  while (scrollQueue.value.length > 0) {
    const entry = scrollQueue.value.shift()!;

    const canScroll = entry.direction === 'down'
      ? scrollOffset.value + maxVisible.value < scrollSource.value.length
      : scrollOffset.value > 0;
    if (!canScroll) continue;

    const duration = calcAnimDuration();
    currentAnimMs.value = duration;

    await animateSingleScroll(entry.direction, duration);
  }

  // Queue empty — apply momentum
  await applyMomentum();

  isAnimating.value = false;
  currentSpeed.value = 0;
}

async function applyMomentum(): Promise<void> {
  let velocity = currentSpeed.value;

  while (velocity > NAV_SCROLL_MOMENTUM_THRESHOLD) {
    velocity *= NAV_SCROLL_MOMENTUM_FRICTION;

    const direction = lastScrollDirection.value;
    const canScroll = direction === 'down'
      ? scrollOffset.value + maxVisible.value < scrollSource.value.length
      : scrollOffset.value > 0;
    if (!canScroll) break;

    const duration = Math.max(NAV_SCROLL_MIN_ANIM_MS, Math.round(NAV_ANIM_MS / velocity));
    currentAnimMs.value = duration;

    await animateSingleScroll(direction, duration);
  }
}

function animateSingleScroll(direction: 'up' | 'down', totalMs: number): Promise<void> {
  const token = ++scrollCancelToken;
  const phase1Ms = Math.round(totalMs * 0.35);
  const phase2Ms = Math.round(totalMs * 0.55);

  scrollDirection.value = direction;

  return new Promise<void>((resolve) => {
    if (direction === 'down') {
      const topId = displayItems.value[0]?.id;
      const newItem = scrollSource.value[scrollOffset.value + maxVisible.value];
      if (!topId || !newItem) { resolve(); return; }

      scrollingTopId.value = topId;

      setTimeout(() => {
        if (token !== scrollCancelToken) { resolve(); return; }
        scrollingTopId.value = null;
        scrollingBottomId.value = newItem.id;
        displayItems.value = [...displayItems.value.slice(1), newItem];
        scrollOffset.value = scrollOffset.value + 1;

        setTimeout(() => {
          if (token !== scrollCancelToken) { resolve(); return; }
          scrollingBottomId.value = null;
          scrollDirection.value = null;
          displayItems.value = scrollSource.value.slice(
            scrollOffset.value,
            scrollOffset.value + maxVisible.value,
          );
          resolve();
        }, phase2Ms);
      }, phase1Ms);
    } else {
      const bottomId = displayItems.value[displayItems.value.length - 1]?.id;
      const newItem = scrollSource.value[scrollOffset.value - 1];
      if (!bottomId || !newItem) { resolve(); return; }

      scrollingBottomId.value = bottomId;

      setTimeout(() => {
        if (token !== scrollCancelToken) { resolve(); return; }
        scrollingBottomId.value = null;
        scrollingTopId.value = newItem.id;
        displayItems.value = [newItem, ...displayItems.value.slice(0, -1)];
        scrollOffset.value = scrollOffset.value - 1;

        setTimeout(() => {
          if (token !== scrollCancelToken) { resolve(); return; }
          scrollingTopId.value = null;
          scrollDirection.value = null;
          displayItems.value = scrollSource.value.slice(
            scrollOffset.value,
            scrollOffset.value + maxVisible.value,
          );
          resolve();
        }, phase2Ms);
      }, phase1Ms);
    }
  });
}

// --- resize observer ---
let ro: ResizeObserver | null = null;

function attachObserver(el: Element): void {
  ro?.disconnect();
  ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      containerH.value = entry.contentRect.height;
    }
  });
  ro.observe(el);
}

watch(nodeListRef, (inst) => {
  if (!inst) return;
  const el = inst && '$el' in inst ? (inst as ComponentPublicInstance).$el : inst;
  if (el instanceof HTMLElement) attachObserver(el);
});

onUnmounted(() => ro?.disconnect());
</script>

<style scoped>
.nav-shell {
  width: 100%;
  height: 100%;
  padding: 1px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.node-list {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.row {
  height: 54px;
  flex: 0 0 54px;
}

.row-glass,
.add-shell {
  width: 100%;
  height: 100%;
}

.row-glass :deep(.glass-raised) {
  box-shadow:
    4px 4px 8px var(--shadow-raised-a),
    -4px -4px 8px var(--shadow-raised-b);
}

.add-shell :deep(.glass-raised) {
  box-shadow:
    2px 2px 6px var(--shadow-raised-a),
    -2px -1px 4px var(--shadow-raised-b);
}

.row-glass :deep(.glass-pressed),
.add-shell :deep(.glass-pressed) {
  box-shadow: none;
}

.row-glass :deep(.glass-pressed) .row-name {
  filter: brightness(0.88);
  transform: translateY(1px);
  text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.18), 0 1px 0 rgba(255, 255, 255, 0.1);
}

.row-glass :deep(.glass-pressed) .official-content {
  background: transparent;
}

.row-content {
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 14px;
  transition: padding 220ms ease;
}

.row-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-primary);
  transition: opacity 160ms ease, filter 160ms ease, text-shadow 160ms ease;
}

.inline-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  width: 100%;
  height: 100%;
}

.action-half {
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: opacity 160ms ease, filter 160ms ease, text-shadow 160ms ease;
}

.add-shell {
  flex: 0 0 54px;
}

.add-shell :deep(.glass-content) {
  background: rgba(102, 255, 229, 0.12);
}

.add-button {
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
  transition: filter 160ms ease, text-shadow 160ms ease;
}
.empty {
  min-height: 54px;
}

.auth-tip-shell {
  flex: 1;
  min-height: 0;
}

.auth-tip-card {
  width: 100%;
  height: 100%;
}

.auth-tip {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  padding: 16px;
  text-align: center;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-primary);
  transition: filter 160ms ease, text-shadow 160ms ease;
}

/* TransitionGroup layout overrides: enter/move rows stay in flow and above leaving rows */
.cell-enter-active,
.cell-move {
  position: relative;
  z-index: 2;
}

/* TransitionGroup layout override: leaving row exits flow so others can fill its space */
.cell-leave-active {
  position: absolute;
  z-index: 1;
}

/* Upward scroll: entering row comes from above instead of below */
.scroll-dir-up .cell-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.97);
}

.none-enter-active,
.none-leave-active,
.none-move {
  transition: none !important;
}
.none-enter-from,
.none-leave-to {
  opacity: 1 !important;
  transform: none !important;
}

/* Official nodes */
.official-glass {
  width: 100%;
  height: 100%;
}

.official-glass :deep(.glass-raised) {
  box-shadow:
    4px 4px 8px var(--shadow-raised-a),
    -4px -4px 8px var(--shadow-raised-b);
}

.official-content {
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 14px;
  background: color-mix(in srgb, var(--color-hint) 12%, transparent);
}

.official-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-hint);
  transition: filter 160ms ease, text-shadow 160ms ease;
}

/* ================================================================
   Page navigation 4-phase animation (mirrors breadcrumbs)
   Must be at end of style section so these overrides win against
   equal-specificity .row-glass / .add-shell :deep() selectors above.
   ================================================================ */

/* Sunken state: persists from sinking through sliding-in */
.nav-sinking :deep(.glass-raised),
.nav-slide-out :deep(.glass-raised),
.nav-slide-in-prep :deep(.glass-raised),
.nav-slide-in :deep(.glass-raised) {
  box-shadow: none;
  border-color: rgba(255, 255, 255, 0.12);
}

.nav-sinking :deep(.glass-content),
.nav-slide-out :deep(.glass-content),
.nav-slide-in-prep :deep(.glass-content),
.nav-slide-in :deep(.glass-content) {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.nav-sinking :deep(.official-content),
.nav-slide-out :deep(.official-content),
.nav-slide-in-prep :deep(.official-content),
.nav-slide-in :deep(.official-content) {
  background: transparent;
}

/* Text darkening + depth text-shadow during nav sink/slide phases */
.nav-sinking :deep(.glass-content) .row-name,
.nav-sinking :deep(.glass-content) .action-half,
.nav-sinking :deep(.glass-content) .add-button,
.nav-sinking :deep(.glass-content) .official-name,
.nav-sinking :deep(.glass-content) .auth-tip,
.nav-slide-out :deep(.glass-content) .row-name,
.nav-slide-out :deep(.glass-content) .action-half,
.nav-slide-out :deep(.glass-content) .add-button,
.nav-slide-out :deep(.glass-content) .official-name,
.nav-slide-out :deep(.glass-content) .auth-tip,
.nav-slide-in-prep :deep(.glass-content) .row-name,
.nav-slide-in-prep :deep(.glass-content) .action-half,
.nav-slide-in-prep :deep(.glass-content) .add-button,
.nav-slide-in-prep :deep(.glass-content) .official-name,
.nav-slide-in-prep :deep(.glass-content) .auth-tip,
.nav-slide-in :deep(.glass-content) .row-name,
.nav-slide-in :deep(.glass-content) .action-half,
.nav-slide-in :deep(.glass-content) .add-button,
.nav-slide-in :deep(.glass-content) .official-name,
.nav-slide-in :deep(.glass-content) .auth-tip {
  filter: brightness(0.88);
  transform: translateY(1px);
  text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.18), 0 1px 0 rgba(255, 255, 255, 0.1);
}

/* Phase 2: Slide out left — node list moves left, fades out; add button stays in place */
.nav-slide-out .node-list {
  transform: translateX(-80px);
  opacity: 0;
  transition:
    transform 280ms cubic-bezier(0.4, 0, 0.6, 1),
    opacity 280ms ease;
}

/* Phase 3 prep: new content positioned left, no transition (forced by reflow in JS) */
.nav-slide-in-prep .node-list {
  transform: translateX(-80px);
  opacity: 0;
  transition: none;
}

/* Phase 3: Slide in from left */
.nav-slide-in .node-list {
  transform: translateX(0);
  opacity: 1;
  transition:
    transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
    opacity 280ms ease;
}

/* Phase 4: Rise — no explicit overrides needed.
   Removing sunken classes lets GlassWrapper's default transition
   animate back to the raised state naturally. */

/* Anchor official slides down from clicked position when clicking official node in small layout */
.anchor-prep {
  transform: translateY(calc(-1 * var(--anchor-delta-y, 0px)));
  opacity: 0;
  transition: none !important;
}
.anchor-prep :deep(.glass-content) {
  transform: translateY(calc(-1 * var(--anchor-delta-y, 0px)));
  opacity: 0;
  transition: none;
}

/* Anchor stays sunken during official transition phases */
.anchor-sinking {
  box-shadow: none !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
}
.anchor-sinking :deep(.glass-content) {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.anchor-sinking :deep(.glass-content) .official-name {
  filter: brightness(0.88);
  transform: translateY(1px);
  text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.18), 0 1px 0 rgba(255, 255, 255, 0.1);
}

/* Triggered by removing anchor-prep class after prep — glass transitions in */
.anchor-official-shell {
  transition: transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 280ms ease, box-shadow 240ms ease;
}
.anchor-official-shell :deep(.glass-content) {
  transition: transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 280ms ease;
}

/* ================================================================
   Official knowledge point click animation (small layout)
   ================================================================ */

/* Sunken state during official transition — all nav glass items flat */
.official-sunken :deep(.glass-raised),
.official-sliding :deep(.glass-raised) {
  box-shadow: none;
  border-color: rgba(255, 255, 255, 0.12);
}
.official-sunken :deep(.glass-content),
.official-sliding :deep(.glass-content) {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.official-sunken :deep(.official-content),
.official-sliding :deep(.official-content) {
  background: transparent;
}

/* Text darkening during official transition sink */
.official-sunken :deep(.glass-content) .row-name,
.official-sunken :deep(.glass-content) .action-half,
.official-sunken :deep(.glass-content) .add-button,
.official-sunken :deep(.glass-content) .official-name,
.official-sunken :deep(.glass-content) .auth-tip,
.official-sliding :deep(.glass-content) .row-name,
.official-sliding :deep(.glass-content) .action-half,
.official-sliding :deep(.glass-content) .add-button,
.official-sliding :deep(.glass-content) .official-name,
.official-sliding :deep(.glass-content) .auth-tip {
  filter: brightness(0.88);
  transform: translateY(1px);
  text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.18), 0 1px 0 rgba(255, 255, 255, 0.1);
}

/* Phase 2: non-clicked rows slide left, clicked row stays visible */
.official-sliding .row:not(.clicked-target) {
  transform: translateX(-80px);
  opacity: 0;
  transition: transform 280ms cubic-bezier(0.4, 0, 0.6, 1), opacity 280ms ease;
}
.official-sliding .row.clicked-target {
  transform: none;
  opacity: 1;
}
</style>
