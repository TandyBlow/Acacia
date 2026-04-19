import { computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '../stores/authStore';
import { useNodeStore } from '../stores/nodeStore';
import { useStyleStore } from '../stores/styleStore';

export function useAppInit() {
  const authStore = useAuthStore();
  const nodeStore = useNodeStore();
  const styleStore = useStyleStore();
  const route = useRoute();

  const isBusy = computed(() => nodeStore.isBusy || authStore.isBusy);

  onMounted(async () => {
    await authStore.initialize();
    if (authStore.isAuthenticated) {
      await nodeStore.initialize();
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
        if (authStore.user?.id) {
          styleStore.fetchStyle(authStore.user.id);
        }
      }
      if (!authenticated && prevAuthenticated) {
        styleStore.reset();
      }
    },
  );

  watch(
    () => route.params.id as string | undefined,
    (id) => {
      if (!authStore.isAuthenticated) {
        return;
      }
      const nodeId = id ?? null;
      void nodeStore.syncFromRoute(nodeId);
    },
  );

  return { isBusy };
}
