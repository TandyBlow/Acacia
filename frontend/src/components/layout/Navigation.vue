<template>
  <div class="nav-shell">
    <template v-if="isAuthenticated">
      <TransitionGroup
        ref="nodeListRef"
        :name="transitionName"
        :style="{ '--nav-anim-ms': `${currentAnimMs}ms` }"
        tag="div"
        class="node-list"
        :class="{ 'scroll-dir-up': scrollDirection === 'up' }"
        @before-leave="onBeforeLeave"
        @wheel.prevent="onWheel"
        @touchstart.passive="onTouchStart"
        @touchend="onTouchEnd"
      >
        <div v-if="childNodes.length === 0" key="empty" class="empty" />

        <div v-for="node in displayNodes" :key="node.id" class="row">
          <GlassWrapper
            class="row-glass"
            interactive
            :pressed="pressedNodeId === node.id || scrollingTopId === node.id || scrollingBottomId === node.id"
            @click="onRowClick(node.id)"
            @contextmenu.prevent="onContextMenu(node.id)"
          >
            <div class="row-content">
              <template v-if="actionNodeId !== node.id">
                <span class="row-name">{{ node.name }}</span>
              </template>
              <template v-else>
                <div class="inline-actions">
                  <button type="button" class="action-half" @click.stop="moveNode(node)">{{ UI.nav.move }}</button>
                  <button type="button" class="action-half" @click.stop="deleteNode(node)">{{ UI.nav.delete }}</button>
                </div>
              </template>
            </div>
          </GlassWrapper>
        </div>
      </TransitionGroup>

      <GlassWrapper class="add-shell" interactive :pressed="addPressed" @click="onAddClick">
        <button type="button" class="add-button">
          {{ UI.nav.addNode }}
        </button>
      </GlassWrapper>

    </template>

    <div v-else class="auth-tip-shell">
      <GlassWrapper class="auth-tip-card">
        <div class="auth-tip">{{ UI.nav.authTip }}</div>
      </GlassWrapper>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, type ComponentPublicInstance } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useAuthStore } from '../../stores/authStore';
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

const store = useNodeStore();
const authStore = useAuthStore();
const { childNodes } = storeToRefs(store);
const { isAuthenticated } = storeToRefs(authStore);

// --- scroll state ---
const nodeListRef = ref<ComponentPublicInstance | HTMLElement | null>(null);
const containerH = ref(0);
const scrollOffset = ref(0);
const isAnimating = ref(false);
const displayNodes = ref<NodeRecord[]>([]);
const scrollingTopId = ref<string | null>(null);
const scrollingBottomId = ref<string | null>(null);
const scrollDirection = ref<'up' | 'down' | null>(null);
const transitionName = ref('nav-row');

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
  return Math.floor(containerH.value / ROW_STEP);
});

// Calculate animation duration based on current speed
function calcAnimDuration(): number {
  const speed = currentSpeed.value;
  if (speed <= 0) return NAV_ANIM_MS;
  const clampedSpeed = Math.max(1, Math.min(speed, 12));
  const duration = NAV_SCROLL_MAX_ANIM_MS - (clampedSpeed - 1) * (NAV_SCROLL_MAX_ANIM_MS - NAV_SCROLL_MIN_ANIM_MS) / 11;
  return Math.round(duration);
}

// [Bug2 fix] reset when child nodes change — cancel any in-flight scroll
watch(childNodes, (list) => {
  scrollCancelToken++;
  scrollQueue.value = [];
  isAnimating.value = false;
  scrollOffset.value = 0;
  scrollingTopId.value = null;
  scrollingBottomId.value = null;
  scrollDirection.value = null;
  currentSpeed.value = 0;
  currentAnimMs.value = NAV_ANIM_MS;
  displayNodes.value = list.slice(0, maxVisible.value);
  transitionName.value = 'nav-rise';
  nextTick(() => { transitionName.value = 'nav-row'; });
}, { immediate: true });

// [Bug4 fix] update visible window when container resizes
watch(maxVisible, (mv) => {
  if (!isAnimating.value) {
    displayNodes.value = childNodes.value.slice(scrollOffset.value, scrollOffset.value + mv);
  }
});

// --- interaction state ---
const actionNodeId = ref<string | null>(null);
const addPressed = computed(() => store.viewState === 'add');
const pressedNodeId = ref<string | null>(null);

function onRowClick(nodeId: string): void {
  if (isAnimating.value) return;
  if (actionNodeId.value === nodeId) return;
  openNode(nodeId);
}

function onContextMenu(nodeId: string): void {
  if (isAnimating.value) return;
  toggleActions(nodeId);
}

function openNode(nodeId: string): void {
  if (pressedNodeId.value) return;
  actionNodeId.value = null;
  pressedNodeId.value = nodeId;
  transitionName.value = 'none';
  setTimeout(async () => {
    await store.loadNode(nodeId);
    pressedNodeId.value = null;
  }, 200);
}

function onAddClick(): void {
  if (addPressed.value) {
    store.cancelOperation();
    return;
  }
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

  if (scrollQueue.value.length < 20) {
    scrollQueue.value.push({ direction });
  }

  if (!isAnimating.value) {
    processScrollQueue();
  }
}

let touchY = 0;
function onTouchStart(e: TouchEvent): void {
  if (e.touches[0]) touchY = e.touches[0].clientY;
}
function onTouchEnd(e: TouchEvent): void {
  if (!e.changedTouches[0]) return;
  const dy = touchY - e.changedTouches[0].clientY;
  if (Math.abs(dy) < 30) return;

  const direction: 'up' | 'down' = dy > 0 ? 'down' : 'up';
  scrollQueue.value.push({ direction });
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
      ? scrollOffset.value + maxVisible.value < childNodes.value.length
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
      ? scrollOffset.value + maxVisible.value < childNodes.value.length
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
      const topId = displayNodes.value[0]?.id;
      const newNode = childNodes.value[scrollOffset.value + maxVisible.value];
      if (!topId || !newNode) { resolve(); return; }

      scrollingTopId.value = topId;

      setTimeout(() => {
        if (token !== scrollCancelToken) { resolve(); return; }
        scrollingTopId.value = null;
        scrollingBottomId.value = newNode.id;
        displayNodes.value = [...displayNodes.value.slice(1), newNode];
        scrollOffset.value = scrollOffset.value + 1;

        setTimeout(() => {
          if (token !== scrollCancelToken) { resolve(); return; }
          scrollingBottomId.value = null;
          scrollDirection.value = null;
          displayNodes.value = childNodes.value.slice(
            scrollOffset.value,
            scrollOffset.value + maxVisible.value,
          );
          resolve();
        }, phase2Ms);
      }, phase1Ms);
    } else {
      const bottomId = displayNodes.value[displayNodes.value.length - 1]?.id;
      const newNode = childNodes.value[scrollOffset.value - 1];
      if (!bottomId || !newNode) { resolve(); return; }

      scrollingBottomId.value = bottomId;

      setTimeout(() => {
        if (token !== scrollCancelToken) { resolve(); return; }
        scrollingBottomId.value = null;
        scrollingTopId.value = newNode.id;
        displayNodes.value = [newNode, ...displayNodes.value.slice(0, -1)];
        scrollOffset.value = scrollOffset.value - 1;

        setTimeout(() => {
          if (token !== scrollCancelToken) { resolve(); return; }
          scrollingTopId.value = null;
          scrollDirection.value = null;
          displayNodes.value = childNodes.value.slice(
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
  filter: brightness(0.82);
  text-shadow: 0 2px 2px rgba(0, 0, 0, 0.12);
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
  transition: opacity 160ms ease;
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
}

.nav-row-enter-active,
.nav-row-move {
  transition:
    opacity var(--nav-anim-ms, 240ms) ease,
    transform var(--nav-anim-ms, 240ms) ease;
}

.nav-row-leave-active {
  position: absolute;
  transition:
    opacity var(--nav-anim-ms, 240ms) ease;
}

.nav-row-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.97);
}

.nav-row-leave-to {
  opacity: 0;
}

.scroll-dir-up .nav-row-enter-from {
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

.nav-rise-enter-active {
  transition:
    opacity 400ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 400ms cubic-bezier(0.22, 1, 0.36, 1);
}

.nav-rise-leave-active {
  transition: opacity 200ms ease;
}

.nav-rise-enter-from {
  opacity: 0;
  transform: translateY(24px) scale(0.97);
}

.nav-rise-leave-to {
  opacity: 0;
}
</style>
