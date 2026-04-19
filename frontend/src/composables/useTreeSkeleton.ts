import { ref } from 'vue';
import { useAuthStore } from '../stores/authStore';
import { useStyleStore } from '../stores/styleStore';
import { dataAdapter } from '../adapters';
import { supabase } from '../api/supabase';
import type { SkeletonData } from '../types/tree';

export function useTreeSkeleton() {
  const authStore = useAuthStore();
  const styleStore = useStyleStore();
  const busy = ref(false);

  async function fetchSkeleton(): Promise<SkeletonData> {
    const userId = authStore.user?.id;
    if (!userId) throw new Error('Not authenticated');
    return dataAdapter.fetchTreeSkeleton(userId);
  }

  async function onTagNodes(): Promise<void> {
    const userId = authStore.user?.id;
    if (!userId) return;
    busy.value = true;
    try {
      await styleStore.fetchStyle(userId);
    } finally {
      busy.value = false;
    }
  }

  async function onTestSakura(): Promise<void> {
    const userId = authStore.user?.id;
    if (!userId || !supabase) return;
    busy.value = true;
    try {
      const { data } = await supabase
        .from('nodes')
        .select('id')
        .eq('owner_id', userId)
        .eq('is_deleted', false);
      if (data) {
        for (const row of data) {
          await supabase.from('nodes').update({ domain_tag: '日本文化' }).eq('id', row.id);
        }
      }
      await styleStore.fetchStyle(userId);
    } finally {
      busy.value = false;
    }
  }

  return { busy, fetchSkeleton, onTagNodes, onTestSakura };
}
