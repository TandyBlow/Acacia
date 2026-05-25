import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import { getDataAdapter } from './nodeStore';

export type ThemeStyle = string;

function colorTupleToCSS(rgb: unknown): string {
  if (Array.isArray(rgb) && rgb.length >= 3) {
    const [r, g, b] = rgb.map((v) => Math.round(Number(v) * 255));
    return `rgb(${r},${g},${b})`;
  }
  return 'rgb(102,128,255)';
}

function hexFromTuple(rgb: unknown, alpha = 1): string {
  if (Array.isArray(rgb) && rgb.length >= 3) {
    const [r, g, b] = rgb.map((v) => Math.round(Number(v) * 255));
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return `rgba(102,128,255,${alpha})`;
}

export const useStyleStore = defineStore('style', () => {
  const style = ref<ThemeStyle>('default');
  const styleParams = ref<Record<string, unknown> | null>(null);
  const distribution = ref<Record<string, number>>({});
  const loaded = ref(false);

  const themeClass = computed(() => '');

  function applyTheme(): void {
    const el = document.documentElement;
    el.classList.remove('theme-sakura', 'theme-cyberpunk', 'theme-ink');

    const p = styleParams.value;
    if (!p) {
      el.style.removeProperty('--color-primary');
      el.style.removeProperty('--color-hint');
      el.style.removeProperty('--color-glass-border');
      el.style.removeProperty('--color-glass-bg');
      el.style.removeProperty('--shadow-inset-a');
      el.style.removeProperty('--shadow-inset-b');
      el.style.removeProperty('--shadow-raised-a');
      el.style.removeProperty('--shadow-raised-b');
      el.style.removeProperty('--bg-gradient');
      return;
    }

    const leafMid = Array.isArray(p.leafMidColor) ? p.leafMidColor as number[] : [0.4, 0.5, 0.4];
    const leafLight = Array.isArray(p.leafLightColor) ? p.leafLightColor as number[] : [0.6, 0.7, 0.5];
    const skyTop = Array.isArray(p.skyTopColor) ? p.skyTopColor as number[] : [0.5, 0.8, 0.9];
    const skyBottom = Array.isArray(p.skyBottomColor) ? p.skyBottomColor as number[] : [0.9, 0.9, 0.9];

    const primary = colorTupleToCSS(leafMid);
    const hint = colorTupleToCSS(leafLight);
    const glassBorderRgb = leafMid.map((v) => Math.round(v * 255));
    const glassBgRgb = leafMid.map((v) => Math.round(v * 255));
    const skyTopRgb = skyTop.map((v) => Math.round(v * 255));
    const skyBottomRgb = skyBottom.map((v) => Math.round(v * 255));

    el.style.setProperty('--color-primary', primary);
    el.style.setProperty('--color-hint', hint);
    el.style.setProperty('--color-glass-border', `rgba(${glassBorderRgb.join(',')},0.28)`);
    el.style.setProperty('--color-glass-bg', `rgba(${glassBgRgb.join(',')},0.12)`);
    el.style.setProperty('--shadow-inset-a', `rgba(${glassBorderRgb.map((v) => Math.round(v * 0.4)).join(',')},0.56)`);
    el.style.setProperty('--shadow-inset-b', `rgba(${glassBorderRgb.map((v) => Math.round(v * 0.8 + 60)).join(',')},0.52)`);
    el.style.setProperty('--shadow-raised-a', `rgba(${glassBorderRgb.join(',')},0.14)`);
    el.style.setProperty('--shadow-raised-b', 'rgba(255,255,255,0.28)');
    el.style.setProperty(
      '--bg-gradient',
      `linear-gradient(180deg, rgb(${skyTopRgb.join(',')}) 0%, rgb(${skyBottomRgb.join(',')}) 55%, rgb(${skyBottomRgb.join(',')}) 100%)`,
    );
  }

  async function fetchStyle(userId: string): Promise<void> {
    try {
      const adapter = getDataAdapter();
      await adapter.tagNodes?.(userId);
      const data = await adapter.fetchStyle?.(userId);
      if (data) {
        style.value = data.style ?? 'default';
        distribution.value = data.distribution ?? {};
        styleParams.value = (data.params as Record<string, unknown>) ?? null;
      }
    } catch {
      // silent fallback
    } finally {
      loaded.value = true;
      applyTheme();
    }
  }

  function forceStyle(s: ThemeStyle, dist?: Record<string, number>, params?: Record<string, unknown>): void {
    style.value = s;
    if (dist) distribution.value = dist;
    if (params) styleParams.value = params;
    loaded.value = true;
    applyTheme();
  }

  function reset(): void {
    style.value = 'default';
    styleParams.value = null;
    distribution.value = {};
    loaded.value = false;
    applyTheme();
  }

  return { style, styleParams, distribution, loaded, themeClass, fetchStyle, forceStyle, reset };
});
