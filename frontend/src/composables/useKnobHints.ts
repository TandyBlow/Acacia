import { ref, computed } from 'vue';

type HintAction = 'click' | 'hold' | 'dblclick';

const HINT_SUPPRESS_THRESHOLD = 5;
const HINT_RESET_MS = 72 * 60 * 60 * 1000; // 72 hours

interface HintState {
  count: number;
  lastAction: number;
}

function loadState(action: HintAction): HintState {
  try {
    const raw = localStorage.getItem(`seewhat_knob_hint_${action}`);
    if (!raw) return { count: 0, lastAction: 0 };
    return JSON.parse(raw) as HintState;
  } catch {
    return { count: 0, lastAction: 0 };
  }
}

function saveState(action: HintAction, state: HintState): void {
  try {
    localStorage.setItem(`seewhat_knob_hint_${action}`, JSON.stringify(state));
  } catch {
    // localStorage unavailable (private browsing)
  }
}

const actionCounts = ref<Record<HintAction, HintState>>({
  click: loadState('click'),
  hold: loadState('hold'),
  dblclick: loadState('dblclick'),
});

function isStale(state: HintState): boolean {
  return Date.now() - state.lastAction > HINT_RESET_MS;
}

export function useKnobHints() {
  function recordAction(action: HintAction): void {
    const current = actionCounts.value[action];
    if (isStale(current)) {
      actionCounts.value = { ...actionCounts.value, [action]: { count: 1, lastAction: Date.now() } };
    } else {
      actionCounts.value = { ...actionCounts.value, [action]: { count: current.count + 1, lastAction: Date.now() } };
    }
    saveState(action, actionCounts.value[action]);
  }

  const showClickHint = computed(() => {
    const s = actionCounts.value.click;
    return isStale(s) || s.count < HINT_SUPPRESS_THRESHOLD;
  });

  const showHoldHint = computed(() => {
    const s = actionCounts.value.hold;
    return isStale(s) || s.count < HINT_SUPPRESS_THRESHOLD;
  });

  const showDblClickHint = computed(() => {
    const s = actionCounts.value.dblclick;
    return isStale(s) || s.count < HINT_SUPPRESS_THRESHOLD;
  });

  return {
    recordAction,
    showClickHint,
    showHoldHint,
    showDblClickHint,
  };
}
