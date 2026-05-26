import { ref, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useNodeStore } from '../stores/nodeStore';
import { useAuthStore } from '../stores/authStore';
import type { LayoutType } from '../types/transition';

export type CompactMode = 'content' | 'nav';
const compactMode = ref<CompactMode>('content');
const layoutType = ref<LayoutType>('large');
const isCompactLayout = computed(() => layoutType.value === 'small');

export function useKnobDispatch() {
  const nodeStore = useNodeStore();
  const authStore = useAuthStore();
  const {
    canConfirm: canNodeConfirm,
    isBusy: nodeBusy,
  } = storeToRefs(nodeStore);
  const {
    isAuthenticated,
    canSubmit: canAuthSubmit,
    isBusy: authBusy,
  } = storeToRefs(authStore);

  const isBusy = computed(() => nodeBusy.value || authBusy.value);
  const inAuthMode = computed(() => !isAuthenticated.value);
  const inConfirmMode = computed(() => {
    if (inAuthMode.value) return true;
    return nodeStore.isEditState;
  });
  const canConfirm = computed(() => {
    if (inAuthMode.value) return canAuthSubmit.value;
    return canNodeConfirm.value;
  });

  async function onHoldConfirm(): Promise<void> {
    if (inAuthMode.value) {
      await authStore.submitByKnob();
      return;
    }
    await nodeStore.confirmOperation();
  }

  async function onClick(): Promise<void> {
    if (inAuthMode.value) {
      authStore.toggleMode();
      return;
    }
    await nodeStore.onKnobClick();
  }

  async function onDoubleClick(): Promise<void> {
    if (isCompactLayout.value) {
      compactMode.value = compactMode.value === 'content' ? 'nav' : 'content';
    }
  }

  return {
    isBusy, inAuthMode, inConfirmMode, canConfirm,
    onHoldConfirm, onClick, onDoubleClick,
    compactMode, isCompactLayout, layoutType,
  };
}
