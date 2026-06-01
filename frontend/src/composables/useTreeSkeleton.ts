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

  async function fetchSkeleton(canvasW?: number, canvasH?: number): Promise<SkeletonData> {
    if (skeletonLoaded.value && skeletonData.value) {
      return skeletonData.value;
    }
    const userId = authStore.user?.id;
    if (!userId) throw new Error('Not authenticated');
    const adapter = getDataAdapter();
    if (!adapter.fetchTreeSkeleton) {
      const empty: SkeletonData = { branches: [], canvas_size: [canvasW ?? 512, canvasH ?? 512], trunk: null, ground: null, roots: null };
      skeletonData.value = empty;
      skeletonLoaded.value = true;
      return empty;
    }
    const result = await adapter.fetchTreeSkeleton(userId, canvasW, canvasH);
    skeletonData.value = result;
    skeletonLoaded.value = true;
    return result;
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

  return { busy, fetchSkeleton, onTestSakura, skeletonData, skeletonLoaded };
}

export function invalidateSkeleton(): void {
  skeletonData.value = null;
  skeletonLoaded.value = false;
}

/** Pre-set skeleton data so fetchSkeleton returns it without an API call. */
export function presetSkeleton(data: import('../types/tree').SkeletonData): void {
  skeletonData.value = data;
  skeletonLoaded.value = true;
}

export async function preloadSkeleton(): Promise<void> {
  if (skeletonLoaded.value) return;
  try {
    const { fetchSkeleton } = useTreeSkeleton();
    await fetchSkeleton();
  } catch (e) {
    console.error('[useTreeSkeleton] preloadSkeleton failed, TreeCanvas onMounted will retry:', e);
  }
}
