import { ref } from 'vue';
import { useAuthStore } from '../stores/authStore';
import { useStyleStore } from '../stores/styleStore';
import { getDataAdapter } from '../stores/nodeStore';
import type { SkeletonData } from '../types/tree';

const skeletonData = ref<SkeletonData | null>(null);
const skeletonLoaded = ref(false);

export function useTreeSkeleton() {
  const authStore = useAuthStore();
  const styleStore = useStyleStore();
  const busy = ref(false);

  async function fetchSkeleton(): Promise<SkeletonData> {
    if (skeletonLoaded.value && skeletonData.value) {
      return skeletonData.value;
    }
    const userId = authStore.user?.id;
    if (!userId) throw new Error('Not authenticated');
    const adapter = getDataAdapter();
    if (!adapter.fetchTreeSkeleton) {
      const empty: SkeletonData = { branches: [], canvas_size: [512, 512], trunk: null, ground: null, roots: null };
      skeletonData.value = empty;
      skeletonLoaded.value = true;
      return empty;
    }
    const result = await adapter.fetchTreeSkeleton(userId);
    skeletonData.value = result;
    skeletonLoaded.value = true;
    return result;
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

  return { busy, fetchSkeleton, onTagNodes, onTestSakura, skeletonData, skeletonLoaded };
}

export function invalidateSkeleton(): void {
  skeletonData.value = null;
  skeletonLoaded.value = false;
}

export async function preloadSkeleton(): Promise<void> {
  if (skeletonLoaded.value) return;
  try {
    const { fetchSkeleton } = useTreeSkeleton();
    await fetchSkeleton();
  } catch {
    // silent — TreeCanvas onMounted will retry
  }
}
