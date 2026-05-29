<template>
  <div v-if="isTooSmall" class="insufficient-space">
    <p>{{ $t('app.insufficientSpace') }}</p>
  </div>
  <main v-else class="layout" :class="[layoutClasses, {
    'cinema-mode': isCinemaMode,
    'compact-toggle-sinking': compactAnimPhase === 'sinking',
    'compact-nav-slide-out': compactAnimPhase === 'nav-slide-out',
    'compact-nav-slide-in-prep': compactAnimPhase === 'nav-slide-in-prep',
    'compact-nav-slide-in': compactAnimPhase === 'nav-slide-in',
    'compact-toggle-rising': compactAnimPhase === 'rising',
    'official-sinking': otPhase === 'sinking',
    'official-nav-slide': otPhase === 'sliding',
    'official-rising': otPhase === 'rising',
    'entrance-prep': entrancePhase === 'prep',
    'entrance-sliding': entrancePhase === 'sliding',
    'entrance-rising': entrancePhase === 'rising',
  }]">
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

        <section ref="contentAreaRef" class="content-area">
          <div class="content-inset" :class="{ 'tree-visible': treeOverlayActive }">
            <div ref="treeMaskRef" class="tree-mask" :class="{ 'tree-mask-visible': treeMaskVisible }" aria-hidden="true"></div>
            <div v-if="!displayedSkipContentGlass" ref="contentGlassRef" class="content-glass" :class="{
              'content-sinking': contentPhase === 'sinking',
              'content-tree-mask': contentPhase === 'tree-mask',
              'content-slide-out': contentPhase === 'slide-out',
              'content-slide-in-prep': contentPhase === 'slide-in-prep',
              'content-slide-in': contentPhase === 'slide-in',
              'content-rising': contentPhase === 'rising',
            }">
              <div class="glass-content" style="width:100%;height:100%">
                <div v-if="displayedShowTree && !showEmptyBackground" key="tree" class="content-host">
                  <TreeCanvas ref="treeCanvasRef" :visible="displayedShowTree" />
                </div>
                <template v-if="!displayedShowTree && !showEmptyBackground">
                  <component
                    v-if="displayedNonTreeContent === MarkdownEditor"
                    :is="displayedNonTreeContent"
                    :key="displayedKey"
                  />
                  <div v-else class="activity-scroll">
                    <component :is="displayedNonTreeContent" :key="displayedKey" />
                  </div>
                </template>
              </div>
              <div class="tree-curtain" :class="{ drawn: treeCurtainDrawn }" aria-hidden="true"></div>
            </div>
            <div v-else class="content-direct" :class="{
              'direct-prep': contentPhase === 'slide-in-prep',
              'direct-slide': contentPhase === 'slide-in',
              'direct-slide-out': contentPhase === 'slide-out',
            }">
              <div v-if="displayedShowTree && !showEmptyBackground" key="tree" class="content-host">
                <TreeCanvas ref="treeCanvasRef" :visible="displayedShowTree" />
              </div>
              <template v-if="!displayedShowTree && !showEmptyBackground">
                <component
                  v-if="displayedNonTreeContent === MarkdownEditor"
                  :is="displayedNonTreeContent"
                  :key="displayedKey"
                />
                <div v-else class="activity-scroll">
                  <component :is="displayedNonTreeContent" :key="displayedKey" />
                </div>
              </template>
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
import { computed, ref, shallowRef, onMounted, onBeforeUnmount, watch, nextTick, provide } from 'vue';
import { storeToRefs } from 'pinia';
import LogoArea from '../components/layout/LogoArea.vue';
import Breadcrumbs from '../components/layout/Breadcrumbs.vue';
import Navigation from '../components/layout/Navigation.vue';
import Knob from '../components/layout/Knob.vue';
import ConfirmPanel from '../components/ui/ConfirmPanel.vue';
import GlobalTree from '../components/tree/GlobalTree.vue';
import TreeOverview from '../components/tree/TreeOverview.vue';
import TreeCanvas from '../components/tree/TreeCanvas.vue';
import MarkdownEditor from '../components/editor/MarkdownEditor.vue';
import AuthPanel from '../components/auth/AuthPanel.vue';
import DailyQuizPanel from '../components/official/DailyQuizPanel.vue';
import OfficialContentPanel from '../components/official/OfficialContentPanel.vue';
import DevPanel from '../components/dev/DevPanel.vue';
import { useNodeStore } from '../stores/nodeStore';
import { useAuthStore } from '../stores/authStore';
import { useDevStore } from '../stores/devStore';
import { useStyleStore } from '../stores/styleStore';
import { useAppInit } from '../composables/useAppInit';
import { useKnobDispatch, type CompactMode } from '../composables/useKnobDispatch';
import { usePageTransition } from '../composables/usePageTransition';
import type { LayoutType } from '../types/transition';
import { useOfficialTransition } from '../composables/useOfficialTransition';
import { COMPACT_BREAKPOINT, MIN_SPACE_HEIGHT } from '../constants/app';

/**
 * View states that render as content-direct panels (no outer content-glass).
 * Each panel component supplies its own GlassWrapper to avoid nested active areas.
 * When adding a new official knowledge point, add its viewState here.
 */
const CONTENT_DIRECT_STATES = ['add', 'daily_quiz', 'tree_overview', 'official_content'];

const isDev = import.meta.env.DEV;
const isCinemaMode = typeof window !== 'undefined' && window.location.search.includes('cinema');

const nodeStore = useNodeStore();
const authStore = useAuthStore();
const devStore = useDevStore();
const styleStore = useStyleStore();
const { activeNode, isEmpty } = storeToRefs(nodeStore);
const {
  mode: authMode,
  isAuthenticated,
  initialized,
} = storeToRefs(authStore);

useAppInit();
const { compactMode, layoutType } = useKnobDispatch();

const { registerRegion, unregisterRegion, startTransition, syncRegionVisibility, isTransitioning } = usePageTransition();

const {
  phase: otPhase,
  animating: otAnimating,
  animToken: otAnimToken,
  anchorItemId,
  clickedItemId,
  anchorDeltaY,
  anchorPrep,
  hideNonAnchorItems,
  anchorItemAction,
} = useOfficialTransition();

// Region refs for page transition system
const logoRef = ref<HTMLElement | null>(null);
const breadcrumbsRef = ref<HTMLElement | null>(null);
const navigationRef = ref<HTMLElement | null>(null);
const contentAreaRef = ref<HTMLElement | null>(null);
const contentGlassRef = ref<HTMLElement | null>(null);
const knobRef = ref<HTMLElement | null>(null);

// Tree curtain
const treeCurtainDrawn = ref(false);
const treeCanvasRef = ref<{ sceneReady: boolean } | null>(null);

// Tree mask
const treeMaskVisible = ref(false);
const treeOverlayActive = ref(false);
const treeMaskRef = ref<HTMLElement | null>(null);

// Compact layout tracking
const isTooSmall = ref(false);

// Initial page load: content starts sunken (only bottom areas visible),
// then animates slide-in + rise after initialization.
const initialRender = ref(true);

// Entrance animation: coordinates slide-in for nav/breadcrumbs/knob
// Phases: idle | prep | sliding | rising
const entrancePhase = ref<'idle' | 'prep' | 'sliding' | 'rising'>('idle');

// Compact toggle animation
const compactAnimPhase = ref<'idle' | 'sinking' | 'nav-slide-out' | 'nav-slide-in-prep' | 'nav-slide-in' | 'rising'>('idle');

// Content slide animation
const CONTENT_SINK_MS = 240;
const CONTENT_SLIDE_MS = 280;
const CONTENT_RISE_MS = 240;
const TREE_MASK_FADE_MS = 380;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const activeSceneWatchers = new Set<() => void>();

function waitForSceneReady(token: number): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    const watchers: (() => void)[] = [];

    const done = () => {
      if (resolved) return;
      resolved = true;
      watchers.forEach(stop => {
        stop();
        activeSceneWatchers.delete(stop);
      });
      resolve();
    };

    if (treeCanvasRef.value?.sceneReady && !devStore.manualSceneReady) {
      done();
      return;
    }

    // Notify DevPanel we're waiting
    window.dispatchEvent(new CustomEvent('dev-waiting-for-scene'));

    // In manual mode, wait for dev-scene-ready event
    if (devStore.manualSceneReady) {
      const onManualReady = () => {
        window.removeEventListener('dev-scene-ready', onManualReady);
        done();
      };
      window.addEventListener('dev-scene-ready', onManualReady);

      const checkCancel = watch(
        () => contentAnimToken.value,
        (currentToken) => {
          if (currentToken !== token) {
            window.removeEventListener('dev-scene-ready', onManualReady);
            done();
          }
        },
      );
      watchers.push(checkCancel);
      activeSceneWatchers.add(checkCancel);
      return;
    }

    // Auto mode: watch sceneReady
    const stop = watch(
      () => treeCanvasRef.value?.sceneReady,
      (ready) => {
        if (ready) {
          done();
        }
      },
    );
    watchers.push(stop);
    activeSceneWatchers.add(stop);

    const checkCancel = watch(
      () => contentAnimToken.value,
      (currentToken) => {
        if (currentToken !== token) {
          done();
        }
      },
    );
    watchers.push(checkCancel);
    activeSceneWatchers.add(checkCancel);
  });
}

const contentPhase = ref('idle');
const contentAnimToken = ref(0);
const contentAnimating = ref(false);
provide('contentAnimating', contentAnimating);

// Global click shield: block all pointer events while any CSS animation is playing.
// CSS animations are timer/transition-driven, so they don't need pointer events.
// Excludes 'tree-mask' phase: waitForSceneReady can take seconds while the tree
// loads, and the mask itself already has pointer-events: none.
// Excludes isTransitioning: data fetching is not an animation and can hang
// indefinitely if the backend is unreachable (fetch has no default timeout).
const isPageAnimating = computed(() =>
  (contentPhase.value !== 'idle' && contentPhase.value !== 'tree-mask') ||
  compactAnimPhase.value !== 'idle' ||
  otAnimating.value ||
  entrancePhase.value !== 'idle'
);

// Track previous viewState to detect small-layout special-state transitions.
// In small layout, Navigation runs its own internal animation for
// CONTENT_DIRECT_STATES enter/exit — Content must skip its slide animation
// to avoid the two systems fighting over DOM and CSS classes simultaneously.
let prevCompactViewState = nodeStore.viewState;

const displayedKey = ref('');
const displayedShowTree = ref(false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const displayedNonTreeContent = shallowRef<any>(MarkdownEditor);

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

function getLayoutHeight(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim();
  if (v && v.endsWith('px')) {
    return parseFloat(v) || window.innerHeight;
  }
  return window.innerHeight;
}

function updateLayoutState(): void {
  const w = window.innerWidth;
  const h = getLayoutHeight();

  isTooSmall.value = h < MIN_SPACE_HEIGHT;

  let newLayout: LayoutType;
  if (h < MIN_SPACE_HEIGHT) {
    newLayout = 'small'; // doesn't matter, won't be shown
  } else if (w < COMPACT_BREAKPOINT) {
    newLayout = 'small';
  } else if (w > h) {
    newLayout = 'large';
  } else {
    newLayout = 'medium';
  }

  const wasLayout = layoutType.value;
  layoutType.value = newLayout;

  if (wasLayout !== newLayout) {
    startTransition({ type: 'layout', newLayout });
  }

  if (newLayout !== 'small') {
    compactMode.value = 'content';
  }
}

const handleResize = debounce(updateLayoutState, 150);

// Non-debounced: immediately fix region visibility when crossing the compact
// threshold to prevent nav/content overlap during the 150ms debounce window.
// CSS @media applies instantly on resize; this keeps JS display state in sync.
function handleResizeImmediate(): void {
  const w = window.innerWidth;
  const h = getLayoutHeight();

  let newLayout: LayoutType;
  if (h < MIN_SPACE_HEIGHT) {
    newLayout = 'small';
  } else if (w < COMPACT_BREAKPOINT) {
    newLayout = 'small';
  } else if (w > h) {
    newLayout = 'large';
  } else {
    newLayout = 'medium';
  }

  if (newLayout !== layoutType.value) {
    layoutType.value = newLayout;
    syncRegionVisibility();
  }
}

onMounted(() => {
  window.addEventListener('resize', handleResizeImmediate);
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
    });
  }

  if (navigationRef.value) {
    registerRegion({
      id: 'navigation',
      type: 'inset',
      element: navigationRef,
      shouldShow: (state) => {
        if (state.layout === 'small') {
          const specialStates = CONTENT_DIRECT_STATES;
          if (specialStates.includes(state.viewState)) return true;
          return state.compactMode === 'nav';
        }
        return true;
      },
    });
  }

  if (contentAreaRef.value) {
    registerRegion({
      id: 'content',
      type: 'glass',
      element: contentAreaRef,
      shouldShow: (state) => {
        if (state.layout === 'small') {
          const specialStates = CONTENT_DIRECT_STATES;
          if (specialStates.includes(state.viewState)) return true;
          return state.compactMode !== 'nav';
        }
        return true;
      },
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

  // Initial visibility sync — must run after regions are registered
  updateLayoutState();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResizeImmediate);
  window.removeEventListener('resize', handleResize);

  // Clean up any lingering waitForSceneReady watchers
  activeSceneWatchers.forEach(stop => stop());
  activeSceneWatchers.clear();

  unregisterRegion('logo');
  unregisterRegion('breadcrumbs');
  unregisterRegion('navigation');
  unregisterRegion('content');
  unregisterRegion('knob');
});

watch(
  () => devStore.enableTransition,
  (transition) => {
    const root = document.documentElement;
    if (!transition) {
      root.setAttribute('data-no-transition', '');
    } else {
      root.removeAttribute('data-no-transition');
    }
  },
  { immediate: true },
);

watch(compactMode, (newMode, oldMode) => {
  if (newMode === oldMode || layoutType.value !== 'small') return;
  if (isTransitioning.value) return;
  if (contentAnimating.value) return;
  animateCompactToggle(oldMode as CompactMode, newMode as CompactMode);
});

const isSmallLayoutMixed = computed(() => {
  if (layoutType.value !== 'small' || compactMode.value !== 'nav') return false;
  const specialStates = CONTENT_DIRECT_STATES;
  return specialStates.includes(nodeStore.viewState);
});

// In CONTENT_DIRECT_STATES, skip the outer content-glass
// active area. The content components bring their own GlassWrappers, which
// become direct children of the content-inset bottom area — avoiding nested
// active areas. Applies to all layouts.
const skipContentGlass = computed(() => {
  const specialStates = CONTENT_DIRECT_STATES;
  return specialStates.includes(nodeStore.viewState);
});

// Displayed wrapper state — lags behind skipContentGlass during transitions.
// Updated only at the DOM-swap phase so the old wrapper stays mounted for
// sink+slide-out and the new wrapper appears at slide-in-prep.
const displayedSkipContentGlass = ref(skipContentGlass.value);

const layoutClasses = computed(() => ({
  'large': layoutType.value === 'large',
  'medium': layoutType.value === 'medium',
  'compact': layoutType.value === 'small',
  'compact-content': layoutType.value === 'small' && compactMode.value === 'content',
  'compact-nav': layoutType.value === 'small' && compactMode.value === 'nav',
  'compact-mixed': isSmallLayoutMixed.value,
  'is-too-small': isTooSmall.value,
  'page-animating': isPageAnimating.value,
  'initial-loading': initialRender.value,
}));

const showEmptyBackground = computed(() =>
  isEmpty.value && !nodeStore.activeNode && nodeStore.viewState === 'display'
);

const showTree = computed(() => {
  return isAuthenticated.value && !activeNode.value && !nodeStore.isConfirmState && !nodeStore.isDailyQuizState && !nodeStore.isOfficialContentState && !nodeStore.isTreeOverviewState && !isEmpty.value;
});

const nonTreeContent = computed(() => {
  if (!initialized.value) {
    return null;
  }
  if (!isAuthenticated.value) {
    return AuthPanel;
  }
  if (nodeStore.isTreeOverviewState) {
    return TreeOverview;
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
  if (nodeStore.isOfficialContentState) {
    return OfficialContentPanel;
  }
  return MarkdownEditor;
});

const contentKey = computed(() => {
  if (!initialized.value) {
    return 'loading';
  }
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
displayedSkipContentGlass.value = skipContentGlass.value;
treeOverlayActive.value = showTree.value;

// ================================================================
// Content transition animation
// Tree: mask fade-in/out (no slide)
// Non-tree: sink → slide-out → slide-in → rise
// ================================================================
async function animateContentTransition() {
  if (contentAnimating.value) {
    contentAnimToken.value++;
    contentPhase.value = 'idle';
    displayedKey.value = contentKey.value;
    displayedShowTree.value = showTree.value;
    displayedNonTreeContent.value = nonTreeContent.value;
    displayedSkipContentGlass.value = skipContentGlass.value;
    treeMaskVisible.value = false;
    treeOverlayActive.value = showTree.value;
    contentAnimating.value = false;
    return;
  }

  // Skip animation when content area is hidden in compact nav mode.
  // The deferred compactMode switch will trigger animateCompactToggle
  // which handles the nav→content transition with proper animation.
  if (layoutType.value === 'small' && compactMode.value === 'nav') {
    nodeStore.applyPendingData();
    return;
  }

  // Initial page load: content starts sunken (only bottom areas visible).
  // Data loads silently; entrance animation auto-plays when ready.
  if (initialRender.value) {
    const sameContent = contentKey.value === displayedKey.value && showTree.value === displayedShowTree.value;
    if (sameContent && nodeStore.viewState === prevCompactViewState) {
      nodeStore.applyPendingData();
      return;
    }

    // Wait for data loading to complete (executeDataLoading runs in startTransition).
    if (isTransitioning.value) {
      await new Promise<void>(resolve => {
        const stop = watch(isTransitioning, (v) => {
          if (!v) { stop(); resolve(); }
        });
      });
    }

    nodeStore.applyPendingData();

    // Wait for style to load before revealing bottom areas.
    // Unauthenticated users always use default CSS style, no wait needed.
    if (!styleStore.loaded && authStore.isAuthenticated) {
      await new Promise<void>(resolve => {
        const stop = watch(() => styleStore.loaded, (v) => {
          if (v) { stop(); resolve(); }
        });
      });
    }

    // Update displayed refs silently — content stays hidden by initial-loading CSS
    displayedSkipContentGlass.value = skipContentGlass.value;
    displayedKey.value = contentKey.value;
    displayedShowTree.value = showTree.value;
    displayedNonTreeContent.value = nonTreeContent.value;
    treeOverlayActive.value = showTree.value;

    // Trigger the coordinated entrance animation (content, nav, breadcrumbs, knob)
    playInitialAnimation();
    return;
  }

  // When entering or leaving a CONTENT_DIRECT_STATES view,
  // the wrapper element changes between content-glass and content-direct.
  const specialStates = CONTENT_DIRECT_STATES;
  const wasSpecial = specialStates.includes(prevCompactViewState);
  const isSpecial = specialStates.includes(nodeStore.viewState);
  prevCompactViewState = nodeStore.viewState;

  if (wasSpecial || isSpecial) {
    // Official transition orchestrator handles its own animation
    if (otAnimating.value) return;

    if (!wasSpecial && isSpecial) {
      // Entering special state: fall through to animation below.
      // Old content (in content-glass) sinks + slides out,
      // new content (in content-direct) slides in, no rise.
    } else if (wasSpecial && !isSpecial) {
      // Exiting special state: content-direct slides out right,
      // then new content (in content-glass) slides in, or tree fades in.
      contentAnimating.value = true;
      const token = ++contentAnimToken.value;

      // Phase 1: Slide out right (content-direct slides right, fades out)
      contentPhase.value = 'slide-out';
      await nextTick();
      if (token !== contentAnimToken.value) return;
      await sleep(CONTENT_SLIDE_MS);
      if (token !== contentAnimToken.value) return;

      // Apply pending data
      nodeStore.applyPendingData();

      if (showEmptyBackground.value) {
        displayedKey.value = contentKey.value;
        displayedShowTree.value = false;
        displayedNonTreeContent.value = nonTreeContent.value;
        displayedSkipContentGlass.value = skipContentGlass.value;
        treeMaskVisible.value = false;
        treeOverlayActive.value = false;
        contentPhase.value = 'idle';
        contentAnimating.value = false;
        return;
      }

      const willShowTree = showTree.value;

      // Swap DOM: content-direct → content-glass, content in prep position
      displayedSkipContentGlass.value = skipContentGlass.value;
      displayedKey.value = contentKey.value;
      displayedShowTree.value = showTree.value;
      displayedNonTreeContent.value = nonTreeContent.value;
      contentPhase.value = 'slide-in-prep';

      await nextTick();
      if (token !== contentAnimToken.value) return;

      if (willShowTree) {
        // Tree enter with mask (snap mask visible, load tree, fade mask out)
        treeOverlayActive.value = true;
        const maskEl = treeMaskRef.value;
        if (maskEl) maskEl.style.transition = 'none';
        treeMaskVisible.value = true;

        await nextTick();
        if (token !== contentAnimToken.value) return;
        const reflowEl = contentGlassRef.value || document.querySelector('.content-direct');
        void reflowEl?.offsetHeight;
        if (maskEl) maskEl.style.transition = '';

        contentPhase.value = 'tree-mask';

        await nextTick();
        await waitForSceneReady(token);
        if (token !== contentAnimToken.value) return;
        treeMaskVisible.value = false;
        await sleep(TREE_MASK_FADE_MS);
        if (token !== contentAnimToken.value) return;
      } else {
        // Standard slide-in from right
        const reflowEl = contentGlassRef.value || document.querySelector('.content-direct');
        void reflowEl?.offsetHeight;
        contentPhase.value = 'slide-in';
        await sleep(CONTENT_SLIDE_MS);
        if (token !== contentAnimToken.value) return;
      }

      // Rise
      if (!displayedSkipContentGlass.value) {
        contentPhase.value = 'rising';
        await nextTick();
        if (token !== contentAnimToken.value) return;
        await sleep(CONTENT_RISE_MS);
        if (token !== contentAnimToken.value) return;
      }

      contentPhase.value = 'idle';
      contentAnimating.value = false;
      return;
    } else {
      // special→special: instant swap
      displayedKey.value = contentKey.value;
      displayedShowTree.value = showTree.value;
      displayedNonTreeContent.value = nonTreeContent.value;
      displayedSkipContentGlass.value = skipContentGlass.value;
      treeMaskVisible.value = false;
      treeOverlayActive.value = showTree.value;
      return;
    }
  }

  contentAnimating.value = true;
  const token = ++contentAnimToken.value;
  const oldKey = displayedKey.value;
  const wasShowingTree = displayedShowTree.value;

  // Empty account with no nodes: skip animation, just show background
  if (showEmptyBackground.value) {
    displayedKey.value = contentKey.value;
    displayedShowTree.value = false;
    displayedNonTreeContent.value = nonTreeContent.value;
    displayedSkipContentGlass.value = skipContentGlass.value;
    treeMaskVisible.value = false;
    treeOverlayActive.value = false;
    contentPhase.value = 'idle';
    contentAnimating.value = false;
    return;
  }

  // Phase 1: Sink — glass frame loses shadow, content fades
  contentPhase.value = 'sinking';
  await nextTick();
  if (token !== contentAnimToken.value) return;
  await sleep(CONTENT_SINK_MS);
  if (token !== contentAnimToken.value) return;

  // Wait for data loading to complete before applying pending data.
  // Without this, a slow backend response causes applyPendingData() to
  // find no pendingNodeContext yet, so activeNode stays null and the
  // content animation ends with the tree still showing — the nav item
  // disappears (childNodes already updated) but the content never changes.
  if (isTransitioning.value) {
    await new Promise<void>(resolve => {
      const stop = watch(isTransitioning, (v) => {
        if (!v) { stop(); resolve(); }
      });
    });
    if (token !== contentAnimToken.value) return;
  }

  if (wasShowingTree) {
    // ================================================================
    // TREE EXIT PATH: mask fade-in → DOM swap → slide-in
    // ================================================================

    // Only apply pending data for node navigations, not for
    // viewState transitions (CONTENT_DIRECT_STATES). For viewState
    // transitions, executeDataLoading already set the target viewState
    // and pendingNodeContext may carry stale data from a previous
    // navigation that would incorrectly revert viewState to 'display'.
    const specialStates = CONTENT_DIRECT_STATES;
    if (!specialStates.includes(nodeStore.viewState)) {
      nodeStore.applyPendingData();
    }

    // If account became empty, skip to background
    if (showEmptyBackground.value) {
      displayedKey.value = contentKey.value;
      displayedShowTree.value = false;
      displayedNonTreeContent.value = nonTreeContent.value;
      displayedSkipContentGlass.value = skipContentGlass.value;
      treeMaskVisible.value = false;
      treeOverlayActive.value = false;
      contentPhase.value = 'idle';
      contentAnimating.value = false;
      return;
    }

    const willShowTree = showTree.value;

    if (willShowTree) {
      // Staying in tree — just rise
      treeMaskVisible.value = false;
      treeOverlayActive.value = true;
      contentPhase.value = 'rising';
      await nextTick();
      if (token !== contentAnimToken.value) return;
      await sleep(CONTENT_RISE_MS);
      if (token !== contentAnimToken.value) return;
      contentPhase.value = 'idle';
      contentAnimating.value = false;
      return;
    }

    // Mask fades in, covering the tree
    treeMaskVisible.value = true;
    contentPhase.value = 'tree-mask';
    await sleep(TREE_MASK_FADE_MS);
    if (token !== contentAnimToken.value) return;

    if (contentKey.value === oldKey) {
      treeMaskVisible.value = false;
      treeOverlayActive.value = false;
      contentPhase.value = 'rising';
      await nextTick();
      if (token !== contentAnimToken.value) return;
      await sleep(CONTENT_RISE_MS);
      if (token !== contentAnimToken.value) return;
      contentPhase.value = 'idle';
      contentAnimating.value = false;
      return;
    }

    // Swap DOM behind mask — tree unmounts, new content in slide-in-prep position
    displayedKey.value = contentKey.value;
    displayedShowTree.value = showTree.value;
    displayedNonTreeContent.value = nonTreeContent.value;
    displayedSkipContentGlass.value = skipContentGlass.value;
    contentPhase.value = 'slide-in-prep';

    await nextTick();
    if (token !== contentAnimToken.value) return;
    const reflowEl = contentGlassRef.value || document.querySelector('.content-direct');
    void reflowEl?.offsetHeight;

    // Snap mask off (content is invisible at prep position, no visual change)
    const maskEl = treeMaskRef.value;
    if (maskEl) maskEl.style.transition = 'none';
    treeMaskVisible.value = false;
    treeOverlayActive.value = false;

    await nextTick();
    void reflowEl?.offsetHeight;
    if (maskEl) maskEl.style.transition = '';

    // Trigger slide-in from right
    contentPhase.value = 'slide-in';
    await sleep(CONTENT_SLIDE_MS);
    if (token !== contentAnimToken.value) return;

  } else {
    // ================================================================
    // NON-TREE PATH: slide-out → (tree enter OR standard slide-in)
    // ================================================================

    // Phase 2: Slide out — old content leaves
    contentPhase.value = 'slide-out';
    await sleep(CONTENT_SLIDE_MS);
    if (token !== contentAnimToken.value) return;

    // Apply pending data NOW — viewState is updated, so showTree is current.
    // Skip for special state entry to avoid reverting viewState to 'display'.
    const specialStates2 = CONTENT_DIRECT_STATES;
    if (!specialStates2.includes(nodeStore.viewState)) {
      nodeStore.applyPendingData();
    }

    // If account became empty (last node deleted), skip to background
    if (showEmptyBackground.value) {
      displayedKey.value = contentKey.value;
      displayedShowTree.value = false;
      displayedNonTreeContent.value = nonTreeContent.value;
      displayedSkipContentGlass.value = skipContentGlass.value;
      treeMaskVisible.value = false;
      treeOverlayActive.value = false;
      contentPhase.value = 'idle';
      contentAnimating.value = false;
      return;
    }

    const willShowTree = showTree.value;

    // Content didn't change — skip slide, just rise
    if (contentKey.value === oldKey) {
      treeMaskVisible.value = false;
      contentPhase.value = 'rising';
      await nextTick();
      if (token !== contentAnimToken.value) return;
      await sleep(CONTENT_RISE_MS);
      if (token !== contentAnimToken.value) return;
      contentPhase.value = 'idle';
      contentAnimating.value = false;
      return;
    }

    if (willShowTree) {
      // ---- TREE ENTER: non-tree → tree ----

      // Snap mask to visible instantly (no fade-in) — looks like empty area
      treeOverlayActive.value = true;
      const maskEl = treeMaskRef.value;
      if (maskEl) maskEl.style.transition = 'none';
      treeMaskVisible.value = true;

      await nextTick();
      if (token !== contentAnimToken.value) return;
      const enterReflowEl = contentGlassRef.value || document.querySelector('.content-direct');
      void enterReflowEl?.offsetHeight; // force reflow so opacity:1 is painted
      if (maskEl) maskEl.style.transition = ''; // re-enable transition for fade-out

      // Now swap DOM: tree loads under the fully opaque mask
      displayedSkipContentGlass.value = skipContentGlass.value;
      displayedKey.value = contentKey.value;
      displayedShowTree.value = showTree.value;
      displayedNonTreeContent.value = nonTreeContent.value;
      contentPhase.value = 'tree-mask';

      // Wait for tree scene to be ready, then fade mask out
      await nextTick();
      await waitForSceneReady(token);
      if (token !== contentAnimToken.value) return;
      treeMaskVisible.value = false;
      await sleep(TREE_MASK_FADE_MS);
      if (token !== contentAnimToken.value) return;

    } else {
      // ---- NON-TREE: standard slide-in from right ----

      // Phase 3: Swap DOM — new content in prep position (off-screen right).
      // Swap the wrapper first so the new wrapper type is mounted before
      // new content is placed, avoiding a flash of new content in the old wrapper.
      displayedSkipContentGlass.value = skipContentGlass.value;
      displayedKey.value = contentKey.value;
      displayedShowTree.value = showTree.value;
      displayedNonTreeContent.value = nonTreeContent.value;
      contentPhase.value = 'slide-in-prep';

      await nextTick();
      if (token !== contentAnimToken.value) return;

      // Force reflow so prep position is painted, then trigger slide-in.
      // When entering a special state content-glass is replaced by content-direct.
      const reflowEl = contentGlassRef.value || document.querySelector('.content-direct');
      void reflowEl?.offsetHeight;
      contentPhase.value = 'slide-in';

      await sleep(CONTENT_SLIDE_MS);
      if (token !== contentAnimToken.value) return;
    }
  }

  // Phase: Rise — glass frame regains shadow (skip when current
  // wrapper is content-direct, which has no glass frame to rise)
  if (!displayedSkipContentGlass.value) {
    contentPhase.value = 'rising';
    await nextTick();
    if (token !== contentAnimToken.value) return;
    await sleep(CONTENT_RISE_MS);
    if (token !== contentAnimToken.value) return;
  }

  contentPhase.value = 'idle';
  contentAnimating.value = false;
}

// Trigger the "enter main page" animation from the initial sunken state.
// All areas slide in together: content from right, nav/breadcrumbs from left, knob fades in.
async function playInitialAnimation(): Promise<void> {
  if (!initialRender.value || contentAnimating.value) return;

  contentAnimating.value = true;
  const token = ++contentAnimToken.value;

  // Phase 0: Set up prep positions for ALL areas while initial-loading CSS still hides them.
  // Content at prep-right, nav+breadcrumbs at prep-left, knob hidden.
  contentPhase.value = 'slide-in-prep';
  entrancePhase.value = 'prep';

  // Now remove initial-loading — prep classes take over, so no visual jump.
  initialRender.value = false;

  await nextTick();
  if (token !== contentAnimToken.value) return;

  const willShowTree = showTree.value;

  if (willShowTree) {
    // Tree enter with mask
    treeOverlayActive.value = true;
    const maskEl = treeMaskRef.value;
    if (maskEl) maskEl.style.transition = 'none';
    treeMaskVisible.value = true;

    await nextTick();
    if (token !== contentAnimToken.value) return;
    const reflowEl = contentGlassRef.value || document.querySelector('.content-direct');
    void reflowEl?.offsetHeight;
    if (maskEl) maskEl.style.transition = '';

    contentPhase.value = 'tree-mask';
    // Nav/breadcrumbs/knob slide in while tree mask is up
    entrancePhase.value = 'sliding';

    await nextTick();
    await waitForSceneReady(token);
    if (token !== contentAnimToken.value) return;
    treeMaskVisible.value = false;
    await sleep(TREE_MASK_FADE_MS);
    if (token !== contentAnimToken.value) return;
  } else {
    // Phase 1: Reflow, then trigger slide-in for content AND nav/breadcrumbs/knob.
    const reflowEl = contentGlassRef.value || document.querySelector('.content-direct');
    void reflowEl?.offsetHeight;
    contentPhase.value = 'slide-in';
    entrancePhase.value = 'sliding';
    await sleep(CONTENT_SLIDE_MS);
    if (token !== contentAnimToken.value) return;
  }

  // Phase 2: Rise — glass items regain shadow
  if (!displayedSkipContentGlass.value) {
    contentPhase.value = 'rising';
    entrancePhase.value = 'rising';
    await nextTick();
    if (token !== contentAnimToken.value) return;
    await sleep(CONTENT_RISE_MS);
    if (token !== contentAnimToken.value) return;
  }

  contentPhase.value = 'idle';
  entrancePhase.value = 'idle';
  contentAnimating.value = false;
}

// ================================================================
// Compact toggle animation (small layout only)
// Tree path: mask fade-in/out (same mechanism as large layout)
// Non-tree path: sink → slide-out → slide-in → rise
// ================================================================
async function animateCompactToggle(_oldMode: CompactMode, newMode: CompactMode) {
  const navEl = navigationRef.value;
  const contentEl = contentAreaRef.value;
  if (!navEl || !contentEl) return;

  contentAnimating.value = true;
  const token = ++contentAnimToken.value;
  const toNav = newMode === 'nav';

  if (toNav) {
    // ================================================================
    // Content → Nav
    // ================================================================

    // Exit any special state so the user returns to display mode.
    const specialStates = ['move', 'delete', ...CONTENT_DIRECT_STATES];
    if (specialStates.includes(nodeStore.viewState)) {
      nodeStore.setViewState('display');
    }

    if (displayedShowTree.value) {
      // ---- TREE PATH: mask fade-in covers the tree ----

      // Mask fades in over tree
      treeMaskVisible.value = true;
      contentPhase.value = 'tree-mask';
      await sleep(TREE_MASK_FADE_MS);
      if (token !== contentAnimToken.value) return;

      // Snap mask off — content area is about to be hidden
      const maskEl = treeMaskRef.value;
      if (maskEl) maskEl.style.transition = 'none';
      treeMaskVisible.value = false;
      treeOverlayActive.value = false;
      contentPhase.value = 'idle';

      await nextTick();
      void maskEl?.offsetHeight;
      if (maskEl) maskEl.style.transition = '';
      if (token !== contentAnimToken.value) return;
    } else {
      // ---- NON-TREE PATH: slide-out right ----

      contentPhase.value = 'sinking';
      await nextTick();
      if (token !== contentAnimToken.value) return;
      await sleep(CONTENT_SINK_MS);
      if (token !== contentAnimToken.value) return;

      contentPhase.value = 'slide-out';
      await sleep(CONTENT_SLIDE_MS);
      if (token !== contentAnimToken.value) return;

      contentPhase.value = 'idle';
    }

    // Swap visibility — hide content, show nav in prep position
    contentEl.style.display = 'none';
    navEl.style.display = '';
    compactAnimPhase.value = 'nav-slide-in-prep';

    await nextTick();
    void navEl.offsetHeight;

    // Nav slides in from left as sunken
    compactAnimPhase.value = 'nav-slide-in';
    await sleep(CONTENT_SLIDE_MS);
    if (token !== contentAnimToken.value) return;

    // Nav rises — glass items regain shadow
    compactAnimPhase.value = 'rising';
    await nextTick();
    await sleep(CONTENT_RISE_MS);
  } else {
    // ================================================================
    // Nav → Content
    // ================================================================

    // Nav sinks
    compactAnimPhase.value = 'sinking';
    await nextTick();
    await sleep(CONTENT_SINK_MS);

    // Nav slides out left
    compactAnimPhase.value = 'nav-slide-out';
    await sleep(CONTENT_SLIDE_MS);

    // Apply pending node data so showTree reflects the actual state
    nodeStore.applyPendingData();

    // Swap visibility — hide nav, show content
    compactAnimPhase.value = 'idle';
    navEl.style.display = 'none';
    contentEl.style.display = '';

    if (showTree.value) {
      // ---- TREE PATH: mask covers tree while it loads, then fades out ----

      // Snap mask to visible instantly (no fade-in)
      treeOverlayActive.value = true;
      const maskEl = treeMaskRef.value;
      if (maskEl) maskEl.style.transition = 'none';
      treeMaskVisible.value = true;

      // Swap DOM: tree loads under the fully opaque mask
      displayedKey.value = contentKey.value;
      displayedShowTree.value = showTree.value;
      displayedNonTreeContent.value = nonTreeContent.value;
      contentPhase.value = 'tree-mask';

      await nextTick();
      if (token !== contentAnimToken.value) return;
      const ctTreeReflowEl = contentGlassRef.value || document.querySelector('.content-direct');
      void ctTreeReflowEl?.offsetHeight;
      if (maskEl) maskEl.style.transition = '';

      // Wait for tree scene to be ready, then fade mask out
      await nextTick();
      await waitForSceneReady(token);
      if (token !== contentAnimToken.value) return;
      treeMaskVisible.value = false;
      await sleep(TREE_MASK_FADE_MS);
      if (token !== contentAnimToken.value) return;
    } else {
      // ---- NON-TREE PATH: slide-in from right ----

      displayedKey.value = contentKey.value;
      displayedShowTree.value = showTree.value;
      displayedNonTreeContent.value = nonTreeContent.value;

      contentPhase.value = 'slide-in-prep';

      await nextTick();
      if (token !== contentAnimToken.value) return;

      const ctReflowEl = contentGlassRef.value || document.querySelector('.content-direct');
      void ctReflowEl?.offsetHeight;
      contentPhase.value = 'slide-in';
      await sleep(CONTENT_SLIDE_MS);
      if (token !== contentAnimToken.value) return;

      // Content rises — glass items regain shadow
      contentPhase.value = 'rising';
      await nextTick();
      await sleep(CONTENT_RISE_MS);
    }
  }

  contentPhase.value = 'idle';
  compactAnimPhase.value = 'idle';
  contentAnimating.value = false;
}

// ================================================================
// Small layout official knowledge point click orchestration
// Sink → non-clicked slide left (clicked stays) → clicked slides
// down to anchor → content slides in from right → rise
// ================================================================
async function startSmallLayoutOfficialTransition(item: { id: string; name: string; action?: () => void }, rowEl: HTMLElement): Promise<void> {
  // Cancel existing official animation
  if (otAnimating.value) {
    otAnimToken.value++;
    otPhase.value = 'idle';
    otAnimating.value = false;
    hideNonAnchorItems.value = false;
    anchorItemId.value = null;
    clickedItemId.value = null;
    anchorDeltaY.value = 0;
    anchorPrep.value = false;
    anchorItemAction.value = null;
  }

  // Cancel any in-flight content animation
  if (contentAnimating.value) {
    contentAnimToken.value++;
    contentPhase.value = 'idle';
    contentAnimating.value = false;
  }

  otAnimating.value = true;
  contentAnimating.value = true;
  const token = ++otAnimToken.value;
  anchorItemAction.value = item.action ?? null;
  clickedItemId.value = item.id;

  // ---- Phase 1: SINK (240ms) ----
  otPhase.value = 'sinking';
  await nextTick();
  await sleep(CONTENT_SINK_MS);
  if (token !== otAnimToken.value) return;

  // ---- Measurement: capture clicked row position before it moves ----
  const rowRect = rowEl.getBoundingClientRect();

  // ---- Phase 2: NAV SLIDE (280ms) — non-clicked rows slide left, clicked stays ----
  otPhase.value = 'sliding';
  await sleep(CONTENT_SLIDE_MS);
  if (token !== otAnimToken.value) return;

  // ---- DOM swap: show anchor, change viewState ----
  anchorItemId.value = item.id;
  hideNonAnchorItems.value = true;

  // Fire the action to change viewState (starts async startTransition)
  const action = anchorItemAction.value;
  if (action) {
    action();
  }

  // Wait for startTransition to finish — it sets content display to '' asynchronously
  if (isTransitioning.value) {
    await new Promise<void>(resolve => {
      const stop = watch(isTransitioning, (v) => {
        if (!v) { stop(); resolve(); }
      });
    });
  }
  await nextTick();
  if (token !== otAnimToken.value) return;

  // Keep content hidden during anchor slide so it doesn't block the animation.
  // startTransition re-enabled it; we override that until the anchor finishes sliding.
  const contentEl = contentAreaRef.value;
  if (contentEl) contentEl.style.display = 'none';

  // Measure anchor final position
  const anchorEl = document.querySelector('.anchor-official-shell') as HTMLElement | null;
  const anchorRect = anchorEl?.getBoundingClientRect();
  if (anchorRect) {
    anchorDeltaY.value = anchorRect.top - rowRect.top;
  }

  // Set anchor in prep position (at clicked item's original location, invisible)
  anchorPrep.value = true;
  await nextTick();
  void document.body.offsetHeight; // force reflow

  // ---- Phase 3: ANCHOR SLIDE DOWN (280ms) ----
  // Anchor slides from clicked row position down to its final spot
  anchorPrep.value = false;
  otPhase.value = 'anchor-sliding';

  // Wait for anchor slide transition to complete
  await new Promise<void>((resolve) => {
    const shell = document.querySelector('.anchor-official-shell') as HTMLElement | null;
    if (!shell) { resolve(); return; }
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === 'transform') {
        shell.removeEventListener('transitionend', onEnd);
        resolve();
      }
    };
    shell.addEventListener('transitionend', onEnd);
    setTimeout(() => {
      shell.removeEventListener('transitionend', onEnd);
      resolve();
    }, CONTENT_SLIDE_MS + 80);
  });
  if (token !== otAnimToken.value) return;

  // ---- Phase 4: CONTENT SLIDE IN (280ms) ----
  // Swap wrapper and content while content area is still hidden,
  // then show at prep position and animate slide-in.
  displayedSkipContentGlass.value = skipContentGlass.value;
  displayedKey.value = contentKey.value;
  displayedShowTree.value = showTree.value;
  displayedNonTreeContent.value = nonTreeContent.value;
  contentPhase.value = 'slide-in-prep';

  await nextTick();
  if (token !== otAnimToken.value) return;

  // Show content — wrapper is at prep position (off-screen right, opacity 0)
  if (contentEl) contentEl.style.display = '';

  // Force reflow, then trigger slide-in
  const reflowEl = contentGlassRef.value || document.querySelector('.content-direct');
  void reflowEl?.offsetHeight;
  contentPhase.value = 'slide-in';
  await sleep(CONTENT_SLIDE_MS);
  if (token !== otAnimToken.value) return;

  // ---- Cleanup ----
  otPhase.value = 'idle';
  contentPhase.value = 'idle';
  otAnimating.value = false;
  contentAnimating.value = false;
  anchorDeltaY.value = 0;
  anchorPrep.value = false;
  anchorItemAction.value = null;
  clickedItemId.value = null;
  // anchorItemId and hideNonAnchorItems stay set — anchor remains visible
  // during the special state so the user can click it to return.
}

provide('startSmallLayoutOfficialTransition', startSmallLayoutOfficialTransition);

// Dev-only: trigger the tree fade-out animation for testing/debugging.
// When tree is showing, fades the mask in (tree disappears), holds briefly,
// then fades the mask out (tree reappears).
async function triggerTreeFadeTest() {
  if (contentAnimating.value) {
    contentAnimToken.value++;
    contentPhase.value = 'idle';
    treeMaskVisible.value = false;
    contentAnimating.value = false;
  }

  if (!displayedShowTree.value) {
    console.log('[Dev] triggerTreeFadeTest: tree is not currently showing');
    return;
  }

  contentAnimating.value = true;
  const token = ++contentAnimToken.value;

  // Phase 1: Sink
  contentPhase.value = 'sinking';
  await nextTick();
  await sleep(CONTENT_SINK_MS);
  if (token !== contentAnimToken.value) return;

  // Phase 2: Mask fades in — tree disappears behind mask
  treeMaskVisible.value = true;
  contentPhase.value = 'tree-mask';
  await sleep(TREE_MASK_FADE_MS);
  if (token !== contentAnimToken.value) return;

  // Hold for visual observation
  await sleep(1000);

  // Phase 3: Fade mask back out — tree reappears
  treeMaskVisible.value = false;
  await sleep(TREE_MASK_FADE_MS);
  if (token !== contentAnimToken.value) return;

  // Phase 4: Rise
  contentPhase.value = 'rising';
  await nextTick();
  await sleep(CONTENT_RISE_MS);

  contentPhase.value = 'idle';
  contentAnimating.value = false;
  console.log('[Dev] triggerTreeFadeTest: complete');
}
provide('triggerTreeFadeTest', triggerTreeFadeTest);

// Tree curtain: tracks visibility across transitions
const treeWasVisible = ref(false);

// Trigger content animation when a page transition starts
watch(isTransitioning, (transitioning) => {
  if (transitioning) {
    treeWasVisible.value = showTree.value;

    if (contentAnimating.value) {
      contentAnimToken.value++;
      contentPhase.value = 'idle';
      displayedKey.value = contentKey.value;
      displayedShowTree.value = showTree.value;
      displayedNonTreeContent.value = nonTreeContent.value;
      displayedSkipContentGlass.value = skipContentGlass.value;
      treeMaskVisible.value = false;
      treeOverlayActive.value = showTree.value;
      contentAnimating.value = false;
    }
    animateContentTransition();
  } else {
    // Transition ended — clean up tree curtain
    if (!showTree.value) {
      treeCurtainDrawn.value = false;
    }
  }
});

// Keep displayed refs in sync when not animating (e.g. dev mode with transitions disabled)
watch(contentKey, (_newKey, oldKey) => {
  if (oldKey === 'loading') return;
  if (!contentAnimating.value && contentPhase.value === 'idle') {
    displayedKey.value = contentKey.value;
    displayedShowTree.value = showTree.value;
    displayedNonTreeContent.value = nonTreeContent.value;
    displayedSkipContentGlass.value = skipContentGlass.value;
    treeMaskVisible.value = false;
    treeOverlayActive.value = showTree.value;
  }
});

// Directly trigger content animation when viewState enters/leaves
// CONTENT_DIRECT_STATES. The isTransitioning-based
// watcher above may not fire for synchronous viewState transitions
// because isTransitioning goes true→false within the same tick.
watch(() => nodeStore.viewState, (newState, oldState) => {
  if (contentAnimating.value) return;

  const specialStates = CONTENT_DIRECT_STATES;
  const wasSpecial = specialStates.includes(oldState);
  const isSpecial = specialStates.includes(newState);

  // Only animate for special ↔ non-special transitions
  if (wasSpecial === isSpecial) return;

  // Don't double-trigger with isTransitioning watcher
  if (isTransitioning.value) return;

  treeWasVisible.value = showTree.value;
  animateContentTransition();
});

// When auth initialization completes and the user is not authenticated,
// animate the transition from skeleton to AuthPanel. The authenticated
// path is handled by the isTransitioning watcher (via useAppInit ->
// nodeStore.initialize -> startTransition).
watch(initialized, (nowInitialized, prevInitialized) => {
  if (nowInitialized && !prevInitialized && !isAuthenticated.value && !contentAnimating.value) {
    animateContentTransition();
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

/* Cinema demo mode: lock layout to viewport since keyboard height locking is skipped */
.layout.cinema-mode {
  min-height: 100vh;
  min-height: 100dvh;
  max-height: 100vh;
  max-height: 100dvh;
}

/* Global click shield: block all interaction while any animation is playing */
.layout.page-animating {
  pointer-events: none;
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

/* ================================================================
   content-direct: replaces content-glass for CONTENT_DIRECT_STATES
   across all layouts.
   Content sits directly in the content-inset bottom area without
   an outer active-area wrapper. Content components' own GlassWrappers
   are flattened so they don't introduce a second raised layer.
   ================================================================ */
.content-direct {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  border-radius: 24px;
  overflow: hidden;
}

/* Slide-in animation for content-direct (reuses contentPhase state machine).
   Mirrors the content-glass > .glass-content slide but targets the
   content-direct wrapper itself. */
.direct-prep {
  transform: translateX(80px);
  opacity: 0;
}

.direct-slide-out {
  transform: translateX(80px);
  opacity: 0;
  transition:
    transform 280ms cubic-bezier(0.4, 0, 0.6, 1),
    opacity 280ms ease;
}

.direct-slide {
  transform: translateX(0);
  opacity: 1;
  transition:
    transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
    opacity 280ms ease;
}

.content-glass {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  border-radius: 24px;
  overflow: hidden;
  transition: transform 240ms ease;
}

.content-glass > .glass-content {
  transition: opacity 240ms ease;
}

/* Medium layout: portrait tablet (w <= h, w >= 601px).
   Driven by JS layoutType (keyboard-stable), NOT @media (orientation)
   which would falsely deactivate when the keyboard shrinks viewport height. */
.layout.medium {
  padding: 16px;
  grid-template-columns: 241px minmax(0, 1fr);
  grid-template-rows: 54px minmax(0, 1fr) 100px;
  row-gap: 10px;
  column-gap: 10px;
}

.layout.medium .logo-area {
  grid-column: 1;
  grid-row: 1;
}

.layout.medium .breadcrumbs-area {
  grid-column: 2;
  grid-row: 1;
}

.layout.medium .navigation-area {
  grid-column: 1;
  grid-row: 2;
}

.layout.medium .content-area {
  grid-column: 2;
  grid-row: 2;
}

.layout.medium .knob-area {
  grid-column: 1 / span 2;
  grid-row: 3;
  justify-self: center;
  width: min(100%, 260px);
}

/* Small layout: compact (w <= 600px).
   Also driven by JS layoutType for the same reason. */
.layout.compact {
  position: absolute;
  inset: 0;
  padding: 8px;
  grid-template-columns: 1fr;
  gap: 6px;
}

.layout.compact .merged-area,
.layout.compact .merged-shell {
  display: contents !important;
}

.layout.compact .navigation-shell {
  box-shadow:
    inset 9px 9px 18px var(--shadow-inset-a),
    inset -9px -9px 18px var(--shadow-inset-b);
}

.layout.compact .content-inset::after {
  box-shadow:
    inset 9px 9px 18px var(--shadow-inset-a),
    inset -9px -9px 18px var(--shadow-inset-b);
}

.layout.compact .content-area {
  padding: 0;
}

.layout.compact .tree-mask {
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

/* Compact mixed mode: both nav (anchor only) and content visible in row 2.
   merged-shell is the sole bottom area filling row 2 with its inherent
   inset-shell styling. Both children are stripped of their own bottom-area
   visuals to avoid doubled inner shadows. */
.layout.compact-mixed .merged-area,
.layout.compact-mixed .merged-shell {
  display: flex !important;
  flex-direction: column-reverse;
  grid-column: 1;
  grid-row: 2;
  min-height: 0;
}

.layout.compact-mixed .content-area {
  flex: 1;
  min-height: 0;
}

.layout.compact-mixed .navigation-area {
  flex: 0 0 58px;
  min-height: 0;
}

/* Navigation anchor area — no bottom-area visual of its own */
.layout.compact-mixed .navigation-shell {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}

/* merged-shell is the sole bottom area in compact-mixed.
   content-inset::after must be stripped to avoid doubled inner shadows. */
.layout.compact-mixed .content-inset::after {
  box-shadow: none;
}

/* ================================================================
   Initial page load: content starts sunken with all inner content hidden.
   Only bottom areas (inset shells) are visually present — empty containers
   with inner shadows and borders, no text, no glass items.
   After playInitialAnimation(), slide-in + rise animation plays.
   ================================================================ */

/* Hide inset shell visuals until style is loaded so default blue
   colors never flash before the account's custom style is applied. */
.layout.initial-loading .inset-shell {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

.layout.initial-loading .content-inset::after {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

/* Logo text uses var(--color-primary) which defaults to blue */
.layout.initial-loading .logo-area :deep(.logo-title),
.layout.initial-loading .logo-area :deep(.logo-status) {
  opacity: 0;
}

/* Knob well has its own inset ring (not .inset-shell) */
.layout.initial-loading .knob-area :deep(.knob-well) {
  border-color: transparent;
  box-shadow: none;
}

/* Content area: hide glass content (already handled by slide-in-prep later) */
.layout.initial-loading .content-glass > .glass-content {
  transform: translateX(80px);
  opacity: 0;
}

.layout.initial-loading .content-glass :deep(.glass-raised) {
  box-shadow: none;
  border-color: rgba(255, 255, 255, 0.12);
}

.layout.initial-loading .content-glass :deep(.glass-content) {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.layout.initial-loading .content-direct {
  transform: translateX(80px);
  opacity: 0;
}

/* Breadcrumbs area: hide entire breadcrumbs-shell — off-screen above */
.layout.initial-loading .breadcrumbs-area :deep(.breadcrumbs-shell) {
  transform: translateY(-40px);
  opacity: 0;
}

/* Navigation area: hide entire inner content — off-screen left */
.layout.initial-loading .navigation-area :deep(.nav-shell) {
  transform: translateX(-80px);
  opacity: 0;
}

/* Knob area: hide GlassWrapper knob body (keep knob-well inset shell visible),
   hide hint text columns */
.layout.initial-loading .knob-area :deep(.knob-body) {
  opacity: 0;
}

.layout.initial-loading .knob-area :deep(.knob-hint),
.layout.initial-loading .knob-area :deep(.knob-hint-compact) {
  opacity: 0;
}

/* ================================================================
   Entrance animation: coordinated slide-in for all areas.
   Content slides from right (via contentPhase classes on .content-glass),
   nav/breadcrumbs slide from left, knob fades in.
   Phases: prep → sliding → rising → idle
   ================================================================ */

/* Prep: nav off-screen left, breadcrumbs off-screen above, knob hidden */
.entrance-prep .navigation-area :deep(.nav-shell) {
  transform: translateX(-80px);
  opacity: 0;
  transition: none;
}

.entrance-prep .breadcrumbs-area :deep(.breadcrumbs-shell) {
  transform: translateY(-40px);
  opacity: 0;
  transition: none;
}

.entrance-prep .navigation-area :deep(.glass-raised),
.entrance-sliding .navigation-area :deep(.glass-raised) {
  box-shadow: none;
  border-color: rgba(255, 255, 255, 0.12);
}

.entrance-prep .navigation-area :deep(.glass-content),
.entrance-sliding .navigation-area :deep(.glass-content) {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.entrance-prep .navigation-area :deep(.official-content),
.entrance-sliding .navigation-area :deep(.official-content) {
  background: transparent;
}

.entrance-prep .breadcrumbs-area :deep(.glass-raised),
.entrance-sliding .breadcrumbs-area :deep(.glass-raised) {
  box-shadow: none;
  border-color: rgba(255, 255, 255, 0.12);
}

.entrance-prep .breadcrumbs-area :deep(.glass-content),
.entrance-sliding .breadcrumbs-area :deep(.glass-content) {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.entrance-prep .knob-area :deep(.knob-body) {
  opacity: 0;
  transition: none;
}

/* Sliding: nav slides in from left, breadcrumbs drop from above, knob fades in */
.entrance-sliding .navigation-area :deep(.nav-shell) {
  transform: translateX(0);
  opacity: 1;
  transition:
    transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
    opacity 280ms ease;
}

.entrance-sliding .breadcrumbs-area :deep(.breadcrumbs-shell) {
  transform: translateY(0);
  opacity: 1;
  transition:
    transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
    opacity 280ms ease;
}

.entrance-sliding .knob-area :deep(.knob-body) {
  opacity: 1;
  transition: opacity 280ms ease;
}

/* Rising: glass items regain shadow — no explicit rules needed,
   removing the prep/sliding classes restores default raised styles. */

/* ================================================================
   Content area slide animation
   Sink → slide-out-right → slide-in-from-right → rise
   ================================================================ */

/* Phase 1: Sinking — inner glass items lose shadow, content dims and shifts down */
.content-sinking :deep(.glass-raised) {
  box-shadow: none;
  border-color: rgba(255, 255, 255, 0.12);
}

.content-sinking :deep(.glass-content) {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.content-sinking {
  transform: translateY(1px);
}

.content-sinking > .glass-content {
  opacity: 0.4;
}

/* Sunken hold state: glass items flat, content stays shifted down */
.content-tree-mask,
.content-slide-out,
.content-slide-in-prep,
.content-slide-in {
  transform: translateY(1px);
}

/* Sunken hold state: glass items flat — persists through mask/slide phases */
.content-tree-mask :deep(.glass-raised),
.content-slide-out :deep(.glass-raised),
.content-slide-in-prep :deep(.glass-raised),
.content-slide-in :deep(.glass-raised) {
  box-shadow: none;
  border-color: rgba(255, 255, 255, 0.12);
}

.content-tree-mask :deep(.glass-content),
.content-slide-out :deep(.glass-content),
.content-slide-in-prep :deep(.glass-content),
.content-slide-in :deep(.glass-content) {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

/* Tree-mask phase: content fades out behind mask */
.content-tree-mask > .glass-content {
  opacity: 0;
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

/* Phase 4: Rising — glass items regain shadow, content fades back to full opacity */
.content-rising > .glass-content {
  opacity: 1;
  transition: opacity 240ms ease;
}

/* ================================================================
   Compact toggle animation (small layout)
   Nav slide: sink → slide-out-left → slide-in-from-left → rise
   Content slide: reuse content-sinking/content-slide-out/etc.
   ================================================================ */

/* Nav sink/sunken states — glass items flat */
.compact-toggle-sinking .navigation-area :deep(.glass-raised),
.compact-nav-slide-out .navigation-area :deep(.glass-raised),
.compact-nav-slide-in-prep .navigation-area :deep(.glass-raised),
.compact-nav-slide-in .navigation-area :deep(.glass-raised) {
  box-shadow: none;
  border-color: rgba(255, 255, 255, 0.12);
}

.compact-toggle-sinking .navigation-area :deep(.glass-content),
.compact-nav-slide-out .navigation-area :deep(.glass-content),
.compact-nav-slide-in-prep .navigation-area :deep(.glass-content),
.compact-nav-slide-in .navigation-area :deep(.glass-content) {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.compact-toggle-sinking .navigation-area :deep(.official-content),
.compact-nav-slide-out .navigation-area :deep(.official-content),
.compact-nav-slide-in-prep .navigation-area :deep(.official-content),
.compact-nav-slide-in .navigation-area :deep(.official-content) {
  background: transparent;
}

/* Nav slide out left — animate inner glass content, NOT the inset area */
.compact-nav-slide-out .navigation-area :deep(.nav-shell) {
  transform: translateX(-80px);
  opacity: 0;
  transition:
    transform 280ms cubic-bezier(0.4, 0, 0.6, 1),
    opacity 280ms ease;
}

/* Nav prep off-screen left (no transition, forced by reflow in JS) */
.compact-nav-slide-in-prep .navigation-area :deep(.nav-shell) {
  transform: translateX(-80px);
  opacity: 0;
  transition: none;
}

/* Nav slide in from left */
.compact-nav-slide-in .navigation-area :deep(.nav-shell) {
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
