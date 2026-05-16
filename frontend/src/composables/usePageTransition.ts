import { ref, computed } from 'vue';
import type {
  RegionRegistration,
  TransitionTrigger,
  PageState,
  LayoutType,
} from '../types/transition';
import { useNodeStore } from '../stores/nodeStore';
import { useAuthStore } from '../stores/authStore';
import { useKnobDispatch } from './useKnobDispatch';
import { ViewStates } from '../types/node';

const regions = new Map<string, RegionRegistration>();
const isTransitioning = ref(false);

function getCurrentPageState(layout: LayoutType): PageState {
  const nodeStore = useNodeStore();
  const authStore = useAuthStore();
  const { compactMode, isCompactLayout } = useKnobDispatch();

  const actualLayout: LayoutType = isCompactLayout.value ? 'small' : layout;

  return {
    viewState: nodeStore.viewState,
    activeNode: nodeStore.activeNode ? { id: nodeStore.activeNode.id } : null,
    isOfficialNode: nodeStore.isDailyQuizState || nodeStore.isWelcomeState,
    layout: actualLayout,
    compactMode: compactMode.value,
    isAuthenticated: authStore.isAuthenticated,
  };
}

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
      'daily_quiz': ViewStates.DAILY_QUIZ,
      'welcome': ViewStates.WELCOME,
      'display': ViewStates.DISPLAY,
    } as Record<string, string>;
    const vs = stateMap[trigger.newState] || ViewStates.DISPLAY;
    nodeStore.setViewState(vs);
  }

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

  async function startTransition(
    trigger: TransitionTrigger,
    layout: LayoutType
  ): Promise<void> {
    if (isTransitioning.value) {
      return;
    }

    isTransitioning.value = true;

    let deferredCompactSwitch = false;

    try {
      await executeDataLoading(trigger);

      const nodeStore = useNodeStore();
      nodeStore.applyPendingSharedData();

      // Defer compact mode auto-switch to after the transition completes
      // so animateCompactToggle can run properly (not blocked by isTransitioning)
      if (trigger.type === 'navigate') {
        const { compactMode, isCompactLayout } = useKnobDispatch();
        if (isCompactLayout.value && compactMode.value === 'nav') {
          deferredCompactSwitch = true;
        }
      }

      const newState = getCurrentPageState(layout);

      for (const [, reg] of regions.entries()) {
        const el = reg.element.value;
        if (!el) continue;

        // Skip nav/content region swap when compact mode switch is deferred
        // — animateCompactToggle will handle the swap with proper animation
        if (deferredCompactSwitch && (reg.id === 'navigation' || reg.id === 'content')) {
          continue;
        }

        const shouldBeVisible = reg.shouldShow(newState);
        const currentDisplay = window.getComputedStyle(el).display;

        if (shouldBeVisible && currentDisplay === 'none') {
          el.style.display = '';
        } else if (!shouldBeVisible && currentDisplay !== 'none') {
          el.style.display = 'none';
        }
      }
    } catch (error) {
      console.error('Page transition failed:', error);
    } finally {
      isTransitioning.value = false;
    }

    // Apply deferred compact mode switch after transition completes
    // (isTransitioning is now false, so compactMode watcher can run)
    if (deferredCompactSwitch) {
      const { compactMode } = useKnobDispatch();
      compactMode.value = 'content';
    }
  }

  return {
    registerRegion,
    unregisterRegion,
    startTransition,
    isTransitioning: computed(() => isTransitioning.value),
  };
}
