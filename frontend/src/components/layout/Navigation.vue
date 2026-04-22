<template>
  <div class="nav-shell">
    <template v-if="isAuthenticated">
      <TransitionGroup
        ref="nodeListRef"
        :name="transitionName"
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
import { ref, computed, watch, nextTick, onUnmounted, type ComponentPublicInstance } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { useNodeStore } from '../../stores/nodeStore';
import { useAuthStore } from '../../stores/authStore';
import type { NodeRecord } from '../../types/node';
import { NAV_ROW_H, NAV_ROW_GAP, NAV_ANIM_MS } from '../../constants/app';
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
const isScrolling = ref(false);
const displayNodes = ref<NodeRecord[]>([]);
const scrollingTopId = ref<string | null>(null);
const scrollingBottomId = ref<string | null>(null);
const scrollDirection = ref<'up' | 'down' | null>(null);
const transitionName = ref('nav-row');

// [Bug3 fix] cancel token to invalidate stale scroll callbacks
let scrollCancelToken = 0;

const maxVisible = computed(() => {
  if (containerH.value <= 0) return 20;
  return Math.floor(containerH.value / ROW_STEP);
});

// [Bug2 fix] reset when child nodes change — cancel any in-flight scroll
watch(childNodes, (list) => {
  scrollCancelToken++;
  isScrolling.value = false;
  scrollOffset.value = 0;
  scrollingTopId.value = null;
  scrollingBottomId.value = null;
  scrollDirection.value = null;
  displayNodes.value = list.slice(0, maxVisible.value);
  if (transitionName.value === 'none') {
    nextTick(() => { transitionName.value = 'nav-row'; });
  }
}, { immediate: true });

// [Bug4 fix] update visible window when container resizes
watch(maxVisible, (mv) => {
  if (!isScrolling.value) {
    displayNodes.value = childNodes.value.slice(scrollOffset.value, scrollOffset.value + mv);
  }
});

// --- interaction state ---
const actionNodeId = ref<string | null>(null);
const addPressed = computed(() => store.viewState === 'add');
const pressedNodeId = ref<string | null>(null);

function onRowClick(nodeId: string): void {
  if (isScrolling.value) return;
  if (actionNodeId.value === nodeId) return;
  openNode(nodeId);
}

function onContextMenu(nodeId: string): void {
  if (isScrolling.value) return;
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

async function moveNode(node: NodeRecord): Promise<void> {
  actionNodeId.value = null;
  await store.startMove(node);
}

async function deleteNode(node: NodeRecord): Promise<void> {
  actionNodeId.value = null;
  await store.startDelete(node);
}

// --- custom scroll ---
function onWheel(e: WheelEvent): void {
  if (isScrolling.value) return;
  if (e.deltaY > 0) scrollDown();
  else if (e.deltaY < 0) scrollUp();
}

let touchY = 0;
function onTouchStart(e: TouchEvent): void {
  if (e.touches[0]) touchY = e.touches[0].clientY;
}
function onTouchEnd(e: TouchEvent): void {
  if (!e.changedTouches[0]) return;
  const dy = touchY - e.changedTouches[0].clientY;
  if (Math.abs(dy) < 30 || isScrolling.value) return;
  if (dy > 0) scrollDown();
  else scrollUp();
}

function scrollDown(): void {
  const mv = maxVisible.value;
  const off = scrollOffset.value;
  if (off + mv >= childNodes.value.length) return;

  isScrolling.value = true;
  scrollDirection.value = 'down';
  const token = ++scrollCancelToken;
  const topId = displayNodes.value[0]!.id;
  const newNode = childNodes.value[off + mv];
  if (!newNode) { isScrolling.value = false; return; }

  // 阶段1: 顶部凹陷
  scrollingTopId.value = topId;

  setTimeout(() => {
    if (token !== scrollCancelToken) return;
    // 阶段2: 顶行消失 + 其他行上移 + 底部新行凹陷进入
    scrollingTopId.value = null;
    scrollingBottomId.value = newNode.id;
    displayNodes.value = [...displayNodes.value.slice(1), newNode];
    scrollOffset.value = off + 1;

    setTimeout(() => {
      if (token !== scrollCancelToken) return;
      // 阶段3: 底部浮起
      scrollingBottomId.value = null;
      isScrolling.value = false;
      scrollDirection.value = null;
      displayNodes.value = childNodes.value.slice(
        scrollOffset.value,
        scrollOffset.value + maxVisible.value,
      );
    }, NAV_ANIM_MS + 60);
  }, 180);
}

function scrollUp(): void {
  const off = scrollOffset.value;
  if (off <= 0) return;

  isScrolling.value = true;
  scrollDirection.value = 'up';
  const token = ++scrollCancelToken;
  const bottomId = displayNodes.value[displayNodes.value.length - 1]!.id;
  const newNode = childNodes.value[off - 1];
  if (!newNode) { isScrolling.value = false; return; }

  // 阶段1: 底部凹陷
  scrollingBottomId.value = bottomId;

  setTimeout(() => {
    if (token !== scrollCancelToken) return;
    // 阶段2: 底行消失 + 其他行下移 + 顶部新行凹陷进入
    scrollingBottomId.value = null;
    scrollingTopId.value = newNode.id;
    displayNodes.value = [newNode, ...displayNodes.value.slice(0, -1)];
    scrollOffset.value = off - 1;

    setTimeout(() => {
      if (token !== scrollCancelToken) return;
      // 阶段3: 顶部浮起
      scrollingTopId.value = null;
      isScrolling.value = false;
      scrollDirection.value = null;
      displayNodes.value = childNodes.value.slice(
        scrollOffset.value,
        scrollOffset.value + maxVisible.value,
      );
    }, NAV_ANIM_MS + 60);
  }, 180);
}

// --- resize observer ---
// [Bug1 fix] use watch instead of onMounted to handle conditional rendering
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

.row-glass :deep(.glass-raised),
.add-shell :deep(.glass-raised) {
  box-shadow:
    4px 4px 8px var(--shadow-raised-a),
    -4px -4px 8px var(--shadow-raised-b);
}

.row-glass :deep(.glass-pressed),
.add-shell :deep(.glass-pressed) {
  box-shadow: none;
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
  transition: opacity 160ms ease;
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
}.empty {
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
    opacity 240ms ease,
    transform 240ms ease;
}

.nav-row-leave-active {
  position: absolute;
  transition:
    opacity 120ms ease;
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
</style>
