import { ref } from 'vue';

export type OfficialTransitionPhase = 'idle' | 'sinking' | 'sliding' | 'anchor-sliding' | 'rising';

const phase = ref<OfficialTransitionPhase>('idle');
const animating = ref(false);
const animToken = ref(0);
const anchorItemId = ref<string | null>(null);
const clickedItemId = ref<string | null>(null);
const anchorDeltaY = ref(0);
const anchorPrep = ref(false);
const hideNonAnchorItems = ref(false);
const anchorItemAction = ref<(() => void) | null>(null);

function reset() {
  phase.value = 'idle';
  animating.value = false;
  animToken.value = 0;
  anchorItemId.value = null;
  clickedItemId.value = null;
  anchorDeltaY.value = 0;
  anchorPrep.value = false;
  hideNonAnchorItems.value = false;
  anchorItemAction.value = null;
}

export function useOfficialTransition() {
  return {
    phase,
    animating,
    animToken,
    anchorItemId,
    clickedItemId,
    anchorDeltaY,
    anchorPrep,
    hideNonAnchorItems,
    anchorItemAction,
    reset,
  };
}
