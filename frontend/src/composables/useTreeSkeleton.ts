import { ref } from 'vue';
import { useAuthStore } from '../stores/authStore';
import { useStyleStore } from '../stores/styleStore';
import { getDataAdapter } from '../stores/nodeStore';
import type { SkeletonData } from '../types/tree';

export function useTreeSkeleton() {
  const authStore = useAuthStore();
  const styleStore = useStyleStore();
  const busy = ref(false);

  async function fetchSkeleton(): Promise<SkeletonData> {
    const userId = authStore.user?.id;
    if (!userId) throw new Error('Not authenticated');
    const adapter = getDataAdapter();
    if (!adapter.fetchTreeSkeleton) {
      return { branches: [], canvas_size: [512, 512], trunk: null, ground: null, roots: null };
    }
    return adapter.fetchTreeSkeleton(userId);
  }

  async function onTagNodes(): Promise<void> {
    const userId = authStore.user?.id;
    if (!userId) return;
    busy.value = true;
    try {
      const adapter = getDataAdapter();
      await adapter.tagNodes?.(userId);
      await styleStore.fetchStyle(userId);
    } finally {
      busy.value = false;
    }
  }

  async function onTestSakura(): Promise<void> {
    const userId = authStore.user?.id;
    if (!userId) return;
    busy.value = true;
    try {
      const adapter = getDataAdapter();
      await adapter.testSakuraTag?.(userId);
      await styleStore.fetchStyle(userId);
    } finally {
      busy.value = false;
    }
  }

  return { busy, fetchSkeleton, onTagNodes, onTestSakura };
}
