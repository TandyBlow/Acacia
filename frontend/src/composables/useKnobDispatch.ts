import { ref, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useNodeStore } from '../stores/nodeStore';
import { useAuthStore } from '../stores/authStore';
import { useLogoutFlow } from './useLogoutFlow';
import { usePageTransition } from './usePageTransition';

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

    // 触发页面转换（如果确认操作会改变界面）
    const { startTransition } = usePageTransition();
    startTransition({ type: 'knob', action: 'hold' }, isCompactLayout.value ? 'small' : 'large');

    await nodeStore.confirmOperation();
  }

  async function onClick(): Promise<void> {
    if (inAuthMode.value) {
      authStore.toggleMode();
      return;
    }
    if (isFeaturePanel.value) {
      // 触发页面转换
      const { startTransition } = usePageTransition();
      startTransition({ type: 'knob', action: 'click' }, isCompactLayout.value ? 'small' : 'large');

      closeFeaturePanel();
      return;
    }
    if (isLoggingOut.value) {
      cancelLogout();
      return;
    }

    // 触发页面转换（如果点击会改变界面）
    const { startTransition } = usePageTransition();
    startTransition({ type: 'knob', action: 'click' }, isCompactLayout.value ? 'small' : 'large');

    await nodeStore.onKnobClick();
  }

  async function onDoubleClick(): Promise<void> {
    if (inAuthMode.value || isBusy.value) return;

    // 触发页面转换
    const { startTransition } = usePageTransition();

    if (isCompactLayout.value) {
      if (compactMode.value === 'content') {
        startTransition({ type: 'knob', action: 'doubleClick' }, 'small');
        compactMode.value = 'nav';
      } else if (compactMode.value === 'nav') {
        startTransition({ type: 'knob', action: 'doubleClick' }, 'small');
        compactMode.value = 'feature';
        openFeaturePanel();
      } else {
        startTransition({ type: 'knob', action: 'doubleClick' }, 'small');
        compactMode.value = 'content';
        closeFeaturePanel();
      }
      return;
    }
    if (isFeaturePanel.value) {
      startTransition({ type: 'knob', action: 'doubleClick' }, 'large');
      closeFeaturePanel();
    } else {
      startTransition({ type: 'knob', action: 'doubleClick' }, 'large');
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
