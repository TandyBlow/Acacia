import { ref, computed } from 'vue';
import type {
  RegionRegistration,
  TransitionTrigger,
  TransitionPhase,
  PageState,
  LayoutType,
} from '../types/transition';
import { useNodeStore } from '../stores/nodeStore';
import { useAuthStore } from '../stores/authStore';
import { useKnobDispatch } from './useKnobDispatch';
import { useDevStore } from '../stores/devStore';
import { ViewStates } from '../types/node';

const regions = new Map<string, RegionRegistration>();
const isTransitioning = ref(false);
const phase = ref<TransitionPhase>('idle');
const oldRegions = ref<Set<string>>(new Set());
const newRegions = ref<Set<string>>(new Set());

/**
 * Helper: Sink all regions (glass + inset) — content fades, then frame snaps
 */
async function sinkRegions(regionIds: Set<string>): Promise<void> {
  const matched = Array.from(regionIds)
    .map(id => regions.get(id))
    .filter((reg): reg is RegionRegistration => reg !== undefined);

  if (matched.length === 0) {
    return;
  }

  for (const reg of matched) {
    const el = reg.element.value;
    if (!el) continue;
    if (reg.type === 'glass') {
      el.classList.add('glass-sinking');
    } else {
      el.classList.add('inset-sinking');
    }
  }

  // Wait for content fade to complete (240ms as defined in CSS)
  await new Promise(resolve => setTimeout(resolve, 240));

  // Switch to static sunken state — add sunken BEFORE removing sinking
  // to prevent content from flashing visible between class changes
  for (const reg of matched) {
    const el = reg.element.value;
    if (!el) continue;
    if (reg.type === 'glass') {
      el.classList.add('glass-sunken');
      el.classList.remove('glass-sinking');
    } else {
      el.classList.add('inset-sunken');
      el.classList.remove('inset-sinking');
    }
  }
}

/**
 * Helper: Rise all regions (glass + inset) — slide up, fade in, scale in
 */
async function riseRegions(regionIds: Set<string>): Promise<void> {
  const matched = Array.from(regionIds)
    .map(id => regions.get(id))
    .filter((reg): reg is RegionRegistration => reg !== undefined);

  if (matched.length === 0) {
    return;
  }

  // Step 1: Add rising class — enables 240ms transitions on opacity and transform
  for (const reg of matched) {
    const el = reg.element.value;
    if (!el) continue;
    if (reg.type === 'glass') {
      el.classList.add('glass-rising');
    } else {
      el.classList.add('inset-rising');
    }
  }

  // Step 2: Force reflow so transitions are registered before removing sunken
  void (matched[0]?.element.value?.offsetHeight);

  // Step 3: Remove sunken class — opacity and transform transition to normal
  for (const reg of matched) {
    const el = reg.element.value;
    if (!el) continue;
    if (reg.type === 'glass') {
      el.classList.remove('glass-sunken');
    } else {
      el.classList.remove('inset-sunken');
    }
  }

  // Step 4: Wait for transitions to complete (240ms)
  await new Promise(resolve => setTimeout(resolve, 240));

  // Step 5: Clean up rising class
  for (const reg of matched) {
    const el = reg.element.value;
    if (!el) continue;
    if (reg.type === 'glass') {
      el.classList.remove('glass-rising');
    } else {
      el.classList.remove('inset-rising');
    }
  }
}

/**
 * Helper: Get current page state snapshot
 */
function getCurrentPageState(layout: LayoutType): PageState {
  const nodeStore = useNodeStore();
  const authStore = useAuthStore();
  const { isFeaturePanel, compactMode } = useKnobDispatch();

  return {
    viewState: nodeStore.viewState,
    activeNode: nodeStore.activeNode ? { id: nodeStore.activeNode.id } : null,
    isFeaturePanel: isFeaturePanel.value,
    layout,
    compactMode: compactMode.value,
    isAuthenticated: authStore.isAuthenticated,
  };
}

/**
 * Helper: Execute data loading based on trigger type
 */
async function executeDataLoading(trigger: TransitionTrigger): Promise<void> {
  const nodeStore = useNodeStore();

  if (trigger.type === 'navigate') {
    await nodeStore.loadNode(trigger.nodeId, { skipTransition: true });
  } else if (trigger.type === 'viewState') {
    const stateMap = {
      'delete': ViewStates.DELETE,
      'move': ViewStates.MOVE,
      'add': ViewStates.ADD,
      'tree': ViewStates.TREE,
      'quiz': ViewStates.QUIZ,
      'quiz_history': ViewStates.QUIZ_HISTORY,
      'stats': ViewStates.STATS,
      'review': ViewStates.REVIEW,
      'display': ViewStates.DISPLAY,
    } as Record<string, string>;
    const vs = stateMap[trigger.newState] || ViewStates.DISPLAY;
    nodeStore.setViewState(vs);
  }

  // Run setup callback during loading phase while regions are sunken
  if (trigger.setup) {
    await trigger.setup();
  }
}

export function usePageTransition() {
  function registerRegion(registration: RegionRegistration): void {
    regions.set(registration.id, registration);
  }

  function unregisterRegion(id: string): void {
    regions.delete(id);
  }

  /**
   * Main transition orchestrator
   */
  async function startTransition(
    trigger: TransitionTrigger,
    layout: LayoutType
  ): Promise<void> {
    if (isTransitioning.value) {
      return; // Prevent concurrent transitions
    }

    const devStore = useDevStore();

    // Fast path: transitions fully disabled — load data and swap visibility instantly
    if (!devStore.enableTransition) {
      isTransitioning.value = true;
      try {
        await executeDataLoading(trigger);
        const nodeStore = useNodeStore();
        nodeStore.applyPendingData();

        const newState = getCurrentPageState(layout);
        for (const [, reg] of regions.entries()) {
          const el = reg.element.value;
          if (!el) continue;
          const shouldBeVisible = reg.shouldShow(newState);
          const currentDisplay = window.getComputedStyle(el).display;
          if (shouldBeVisible && currentDisplay === 'none') {
            el.style.display = '';
            el.classList.remove('glass-sunken', 'glass-rising', 'glass-sinking',
              'inset-sunken', 'inset-rising', 'inset-sinking');
          } else if (!shouldBeVisible && currentDisplay !== 'none') {
            el.style.display = 'none';
          } else if (shouldBeVisible) {
            // Region stays visible — clean up any lingering transition classes
            // that may be stuck from an interrupted prior transition
            el.classList.remove('glass-sunken', 'glass-rising', 'glass-sinking',
              'inset-sunken', 'inset-rising', 'inset-sinking');
          }
        }
      } catch (error) {
        console.error('Page transition failed:', error);
      } finally {
        isTransitioning.value = false;
      }
      return;
    }

    isTransitioning.value = true;

    try {
      // Phase 1: Capture actually-visible regions via computed style.
      // shouldShow alone is insufficient: state may have changed
      // synchronously right before startTransition (e.g. closeFeaturePanel
      // called immediately before an action's startTransition in card handlers).
      const oldVisibleRegions = new Set<string>();

      for (const [id, reg] of regions.entries()) {
        const el = reg.element.value;
        if (!el) continue;
        if (window.getComputedStyle(el).display !== 'none') {
          oldVisibleRegions.add(id);
        }
      }
      oldRegions.value = oldVisibleRegions;

      // Phase 2: Sink all visible regions (glass + inset)
      phase.value = 'sinking';
      if (devStore.enableRiseSink) {
        await sinkRegions(oldVisibleRegions);
      }

      // Phase 3: Data loading
      phase.value = 'loading';
      await executeDataLoading(trigger);

      // Phase 4: Swap visibility (instant, no animation)
      phase.value = 'swapping';

      // Apply pending data before calculating new state
      const nodeStore = useNodeStore();
      nodeStore.applyPendingData();

      // Calculate new visible regions based on new state
      const newState = getCurrentPageState(layout);
      const newVisibleRegions = new Set<string>();

      for (const [id, reg] of regions.entries()) {
        if (reg.shouldShow(newState)) {
          newVisibleRegions.add(id);
        }
      }
      newRegions.value = newVisibleRegions;

      // Update DOM visibility
      for (const [id, reg] of regions.entries()) {
        const el = reg.element.value;
        if (!el) continue;

        const shouldBeVisible = newVisibleRegions.has(id);
        const wasVisible = oldVisibleRegions.has(id);

        if (shouldBeVisible && !wasVisible) {
          // Show new region
          el.style.display = '';
          if (devStore.enableRiseSink) {
            if (reg.type === 'glass') {
              el.classList.add('glass-sunken');
            } else {
              el.classList.add('inset-sunken');
            }
          } else {
            // No rise animation: clean up any lingering transition classes
            // from a previous transition, so the region appears in normal state
            el.classList.remove(
              'glass-sunken', 'glass-rising', 'glass-sinking',
              'inset-sunken', 'inset-rising', 'inset-sinking',
            );
          }
        } else if (!shouldBeVisible && wasVisible) {
          // Hide old region
          el.style.display = 'none';
        } else if (shouldBeVisible && wasVisible && !devStore.enableRiseSink) {
          // Region stays visible but rise is disabled — clean up any lingering
          // transition classes stuck from an interrupted prior transition
          el.classList.remove('glass-sunken', 'glass-rising', 'glass-sinking',
            'inset-sunken', 'inset-rising', 'inset-sinking');
        }
      }

      // Phase 5: Rise all visible regions (glass + inset)
      phase.value = 'rising';
      if (devStore.enableRiseSink) {
        await riseRegions(newVisibleRegions);
      }

      // Phase 6: Complete
      phase.value = 'idle';
    } catch (error) {
      console.error('Page transition failed:', error);
      phase.value = 'idle';
    } finally {
      isTransitioning.value = false;
    }
  }

  return {
    registerRegion,
    unregisterRegion,
    startTransition,
    isTransitioning: computed(() => isTransitioning.value),
    currentPhase: computed(() => phase.value),
  };
}
