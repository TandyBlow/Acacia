import { ref, computed } from 'vue';
import { defineStore } from 'pinia';

export type ThemeStyle = 'default' | 'sakura' | 'cyberpunk' | 'ink';

export const useStyleStore = defineStore('style', () => {
  const style = ref<ThemeStyle>('default');
  const distribution = ref<Record<string, number>>({});
  const loaded = ref(false);

  const themeClass = computed(() =>
    style.value === 'default' ? '' : `theme-${style.value}`,
  );

  function applyTheme(): void {
    const el = document.documentElement;
    el.classList.remove('theme-sakura', 'theme-cyberpunk', 'theme-ink');
    if (themeClass.value) {
      el.classList.add(themeClass.value);
    }
  }

  async function fetchStyle(userId: string): Promise<void> {
    const baseUrl = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:7860';

    try {
      await fetch(`${baseUrl}/tag-nodes/${userId}`, { method: 'POST' });

      const res = await fetch(`${baseUrl}/style/${userId}`);
      if (!res.ok) return;

      const data = await res.json();
      style.value = (data.style as ThemeStyle) ?? 'default';
      distribution.value = data.distribution ?? {};
    } catch {
      // silent fallback — keep default theme
    } finally {
      loaded.value = true;
      applyTheme();
    }
  }

  function forceStyle(s: ThemeStyle, dist?: Record<string, number>): void {
    style.value = s;
    if (dist) distribution.value = dist;
    loaded.value = true;
    applyTheme();
  }

  function reset(): void {
    style.value = 'default';
    distribution.value = {};
    loaded.value = false;
    applyTheme();
  }

  return { style, distribution, loaded, themeClass, fetchStyle, forceStyle, reset };
});
