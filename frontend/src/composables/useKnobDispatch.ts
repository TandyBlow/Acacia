import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useNodeStore } from '../stores/nodeStore';
import { useAuthStore } from '../stores/authStore';

export function useKnobDispatch() {
  const nodeStore = useNodeStore();
  const authStore = useAuthStore();
  const {
    viewState,
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
    return (
      viewState.value === 'add' ||
      viewState.value === 'move' ||
      viewState.value === 'delete' ||
      viewState.value === 'logout'
    );
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
    if (viewState.value === 'logout') {
      const loggedOut = await authStore.logout();
      if (loggedOut) {
        nodeStore.clearForLogout();
        return;
      }
      nodeStore.cancelOperation();
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

  return { isBusy, inAuthMode, inConfirmMode, canConfirm, onHoldConfirm, onClick };
}
