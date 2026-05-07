<template>
  <div v-if="isTooSmall" class="insufficient-space">
    <p>{{ UI.app.insufficientSpace }}</p>
  </div>
  <main v-else class="layout" :class="layoutClasses">
    <section ref="logoRef" class="logo-area">
      <div class="inset-shell static-shell">
        <LogoArea />
      </div>
    </section>

    <section ref="breadcrumbsRef" class="breadcrumbs-area">
      <div class="inset-shell static-shell">
        <Breadcrumbs />
      </div>
    </section>

    <section class="merged-area">
      <div class="merged-shell inset-shell static-shell">
        <section ref="navigationRef" class="navigation-area">
          <div class="inset-shell static-shell navigation-shell">
            <Navigation />
          </div>
        </section>

        <section ref="contentRef" class="content-area">
          <div class="inset-shell static-shell content-shell">
            <GlassWrapper class="content-surface">
              <template v-if="!isFeaturePanel">
                <div v-if="showTree" key="tree" class="content-host">
                  <TreeCanvas :visible="showTree" />
                </div>
                <Transition v-if="!showTree" name="content-rise" mode="out-in">
                  <component :is="nonTreeContent" :key="contentKey" class="content-host" />
                </Transition>
              </template>
              <Transition name="feature-panel" mode="out-in">
                <FeaturePanel v-if="isFeaturePanel" key="feature" class="feature-host" />
              </Transition>
            </GlassWrapper>
          </div>
        </section>
      </div>
    </section>

  <section ref="knobRef" class="knob-area">
      <Knob />
    </section>

    <AiGeneratePopup v-if="isAuthenticated" />
  </main>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { storeToRefs } from 'pinia';
import LogoArea from '../components/layout/LogoArea.vue';
import GlassWrapper from '../components/ui/GlassWrapper.vue';
import Breadcrumbs from '../components/layout/Breadcrumbs.vue';
import Navigation from '../components/layout/Navigation.vue';
import Knob from '../components/layout/Knob.vue';
import ConfirmPanel from '../components/ui/ConfirmPanel.vue';
import FeaturePanel from '../components/ui/FeaturePanel.vue';
import GlobalTree from '../components/tree/GlobalTree.vue';
import TreeCanvas from '../components/tree/TreeCanvas.vue';
import MarkdownEditor from '../components/editor/MarkdownEditor.vue';
import AuthPanel from '../components/auth/AuthPanel.vue';
import AiGeneratePopup from '../components/ai/AiGeneratePopup.vue';
import QuizPanel from '../components/quiz/QuizPanel.vue';
import QuizHistoryPanel from '../components/quiz/QuizHistoryPanel.vue';
import StatsPanel from '../components/stats/StatsPanel.vue';
import ReviewPanel from '../components/review/ReviewPanel.vue';
import { useNodeStore } from '../stores/nodeStore';
import { useAuthStore } from '../stores/authStore';
import { useAppInit } from '../composables/useAppInit';
import { useKnobDispatch } from '../composables/useKnobDispatch';
import { usePageTransition } from '../composables/usePageTransition';
import { COMPACT_BREAKPOINT, COMPACT_HEIGHT_BREAKPOINT, MIN_SPACE_WIDTH, MIN_SPACE_HEIGHT } from '../constants/app';
import { UI } from '../constants/uiStrings';

const nodeStore = useNodeStore();
const authStore = useAuthStore();
const { activeNode } = storeToRefs(nodeStore);
const {
  mode: authMode,
  isAuthenticated,
} = storeToRefs(authStore);

useAppInit();
const { isLoggingOut, isFeaturePanel, compactMode, isCompactLayout, closeFeaturePanel } = useKnobDispatch();

const { registerRegion, unregisterRegion, startTransition } = usePageTransition();

// Region refs for page transition system
const logoRef = ref<HTMLElement | null>(null);
const breadcrumbsRef = ref<HTMLElement | null>(null);
const navigationRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const knobRef = ref<HTMLElement | null>(null);

// Compact layout tracking
const isCompact = ref(false);
const isTooSmall = ref(false);

// Debounce utility
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timeoutId: number | null = null;
  return ((...args: any[]) => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  }) as T;
}

function updateCompactState(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;

  isTooSmall.value = w <= MIN_SPACE_WIDTH && h <= MIN_SPACE_HEIGHT;
  const wasCompact = isCompact.value;
  isCompact.value = w <= COMPACT_BREAKPOINT || h <= COMPACT_HEIGHT_BREAKPOINT;
  isCompactLayout.value = isCompact.value;

  // Trigger transition if layout changed
  if (wasCompact !== isCompact.value) {
    const layout = isCompact.value ? 'small' : 'large';
    startTransition({ type: 'layout', newLayout: layout }, layout);
  }

  if (!isCompact.value) {
    compactMode.value = 'content';
    if (isFeaturePanel.value) {
      closeFeaturePanel();
    }
  } else if (isFeaturePanel.value) {
    compactMode.value = 'feature';
  }
}

const handleResize = debounce(updateCompactState, 150);

onMounted(() => {
  updateCompactState();
  window.addEventListener('resize', handleResize);

  // Register all main regions with the page transition system
  if (logoRef.value) {
    registerRegion({
      id: 'logo',
      type: 'inset',
      element: logoRef,
      shouldShow: (state) => {
        // Logo is hidden in compact-nav and compact-feature modes
        if (state.layout === 'small') {
          return state.compactMode === 'content';
        }
        return true;
      },
    });
  }

  if (breadcrumbsRef.value) {
    registerRegion({
      id: 'breadcrumbs',
      type: 'inset',
      element: breadcrumbsRef,
      shouldShow: (state) => {
        // Breadcrumbs are hidden in compact-content and compact-feature modes
        if (state.layout === 'small') {
          return state.compactMode === 'nav';
        }
        return true;
      },
    });
  }

  if (navigationRef.value) {
    registerRegion({
      id: 'navigation',
      type: 'inset',
      element: navigationRef,
      shouldShow: (state) => {
        // Navigation is hidden in compact-content and compact-feature modes
        if (state.layout === 'small') {
          return state.compactMode === 'nav';
        }
        return true;
      },
    });
  }

  if (contentRef.value) {
    registerRegion({
      id: 'content',
      type: 'glass',
      element: contentRef,
      shouldShow: () => {
        // Content is always visible in all modes
        return true;
      },
    });
  }

  if (knobRef.value) {
    registerRegion({
      id: 'knob',
      type: 'inset', // 旋钮区域不参与玻璃动画，保持静止
      element: knobRef,
      shouldShow: () => {
        // Knob is always visible
        return true;
      },
    });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);

  // Unregister all regions
  unregisterRegion('logo');
  unregisterRegion('breadcrumbs');
  unregisterRegion('navigation');
  unregisterRegion('content');
  unregisterRegion('knob');
});

watch(isFeaturePanel, (open) => {
  if (isCompact.value && open && compactMode.value !== 'feature') {
    compactMode.value = 'feature';
  }
});

const layoutClasses = computed(() => ({
  'compact': isCompact.value,
  'compact-content': isCompact.value && compactMode.value === 'content',
  'compact-nav': isCompact.value && compactMode.value === 'nav',
  'compact-feature': isCompact.value && compactMode.value === 'feature',
  'is-too-small': isTooSmall.value,
}));

const showTree = computed(() => {
  return isAuthenticated.value && !activeNode.value && !nodeStore.isConfirmState && !isLoggingOut.value && !isFeaturePanel.value && !nodeStore.isQuizState && !nodeStore.isQuizHistoryState && !nodeStore.isStatsState && !nodeStore.isReviewState;
});

const nonTreeContent = computed(() => {
  if (!isAuthenticated.value) {
    return AuthPanel;
  }
  if (nodeStore.isTreeState) {
    return GlobalTree;
  }
  if (nodeStore.isConfirmState || isLoggingOut.value) {
    return ConfirmPanel;
  }
  if (nodeStore.isQuizState) {
    return QuizPanel;
  }
  if (nodeStore.isQuizHistoryState) {
    return QuizHistoryPanel;
  }
  if (nodeStore.isStatsState) {
    return StatsPanel;
  }
  if (nodeStore.isReviewState) {
    return ReviewPanel;
  }
  return MarkdownEditor;
});

const contentKey = computed(() => {
  if (!isAuthenticated.value) {
    return `auth:${authMode.value}`;
  }
  const state = isLoggingOut.value ? 'logout' : nodeStore.viewState;
  return `${state}:${activeNode.value?.id ?? 'editor'}`;
});

</script>

<style scoped>
.insufficient-space {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
  text-align: center;
  color: var(--color-primary);
  font-size: 16px;
  font-weight: 600;
}

.layout {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  padding: 38px;
  display: grid;
  grid-template-columns: 241px minmax(0, 1fr) 82px;
  grid-template-rows: 54px minmax(0, 1fr);
  gap: 12px;
}

.logo-area,
.breadcrumbs-area,
.merged-area,
.navigation-area,
.content-area,
.knob-area {
  min-width: 0;
  min-height: 0;
}

.merged-area,
.merged-shell {
  display: contents;
}

.logo-area {
  grid-column: 1;
  grid-row: 1;
}

.breadcrumbs-area {
  grid-column: 2;
  grid-row: 1;
  position: relative;
}

.navigation-area {
  grid-column: 1;
  grid-row: 2;
  position: relative;
}

.content-area {
  grid-column: 2;
  grid-row: 2;
  position: relative;
}

.knob-area {
  grid-column: 3;
  grid-row: 1 / span 2;
  align-self: stretch;
  justify-self: stretch;
  position: relative;
}

.inset-shell {
  width: 100%;
  height: 100%;
  padding: 1px;
  border-radius: 24px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.06);
  box-shadow:
    inset 9px 9px 18px var(--shadow-inset-a),
    inset -9px -9px 18px var(--shadow-inset-b);
  overflow: hidden;
}

/* 去除导航右边缘和内容左边缘的 inset shadow，避免间隙处阴影叠加 */
.navigation-shell {
  box-shadow:
    inset 0 9px 18px var(--shadow-inset-a),
    inset 9px 0 18px var(--shadow-inset-a),
    inset 0 -9px 18px var(--shadow-inset-b);
}

.content-shell {
  box-shadow:
    inset 0 9px 18px var(--shadow-inset-a),
    inset 0 -9px 18px var(--shadow-inset-b),
    inset -9px 0 18px var(--shadow-inset-b);
}

/* 导航区 z-index 高于内容区，防止 outset shadow 覆盖导航边缘 */
.navigation-area { z-index: 2; }
.content-area { z-index: 1; }

.static-shell {
  min-width: 0;
  min-height: 0;
}

.content-host {
  width: 100%;
  height: 100%;
  overflow: auto;
}

.content-surface {
  width: 100%;
  height: 100%;
}

.feature-host {
  width: 100%;
  height: 100%;
}

.content-rise-enter-active {
  transition:
    opacity 300ms ease,
    transform 400ms cubic-bezier(0.22, 1, 0.36, 1);
}

.content-rise-leave-active {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}

.content-rise-enter-from {
  opacity: 0;
  transform: translateY(24px) scale(0.97);
}

.content-rise-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.99);
}

.feature-panel-enter-active {
  transition: opacity 300ms ease, transform 300ms cubic-bezier(0.22, 1, 0.36, 1);
}

.feature-panel-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}

.feature-panel-enter-from {
  opacity: 0;
  transform: scale(0.95);
}

.feature-panel-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

@keyframes glass-rise {
  from {
    opacity: 0;
    transform: translateY(24px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.is-rising .content-area :deep(.content-surface) {
  animation: glass-rise 400ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.is-rising .knob-area :deep(.knob-well) {
  animation: glass-rise 400ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: 100ms;
}

@media (max-width: 900px) {
  .layout {
    padding: 16px;
    grid-template-columns: 241px minmax(0, 1fr);
    grid-template-rows: 54px minmax(0, 1fr) 100px;
    row-gap: 10px;
    column-gap: 10px;
  }

  .logo-area {
    grid-column: 1;
    grid-row: 1;
  }

  .breadcrumbs-area {
    grid-column: 2;
    grid-row: 1;
  }

  .merged-area {
    display: block;
    grid-column: 1 / span 2;
    grid-row: 2;
    min-width: 0;
    min-height: 0;
  }

  .merged-shell {
    display: grid;
    width: 100%;
    height: 100%;
    grid-template-columns: 241px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    column-gap: 0;
    row-gap: 0;
  }

  .navigation-shell,
  .content-shell {
    display: contents;
    border: none;
    background: transparent;
    box-shadow: none;
    overflow: visible;
    padding: 0;
  }

  .navigation-area {
    grid-column: 1;
    grid-row: 1;
  }

  .content-area {
    grid-column: 2;
    grid-row: 1;
  }

  .knob-area {
    grid-column: 1 / span 2;
    grid-row: 3;
    justify-self: center;
    width: min(100%, 260px);
  }
}

@media (max-width: 600px) {
  .layout {
    position: absolute;
    inset: 0;
    padding: 8px;
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .merged-area,
  .merged-shell {
    display: contents !important;
  }

  .navigation-shell,
  .content-shell {
    display: contents !important;
  }

  /* Compact content mode: content + knob */
  .layout.compact-content {
    grid-template-rows: minmax(0, 1fr) 90px;
  }

  .layout.compact-content .logo-area,
  .layout.compact-content .breadcrumbs-area,
  .layout.compact-content .navigation-area {
    display: none;
  }

  .layout.compact-content .content-area {
    grid-column: 1;
    grid-row: 1;
  }

  .layout.compact-content .knob-area {
    grid-column: 1;
    grid-row: 2;
    justify-self: center;
    width: min(100%, 260px);
  }

  /* Compact nav mode: breadcrumbs + navigation + knob */
  .layout.compact-nav {
    grid-template-rows: 54px minmax(0, 1fr) 90px;
  }

  .layout.compact-nav .logo-area,
  .layout.compact-nav .content-area {
    display: none;
  }

  .layout.compact-nav .breadcrumbs-area {
    grid-column: 1;
    grid-row: 1;
  }

  .layout.compact-nav .navigation-area {
    grid-column: 1;
    grid-row: 2;
  }

  .layout.compact-nav .knob-area {
    grid-column: 1;
    grid-row: 3;
    justify-self: center;
    width: min(100%, 260px);
  }

  /* Compact feature mode: feature panel + knob */
  .layout.compact-feature {
    grid-template-rows: minmax(0, 1fr) 90px;
  }

  .layout.compact-feature .logo-area,
  .layout.compact-feature .breadcrumbs-area,
  .layout.compact-feature .navigation-area {
    display: none;
  }

  .layout.compact-feature .content-area {
    grid-column: 1;
    grid-row: 1;
  }

  .layout.compact-feature .knob-area {
    grid-column: 1;
    grid-row: 2;
    justify-self: center;
    width: min(100%, 260px);
  }
}
</style>
