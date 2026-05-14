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

async function sinkRegions(regionIds: Set<string>): Promise<void> {
  const matched = Array.from(regionIds)
    .map(id => regions.get(id))
    .filter((reg): reg is RegionRegistration => reg !== undefined && !reg.skipGlobalTransition && reg.type === 'glass');

  if (matched.length === 0) {
    return;
  }

  for (const reg of matched) {
    const el = reg.element.value;
    if (!el) continue;
    el.classList.add('glass-sinking');
  }

  await new Promise(resolve => setTimeout(resolve, 240));

  for (const reg of matched) {
    const el = reg.element.value;
    if (!el) continue;
    el.classList.add('glass-sunken');
    el.classList.remove('glass-sinking');
  }
}

async function riseRegions(regionIds: Set<string>): Promise<void> {
  const matched = Array.from(regionIds)
    .map(id => regions.get(id))
    .filter((reg): reg is RegionRegistration => reg !== undefined && !reg.skipGlobalTransition && reg.type === 'glass');

  if (matched.length === 0) {
    return;
  }

  for (const reg of matched) {
    const el = reg.element.value;
    if (!el) continue;
    el.classList.add('glass-rising');
  }

  void (matched[0]?.element.value?.offsetHeight);

  for (const reg of matched) {
    const el = reg.element.value;
    if (!el) continue;
    el.classList.remove('glass-sunken');
  }

  await new Promise(resolve => setTimeout(resolve, 240));

  for (const reg of matched) {
    const el = reg.element.value;
    if (!el) continue;
    el.classList.remove('glass-rising');
  }
}

function getCurrentPageState(layout: LayoutType): PageState {
  const nodeStore = useNodeStore();
  const authStore = useAuthStore();
  const { compactMode } = useKnobDispatch();

  return {
    viewState: nodeStore.viewState,
    activeNode: nodeStore.activeNode ? { id: nodeStore.activeNode.id } : null,
    isOfficialNode: nodeStore.isDailyQuizState || nodeStore.isWelcomeState,
    layout,
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

    const devStore = useDevStore();

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
          if (reg.skipGlobalTransition) continue;
          const shouldBeVisible = reg.shouldShow(newState);
          const currentDisplay = window.getComputedStyle(el).display;
          if (shouldBeVisible && currentDisplay === 'none') {
            el.style.display = '';
            el.classList.remove('glass-sunken', 'glass-rising', 'glass-sinking');
          } else if (!shouldBeVisible && currentDisplay !== 'none') {
            el.style.display = 'none';
          } else if (shouldBeVisible) {
            el.classList.remove('glass-sunken', 'glass-rising', 'glass-sinking');
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
      const oldVisibleRegions = new Set<string>();

      for (const [id, reg] of regions.entries()) {
        const el = reg.element.value;
        if (!el) continue;
        if (window.getComputedStyle(el).display !== 'none') {
          oldVisibleRegions.add(id);
        }
      }
      oldRegions.value = oldVisibleRegions;

      phase.value = 'sinking';
      if (devStore.enableRiseSink) {
        await sinkRegions(oldVisibleRegions);
      }

      phase.value = 'loading';
      await executeDataLoading(trigger);

      phase.value = 'swapping';

      const nodeStore = useNodeStore();
      nodeStore.applyPendingSharedData();

      const newState = getCurrentPageState(layout);
      const newVisibleRegions = new Set<string>();

      for (const [id, reg] of regions.entries()) {
        if (reg.shouldShow(newState)) {
          newVisibleRegions.add(id);
        }
      }
      newRegions.value = newVisibleRegions;

      for (const [id, reg] of regions.entries()) {
        const el = reg.element.value;
        if (!el) continue;
        if (reg.skipGlobalTransition) continue;

        const shouldBeVisible = newVisibleRegions.has(id);
        const wasVisible = oldVisibleRegions.has(id);

        if (shouldBeVisible && !wasVisible) {
          el.style.display = '';
          if (reg.type === 'glass' && devStore.enableRiseSink) {
            el.classList.add('glass-sunken');
          } else {
            el.classList.remove(
              'glass-sunken', 'glass-rising', 'glass-sinking',
            );
          }
        } else if (!shouldBeVisible && wasVisible) {
          el.style.display = 'none';
        } else if (shouldBeVisible && wasVisible && !devStore.enableRiseSink) {
          el.classList.remove('glass-sunken', 'glass-rising', 'glass-sinking');
        }
      }

      phase.value = 'rising';
      if (devStore.enableRiseSink) {
        await riseRegions(newVisibleRegions);
      }

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
