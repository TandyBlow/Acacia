import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useNodeStore } from '../stores/nodeStore';
import { useAuthStore } from '../stores/authStore';
import { useLogoutFlow } from './useLogoutFlow';

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

  const { isLoggingOut, startLogout, cancelLogout, confirmLogout } = useLogoutFlow();

  const isBusy = computed(() => nodeBusy.value || authBusy.value);
  const inAuthMode = computed(() => !isAuthenticated.value);
  const inConfirmMode = computed(() => {
    if (inAuthMode.value) return true;
    if (isLoggingOut.value) return true;
    return nodeStore.isEditState;
  });
  const canConfirm = computed(() => {
    if (inAuthMode.value) return canAuthSubmit.value;
    if (isLoggingOut.value) return true;
    return canNodeConfirm.value;
  });

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
    if (isLoggingOut.value) {
      cancelLogout();
      return;
    }
    await nodeStore.onKnobClick();
  }

  return { isBusy, inAuthMode, inConfirmMode, canConfirm, onHoldConfirm, onClick, isLoggingOut, startLogout, cancelLogout };
}
