import { ref, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useNodeStore } from '../stores/nodeStore';
import { useAuthStore } from '../stores/authStore';
import { useLogoutFlow } from './useLogoutFlow';

const isFeaturePanel = ref(false);

export type CompactMode = 'content' | 'nav' | 'feature';
const compactMode = ref<CompactMode>('content');
const isCompactLayout = ref(false);

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

  const { isLoggingOut, logoutUsername, startLogout, cancelLogout, confirmLogout } = useLogoutFlow();

  const isBusy = computed(() => nodeBusy.value || authBusy.value);
  const inAuthMode = computed(() => !isAuthenticated.value);
  const inConfirmMode = computed(() => {
    if (inAuthMode.value) return true;
    if (isFeaturePanel.value) return false;
    if (isLoggingOut.value) return true;
    return nodeStore.isEditState;
  });
  const canConfirm = computed(() => {
    if (inAuthMode.value) return canAuthSubmit.value;
    if (isLoggingOut.value) return true;
    return canNodeConfirm.value;
  });

  function openFeaturePanel(): void {
    isFeaturePanel.value = true;
  }

  function closeFeaturePanel(): void {
    isFeaturePanel.value = false;
  }

  async function onHoldConfirm(): Promise<void> {
    if (inAuthMode.value) {
      await authStore.submitByKnob();
      return;
    }
    if (isLoggingOut.value) {
      const loggedOut = await confirmLogout();
      if (!loggedOut) {
        cancelLogout();
      }
      return;
    }
    await nodeStore.confirmOperation();
  }

  async function onClick(): Promise<void> {
    if (inAuthMode.value) {
      authStore.toggleMode();
      return;
    }
    if (isFeaturePanel.value) {
      closeFeaturePanel();
      return;
    }
    if (isLoggingOut.value) {
      cancelLogout();
      return;
    }
    await nodeStore.onKnobClick();
  }

  async function onDoubleClick(): Promise<void> {
    if (inAuthMode.value || isBusy.value) return;
    if (isCompactLayout.value) {
      if (compactMode.value === 'content') {
        compactMode.value = 'nav';
      } else if (compactMode.value === 'nav') {
        compactMode.value = 'feature';
        openFeaturePanel();
      } else {
        compactMode.value = 'content';
        closeFeaturePanel();
      }
      return;
    }
    if (isFeaturePanel.value) {
      closeFeaturePanel();
    } else {
      openFeaturePanel();
    }
  }

  return {
    isBusy, inAuthMode, inConfirmMode, canConfirm,
    onHoldConfirm, onClick, onDoubleClick,
    isLoggingOut, logoutUsername, startLogout, cancelLogout,
    isFeaturePanel, openFeaturePanel, closeFeaturePanel,
    compactMode, isCompactLayout,
  };
}
