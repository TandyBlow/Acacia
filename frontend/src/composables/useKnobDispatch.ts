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

    // 确认操作 — confirmOperation 内部会通过 loadNode 触发转场
    await nodeStore.confirmOperation();
  }

  async function onClick(): Promise<void> {
    if (inAuthMode.value) {
      authStore.toggleMode();
      return;
    }
    if (isFeaturePanel.value) {
      // 关闭功能面板 — onKnobClick 内部会触发自己的转场
      closeFeaturePanel();
      await nodeStore.onKnobClick();
      return;
    }
    if (isLoggingOut.value) {
      cancelLogout();
      return;
    }

    // 展示模式 — 直接委托给 onKnobClick，它内部通过 loadNode 触发转场
    await nodeStore.onKnobClick();
  }

  async function onDoubleClick(): Promise<void> {
    if (inAuthMode.value || isBusy.value) return;

    const { startTransition } = usePageTransition();

    if (isCompactLayout.value) {
      if (compactMode.value === 'content') {
        startTransition({
          type: 'knob', action: 'doubleClick',
          setup: async () => { compactMode.value = 'nav'; },
        }, 'small');
      } else if (compactMode.value === 'nav') {
        startTransition({
          type: 'knob', action: 'doubleClick',
          setup: async () => { compactMode.value = 'feature'; openFeaturePanel(); },
        }, 'small');
      } else {
        startTransition({
          type: 'knob', action: 'doubleClick',
          setup: async () => { compactMode.value = 'content'; closeFeaturePanel(); },
        }, 'small');
      }
      return;
    }
    if (isFeaturePanel.value) {
      startTransition({
        type: 'knob', action: 'doubleClick',
        setup: async () => { closeFeaturePanel(); },
      }, 'large');
    } else {
      startTransition({
        type: 'knob', action: 'doubleClick',
        setup: async () => { openFeaturePanel(); },
      }, 'large');
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
