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

const regions = new Map<string, RegionRegistration>();
const isTransitioning = ref(false);
const phase = ref<TransitionPhase>('idle');
const oldRegions = ref<Set<string>>(new Set());
const newRegions = ref<Set<string>>(new Set());

/**
 * Helper: Sink all regions (glass + inset) with animation
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

  // Wait for animation to complete (1000ms as defined in CSS)
  await new Promise(resolve => setTimeout(resolve, 1000));
}

/**
 * Helper: Rise all regions (glass + inset) with animation
 */
async function riseRegions(regionIds: Set<string>): Promise<void> {
  const matched = Array.from(regionIds)
    .map(id => regions.get(id))
    .filter((reg): reg is RegionRegistration => reg !== undefined);

  if (matched.length === 0) {
    return;
  }

  // Remove sinking class from all regions
  for (const reg of matched) {
    const el = reg.element.value;
    if (!el) continue;
    if (reg.type === 'glass') {
      el.classList.remove('glass-sinking');
    } else {
      el.classList.remove('inset-sinking');
    }
  }

  // Force reflow so the browser registers the class removal before adding rising
  void (matched[0]?.element.value?.offsetHeight);

  // Add rising class to all regions
  for (const reg of matched) {
    const el = reg.element.value;
    if (!el) continue;
    if (reg.type === 'glass') {
      el.classList.add('glass-rising');
    } else {
      el.classList.add('inset-rising');
    }
  }

  // Wait for animation to complete (1000ms as defined in CSS)
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Remove animation class after completion
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
    // Navigation trigger: load node data
    await nodeStore.loadNode(trigger.nodeId);
  } else if (trigger.type === 'viewState') {
    // View state change: may need to load tree data
    if (trigger.newState === 'tree' || trigger.newState === 'move') {
      await nodeStore.refreshTree();
    }
  }
  // Other trigger types (layout, knob) don't require data loading
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

    isTransitioning.value = true;

    try {
      // Phase 1: Capture old state
      const oldState = getCurrentPageState(layout);
      const oldVisibleRegions = new Set<string>();

      for (const [id, reg] of regions.entries()) {
        if (reg.shouldShow(oldState)) {
          oldVisibleRegions.add(id);
        }
      }
      oldRegions.value = oldVisibleRegions;

      // Phase 2: Sink all visible regions (glass + inset)
      phase.value = 'sinking';
      await sinkRegions(oldVisibleRegions);

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
        } else if (!shouldBeVisible && wasVisible) {
          // Hide old region
          el.style.display = 'none';
        }
      }

      // Phase 5: Rise all visible regions (glass + inset)
      phase.value = 'rising';
      await riseRegions(newVisibleRegions);

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
