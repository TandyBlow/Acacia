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

        <section class="content-area">
          <div class="content-inset" :class="{ 'tree-visible': treeOverlayActive }">
            <div ref="treeMaskRef" class="tree-mask" :class="{ 'tree-mask-visible': treeMaskVisible }" aria-hidden="true"></div>
            <div ref="contentGlassRef" class="content-glass" :class="{
              'content-sinking': contentPhase === 'sinking',
              'content-slide-out': contentPhase === 'slide-out',
              'content-slide-in-prep': contentPhase === 'slide-in-prep',
              'content-slide-in': contentPhase === 'slide-in',
              'content-rising': contentPhase === 'rising',
            }">
              <div class="glass-content" style="width:100%;height:100%">
                <div v-if="displayedShowTree" key="tree" class="content-host">
                  <TreeCanvas ref="treeCanvasRef" :visible="displayedShowTree" />
                </div>
                <template v-if="!displayedShowTree">
                  <component
                    v-if="displayedNonTreeContent === MarkdownEditor"
                    :is="displayedNonTreeContent"
                    :key="displayedKey"
                  />
                  <div v-else class="activity-layout">
                    <div class="activity-glass-host">
                      <GlassWrapper>
                        <div class="activity-scroll">
                          <component :is="displayedNonTreeContent" :key="displayedKey" />
                        </div>
                      </GlassWrapper>
                    </div>
                  </div>
                </template>
              </div>
              <div ref="treeCurtainRef" class="tree-curtain" :class="{ drawn: treeCurtainDrawn }" aria-hidden="true"></div>
            </div>
          </div>
        </section>
      </div>
    </section>

    <section ref="knobRef" class="knob-area">
      <Knob />
    </section>

    <DevPanel v-if="isDev" />
  </main>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import LogoArea from '../components/layout/LogoArea.vue';
import Breadcrumbs from '../components/layout/Breadcrumbs.vue';
import Navigation from '../components/layout/Navigation.vue';
import Knob from '../components/layout/Knob.vue';
import ConfirmPanel from '../components/ui/ConfirmPanel.vue';
import GlassWrapper from '../components/ui/GlassWrapper.vue';
import GlobalTree from '../components/tree/GlobalTree.vue';
import TreeCanvas from '../components/tree/TreeCanvas.vue';
import MarkdownEditor from '../components/editor/MarkdownEditor.vue';
import AuthPanel from '../components/auth/AuthPanel.vue';
import DailyQuizPanel from '../components/official/DailyQuizPanel.vue';
import WelcomePanel from '../components/official/WelcomePanel.vue';
import DevPanel from '../components/dev/DevPanel.vue';
import { useNodeStore } from '../stores/nodeStore';
import { useAuthStore } from '../stores/authStore';
import { useDevStore } from '../stores/devStore';
import { useAppInit } from '../composables/useAppInit';
import { useKnobDispatch } from '../composables/useKnobDispatch';
import { usePageTransition } from '../composables/usePageTransition';
import { COMPACT_BREAKPOINT, COMPACT_HEIGHT_BREAKPOINT, MIN_SPACE_WIDTH, MIN_SPACE_HEIGHT } from '../constants/app';
import { UI } from '../constants/uiStrings';

const isDev = import.meta.env.DEV;

const nodeStore = useNodeStore();
const authStore = useAuthStore();
const devStore = useDevStore();
const { activeNode } = storeToRefs(nodeStore);
const {
  mode: authMode,
  isAuthenticated,
} = storeToRefs(authStore);

useAppInit();
const { compactMode, isCompactLayout } = useKnobDispatch();

const { registerRegion, unregisterRegion, startTransition, currentPhase } = usePageTransition();

// Region refs for page transition system
const logoRef = ref<HTMLElement | null>(null);
const breadcrumbsRef = ref<HTMLElement | null>(null);
const navigationRef = ref<HTMLElement | null>(null);
const contentGlassRef = ref<HTMLElement | null>(null);
const knobRef = ref<HTMLElement | null>(null);

// Tree curtain
const treeCurtainDrawn = ref(false);
const treeCurtainRef = ref<HTMLElement | null>(null);
const treeCanvasRef = ref<{ sceneReady: boolean } | null>(null);

// Tree mask
const treeMaskVisible = ref(false);
const treeOverlayActive = ref(false);
const treeMaskRef = ref<HTMLElement | null>(null);

// Compact layout tracking
const isCompact = ref(false);
const isTooSmall = ref(false);

// Content slide animation
const CONTENT_SINK_MS = 240;
const CONTENT_SLIDE_MS = 280;
const CONTENT_RISE_MS = 240;
const TREE_MASK_FADE_MS = 380;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForSceneReady(token: number): Promise<void> {
  return new Promise((resolve) => {
    if (treeCanvasRef.value?.sceneReady && !devStore.manualSceneReady) {
      resolve();
      return;
    }

    // Notify DevPanel we're waiting
    window.dispatchEvent(new CustomEvent('dev-waiting-for-scene'));

    // In manual mode, wait for dev-scene-ready event
    if (devStore.manualSceneReady) {
      const onManualReady = () => {
        console.log('[waitForSceneReady] dev-scene-ready received!');
        window.removeEventListener('dev-scene-ready', onManualReady);
        resolve();
      };
      window.addEventListener('dev-scene-ready', onManualReady);

      const checkCancel = watch(
        () => contentAnimToken,
        (currentToken) => {
          if (currentToken !== token) {
            checkCancel();
            window.removeEventListener('dev-scene-ready', onManualReady);
            resolve();
          }
        },
      );
      return;
    }

    // Auto mode: watch sceneReady
    const stop = watch(
      () => treeCanvasRef.value?.sceneReady,
      (ready) => {
        if (ready) {
          stop();
          resolve();
        }
      },
    );
    const checkCancel = watch(
      () => contentAnimToken,
      (currentToken) => {
        if (currentToken !== token) {
          stop();
          checkCancel();
          resolve();
        }
      },
    );
  });
}

const contentPhase = ref('idle');
let contentAnimToken = 0;
const contentAnimating = ref(false);

const displayedKey = ref('');
const displayedShowTree = ref(false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const displayedNonTreeContent = ref<any>(MarkdownEditor);

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

  if (wasCompact !== isCompact.value) {
    const layout = isCompact.value ? 'small' : 'large';
    startTransition({ type: 'layout', newLayout: layout }, layout);
  }

  if (!isCompact.value) {
    compactMode.value = 'content';
  }
}

const handleResize = debounce(updateCompactState, 150);

onMounted(() => {
  updateCompactState();
  window.addEventListener('resize', handleResize);

  if (logoRef.value) {
    registerRegion({
      id: 'logo',
      type: 'inset',
      element: logoRef,
      shouldShow: (state) => {
        return state.layout !== 'small';
      },
    });
  }

  if (breadcrumbsRef.value) {
    registerRegion({
      id: 'breadcrumbs',
      type: 'inset',
      element: breadcrumbsRef,
      shouldShow: () => true,
      skipGlobalTransition: true,
    });
  }

  if (navigationRef.value) {
    registerRegion({
      id: 'navigation',
      type: 'inset',
      element: navigationRef,
      shouldShow: (state) => {
        if (state.layout === 'small') {
          return state.compactMode === 'nav';
        }
        return true;
      },
      skipGlobalTransition: true,
    });
  }

  if (contentGlassRef.value) {
    registerRegion({
      id: 'content',
      type: 'glass',
      element: contentGlassRef,
      shouldShow: () => true,
      skipGlobalTransition: true,
    });
  }

  if (knobRef.value) {
    registerRegion({
      id: 'knob',
      type: 'inset',
      element: knobRef,
      shouldShow: () => true,
    });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);

  unregisterRegion('logo');
  unregisterRegion('breadcrumbs');
  unregisterRegion('navigation');
  unregisterRegion('content');
  unregisterRegion('knob');
});

watch(
  () => [devStore.enableRiseSink, devStore.enableTransition] as const,
  ([riseSink, transition]) => {
    const root = document.documentElement;
    if (!transition) {
      root.setAttribute('data-no-transition', '');
    } else {
      root.removeAttribute('data-no-transition');
    }
    if (!riseSink) {
      root.setAttribute('data-no-rise-sink', '');
    } else {
      root.removeAttribute('data-no-rise-sink');
    }
  },
  { immediate: true },
);

watch(compactMode, (newMode, oldMode) => {
  if (newMode !== oldMode && isCompact.value) {
    startTransition({ type: 'layout', newLayout: 'small' }, 'small');
  }
});

const layoutClasses = computed(() => ({
  'compact': isCompact.value,
  'compact-content': isCompact.value && compactMode.value === 'content',
  'compact-nav': isCompact.value && compactMode.value === 'nav',
  'is-too-small': isTooSmall.value,
}));

const showTree = computed(() => {
  return isAuthenticated.value && !activeNode.value && !nodeStore.isConfirmState && !nodeStore.isDailyQuizState && !nodeStore.isWelcomeState;
});

const nonTreeContent = computed(() => {
  if (!isAuthenticated.value) {
    return AuthPanel;
  }
  if (nodeStore.isTreeState) {
    return GlobalTree;
  }
  if (nodeStore.isConfirmState) {
    return ConfirmPanel;
  }
  if (nodeStore.isDailyQuizState) {
    return DailyQuizPanel;
  }
  if (nodeStore.isWelcomeState) {
    return WelcomePanel;
  }
  return MarkdownEditor;
});

const contentKey = computed(() => {
  if (!isAuthenticated.value) {
    return `auth:${authMode.value}`;
  }
  const state = nodeStore.viewState;
  return `${state}:${activeNode.value?.id ?? 'editor'}`;
});

// Initialize displayed refs with current values
displayedKey.value = contentKey.value;
displayedShowTree.value = showTree.value;
displayedNonTreeContent.value = nonTreeContent.value;
treeOverlayActive.value = showTree.value;

// ================================================================
// Content transition animation
// Tree: mask fade-in/out (no slide)
// Non-tree: sink → slide-out → slide-in → rise
// ================================================================
async function animateContentTransition() {
  if (contentAnimating.value) {
    contentAnimToken++;
    contentPhase.value = 'idle';
    displayedKey.value = contentKey.value;
    displayedShowTree.value = showTree.value;
    displayedNonTreeContent.value = nonTreeContent.value;
    treeMaskVisible.value = false;
    contentAnimating.value = false;
    return;
  }

  contentAnimating.value = true;
  const token = ++contentAnimToken;
  const oldKey = displayedKey.value;
  const wasShowingTree = displayedShowTree.value;

  // Phase 1: Sink — glass frame loses shadow, content fades
  contentPhase.value = 'sinking';
  await nextTick();
  if (token !== contentAnimToken) return;
  await sleep(CONTENT_SINK_MS);
  if (token !== contentAnimToken) return;

  // Phase 2: Slide out — old content leaves
  contentPhase.value = 'slide-out';
  await sleep(CONTENT_SLIDE_MS);
  if (token !== contentAnimToken) return;

  // Apply pending data NOW — viewState is updated, so showTree is current
  nodeStore.applyPendingData();

  const willShowTree = showTree.value;

  // Content didn't change — skip slide, just rise
  if (contentKey.value === oldKey) {
    contentPhase.value = 'rising';
    await nextTick();
    if (token !== contentAnimToken) return;
    await sleep(CONTENT_RISE_MS);
    if (token !== contentAnimToken) return;
    contentPhase.value = 'idle';
    contentAnimating.value = false;
    return;
  }

  if (willShowTree && !wasShowingTree) {
    // ---- TREE ENTER: non-tree → tree ----

    // Snap mask to visible instantly (no fade-in) — looks like empty area
    treeOverlayActive.value = true;
    const maskEl = treeMaskRef.value;
    if (maskEl) maskEl.style.transition = 'none';
    treeMaskVisible.value = true;

    await nextTick();
    if (token !== contentAnimToken) return;
    void contentGlassRef.value?.offsetHeight; // force reflow so opacity:1 is painted
    if (maskEl) maskEl.style.transition = ''; // re-enable transition for fade-out

    // Now swap DOM: tree loads under the fully opaque mask
    displayedKey.value = contentKey.value;
    displayedShowTree.value = showTree.value;
    displayedNonTreeContent.value = nonTreeContent.value;
    contentPhase.value = 'tree-mask';

    // Wait for tree scene to be ready, then fade mask out
    await waitForSceneReady(token);
    if (token !== contentAnimToken) return;
    treeMaskVisible.value = false;
    await sleep(TREE_MASK_FADE_MS);
    if (token !== contentAnimToken) return;

  } else if (!willShowTree && wasShowingTree) {
    // ---- TREE EXIT: tree → non-tree ----
    // Mask fades in, covering the tree
    treeMaskVisible.value = true;
    contentPhase.value = 'tree-mask';
    await sleep(TREE_MASK_FADE_MS);
    if (token !== contentAnimToken) return;

    if (contentKey.value === oldKey) {
      treeMaskVisible.value = false;
      treeOverlayActive.value = false;
      contentPhase.value = 'rising';
      await nextTick();
      if (token !== contentAnimToken) return;
      await sleep(CONTENT_RISE_MS);
      if (token !== contentAnimToken) return;
      contentPhase.value = 'idle';
      contentAnimating.value = false;
      return;
    }

    // Swap DOM behind the mask
    displayedKey.value = contentKey.value;
    displayedShowTree.value = showTree.value;
    displayedNonTreeContent.value = nonTreeContent.value;

    await nextTick();
    if (token !== contentAnimToken) return;
    void contentGlassRef.value?.offsetHeight;

    // Mask fades out, revealing new content
    treeMaskVisible.value = false;
    await sleep(TREE_MASK_FADE_MS);
    if (token !== contentAnimToken) return;

    // Z-indices revert after mask is gone
    treeOverlayActive.value = false;

  } else {
    // ---- NON-TREE: standard slide-in from right ----

    // Phase 3: Swap DOM — new content in prep position (off-screen right)
    displayedKey.value = contentKey.value;
    displayedShowTree.value = showTree.value;
    displayedNonTreeContent.value = nonTreeContent.value;
    contentPhase.value = 'slide-in-prep';

    await nextTick();
    if (token !== contentAnimToken) return;

    // Force reflow so prep position is painted, then trigger slide-in
    void contentGlassRef.value?.offsetHeight;
    contentPhase.value = 'slide-in';

    await sleep(CONTENT_SLIDE_MS);
    if (token !== contentAnimToken) return;
  }

  // Phase: Rise — glass frame regains shadow
  contentPhase.value = 'rising';
  await nextTick();
  if (token !== contentAnimToken) return;
  await sleep(CONTENT_RISE_MS);
  if (token !== contentAnimToken) return;

  contentPhase.value = 'idle';
  contentAnimating.value = false;
}

// Trigger content animation when global transition starts sinking
watch(currentPhase, (phase) => {
  if (phase === 'sinking') {
    if (contentAnimating.value) {
      // Cancel in-progress animation, snap to current state
      contentAnimToken++;
      contentPhase.value = 'idle';
      displayedKey.value = contentKey.value;
      displayedShowTree.value = showTree.value;
      displayedNonTreeContent.value = nonTreeContent.value;
      treeMaskVisible.value = false;
      contentAnimating.value = false;
    }
    animateContentTransition();
  }
});

// Keep displayed refs in sync when not animating (e.g. dev mode with transitions disabled)
watch(contentKey, () => {
  if (!contentAnimating.value && contentPhase.value === 'idle') {
    displayedKey.value = contentKey.value;
    displayedShowTree.value = showTree.value;
    displayedNonTreeContent.value = nonTreeContent.value;
    treeMaskVisible.value = false;
    treeOverlayActive.value = showTree.value;
  }
});

// Tree curtain logic
const treeWasVisible = ref(false);

watch(currentPhase, (phase) => {
  if (phase === 'sinking') {
    treeWasVisible.value = showTree.value;
    if (showTree.value) {
      treeCurtainDrawn.value = true;
    }
  } else if (phase === 'rising') {
    if (!treeWasVisible.value && showTree.value) {
      const el = treeCurtainRef.value;
      if (el) {
        el.style.transition = 'none';
        treeCurtainDrawn.value = true;
        el.offsetHeight;
        el.style.transition = '';
      }
    }
  } else if (phase === 'idle') {
    if (!showTree.value) {
      treeCurtainDrawn.value = false;
    }
  }
});

watch(
  [() => treeCanvasRef.value?.sceneReady, () => showTree.value],
  ([ready, treeVisible]) => {
    if (!treeCurtainDrawn.value) return;

    if (!treeVisible) {
      treeCurtainDrawn.value = false;
      return;
    }

    if (ready) {
      treeCurtainDrawn.value = false;
    }
  },
);

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
  padding: 1px;
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

.navigation-shell {
  box-shadow:
    inset 0 9px 18px var(--shadow-inset-a),
    inset 9px 0 18px var(--shadow-inset-a),
    inset 0 -9px 18px var(--shadow-inset-b);
}

.navigation-area { z-index: 2; }
.content-area { z-index: 1; }

.static-shell {
  min-width: 0;
  min-height: 0;
}

.content-host {
  width: 100%;
  height: 100%;
}

.content-inset {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 1px;
  border-radius: 24px;
  overflow: hidden;
}

.content-inset::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.06);
  box-shadow:
    inset 0 9px 18px var(--shadow-inset-a),
    inset 0 -9px 18px var(--shadow-inset-b),
    inset -9px 0 18px var(--shadow-inset-b);
  pointer-events: none;
}

/* When tree is displayed, inner shadow overlays on top of tree content */
.content-inset.tree-visible::after {
  z-index: 3;
}

.content-inset.tree-visible .content-glass {
  z-index: 1;
}

.tree-mask {
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: 24px;
  background: var(--bg-gradient);
  background-attachment: fixed;
  opacity: 0;
  pointer-events: none;
  transition: opacity 380ms ease;
}

.tree-mask.tree-mask-visible {
  opacity: 1;
}

@supports (-webkit-touch-callout: none) {
  .tree-mask {
    background-attachment: scroll;
  }
}

.content-glass {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  border-radius: 24px;
  overflow: hidden;
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

  .navigation-area {
    grid-column: 1;
    grid-row: 2;
  }

  .content-area {
    grid-column: 2;
    grid-row: 2;
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

  .navigation-shell {
    display: contents !important;
  }

  .content-inset::after {
    display: none !important;
  }

  .content-area {
    padding: 0;
  }

  .tree-mask {
    border-radius: 0;
  }

  /* Compact content mode: breadcrumbs + content + knob */
  .layout.compact-content {
    grid-template-rows: 54px minmax(0, 1fr) 90px;
  }

  .layout.compact-content .breadcrumbs-area {
    grid-column: 1;
    grid-row: 1;
  }

  .layout.compact-content .content-area {
    grid-column: 1;
    grid-row: 2;
  }

  .layout.compact-content .navigation-area {
    grid-column: 1;
    grid-row: 2;
  }

  .layout.compact-content .knob-area {
    grid-column: 1;
    grid-row: 3;
    justify-self: center;
    width: min(100%, 260px);
  }

  /* Compact nav mode: breadcrumbs + navigation + knob */
  .layout.compact-nav {
    grid-template-rows: 54px minmax(0, 1fr) 90px;
  }

  .layout.compact-nav .breadcrumbs-area {
    grid-column: 1;
    grid-row: 1;
  }

  .layout.compact-nav .navigation-area {
    grid-column: 1;
    grid-row: 2;
  }

  .layout.compact-nav .content-area {
    grid-column: 1;
    grid-row: 2;
  }

  .layout.compact-nav .knob-area {
    grid-column: 1;
    grid-row: 3;
    justify-self: center;
    width: min(100%, 260px);
  }
}

/* ================================================================
   Content area slide animation
   Sink → slide-out-right → slide-in-from-right → rise
   ================================================================ */

/* Phase 1: Sinking — inner glass items lose shadow */
.content-sinking :deep(.glass-raised) {
  box-shadow: none;
  border-color: rgba(255, 255, 255, 0.12);
}

.content-sinking :deep(.glass-content) {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

/* Sunken hold state: glass items flat — persists through slide phases */
.content-slide-out :deep(.glass-raised),
.content-slide-in-prep :deep(.glass-raised),
.content-slide-in :deep(.glass-raised) {
  box-shadow: none;
  border-color: rgba(255, 255, 255, 0.12);
}

.content-slide-out :deep(.glass-content),
.content-slide-in-prep :deep(.glass-content),
.content-slide-in :deep(.glass-content) {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

/* Phase 2: Slide out right — content slides right, fades out */
.content-slide-out > .glass-content {
  transform: translateX(80px);
  opacity: 0;
  transition:
    transform 280ms cubic-bezier(0.4, 0, 0.6, 1),
    opacity 280ms ease;
}

/* Phase 3 prep: new content positioned right, no transition (forced by reflow in JS) */
.content-slide-in-prep > .glass-content {
  transform: translateX(80px);
  opacity: 0;
  transition: none;
}

/* Phase 3: Slide in from right */
.content-slide-in > .glass-content {
  transform: translateX(0);
  opacity: 1;
  transition:
    transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
    opacity 280ms ease;
}
</style>

<style>
/* Shared activity area pattern */
.activity-layout {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  height: 100%;
  padding: 1px;
}

.activity-glass-host {
  flex: 1;
  min-height: 0;
}

.activity-scroll {
  width: 100%;
  height: 100%;
  overflow-y: auto;
}
</style>
