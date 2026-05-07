/**
 * @deprecated This composable is deprecated and will be removed in a future version.
 * Use the page transition system (usePageTransition) instead for managing loading states.
 */

import { computed, ref } from 'vue';

const loadingSources = ref<Map<string, boolean>>(new Map());

export function useGlobalLoading() {
  const isLoading = computed(() => {
    return Array.from(loadingSources.value.values()).some(active => active);
  });

  function registerLoadingSource(id: string) {
    loadingSources.value.set(id, false);
  }

  function setLoading(id: string, loading: boolean) {
    if (loadingSources.value.has(id)) {
      loadingSources.value.set(id, loading);
    }
  }

  function unregisterLoadingSource(id: string) {
    loadingSources.value.delete(id);
  }

  return {
    isLoading,
    registerLoadingSource,
    setLoading,
    unregisterLoadingSource,
  };
}
