import { ref, computed, type Ref } from 'vue';
import type {
  RegionRegistration,
  TransitionTrigger,
  TransitionPhase,
  PageState,
} from '../types/transition';

const regions = new Map<string, RegionRegistration>();
const isTransitioning = ref(false);
const phase = ref<TransitionPhase>('idle');
const oldRegions = ref<Set<string>>(new Set());
const newRegions = ref<Set<string>>(new Set());

export function usePageTransition() {
  function registerRegion(registration: RegionRegistration): void {
    regions.set(registration.id, registration);
  }

  function unregisterRegion(id: string): void {
    regions.delete(id);
  }

  return {
    registerRegion,
    unregisterRegion,
    isTransitioning: computed(() => isTransitioning.value),
    currentPhase: computed(() => phase.value),
  };
}
