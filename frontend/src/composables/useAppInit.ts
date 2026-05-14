import { computed, onMounted, provide, watch } from 'vue';
import { useAuthStore } from '../stores/authStore';
import { useNodeStore } from '../stores/nodeStore';
import { useStyleStore } from '../stores/styleStore';
import { preloadSkeleton } from './useTreeSkeleton';

export function useAppInit() {
  const authStore = useAuthStore();
  const nodeStore = useNodeStore();
  const styleStore = useStyleStore();

  const isBusy = computed(() => nodeStore.isBusy || authStore.isBusy);
  provide('isBusy', isBusy);

  onMounted(async () => {
    await authStore.initialize();
    if (authStore.isAuthenticated) {
      await nodeStore.initialize();
      nodeStore.checkDailyQuizStatus();
      preloadSkeleton();
      if (authStore.user?.id) {
        styleStore.fetchStyle(authStore.user.id);
      }
    }
  });

  watch(
    [() => authStore.initialized, () => authStore.isAuthenticated],
    async ([ready, authenticated], [_prevReady, prevAuthenticated]) => {
      if (!ready) {
        return;
      }
      if (authenticated && !prevAuthenticated) {
        await nodeStore.initialize();
        preloadSkeleton();
        if (authStore.user?.id) {
          styleStore.fetchStyle(authStore.user.id);
        }
      }
      if (!authenticated && prevAuthenticated) {
        styleStore.reset();
      }
    },
  );

  return { isBusy };
}