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
 * Helper: Sink glass regions with animation
 */
async function sinkRegions(regionIds: Set<string>): Promise<void> {
  const glassRegions = Array.from(regionIds)
    .map(id => regions.get(id))
    .filter((reg): reg is RegionRegistration =>
      reg !== undefined && reg.type === 'glass'
    );

  if (glassRegions.length === 0) {
    return;
  }

  // Add sinking class to all glass regions
  for (const reg of glassRegions) {
    const el = reg.element.value;
    if (el) {
      el.classList.add('glass-sinking');
    }
  }

  // Wait for animation to complete (300ms as defined in CSS)
  await new Promise(resolve => setTimeout(resolve, 300));
}

/**
 * Helper: Rise glass regions with animation
 */
async function riseRegions(regionIds: Set<string>): Promise<void> {
  const glassRegions = Array.from(regionIds)
    .map(id => regions.get(id))
    .filter((reg): reg is RegionRegistration =>
      reg !== undefined && reg.type === 'glass'
    );

  if (glassRegions.length === 0) {
    return;
  }

  // Add rising class to all glass regions
  for (const reg of glassRegions) {
    const el = reg.element.value;
    if (el) {
      el.classList.add('glass-rising');
    }
  }

  // Wait for animation to complete (300ms as defined in CSS)
  await new Promise(resolve => setTimeout(resolve, 300));

  // Remove animation classes after completion
  for (const reg of glassRegions) {
    const el = reg.element.value;
    if (el) {
      el.classList.remove('glass-rising', 'glass-sinking');
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

      // Phase 2: Sink old glass regions
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

      // Phase 5: Rise new glass regions
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
