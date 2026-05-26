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


function _paramsEqual(a: Record<string, unknown> | null, b: Record<string, unknown> | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a).filter(k => k !== '_cached_at');
  const keysB = Object.keys(b).filter(k => k !== '_cached_at');
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const va = a[key];
    const vb = b[key];
    if (Array.isArray(va) && Array.isArray(vb)) {
      if (va.length !== vb.length || va.some((v, i) => Number(v).toFixed(4) !== Number(vb[i]).toFixed(4))) return false;
    } else if (typeof va === 'number' && typeof vb === 'number') {
      if (Number(va).toFixed(4) !== Number(vb).toFixed(4)) return false;
    } else if (va !== vb) {
      return false;
    }
  }
  return true;
}

function _preloadImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

export const useStyleStore = defineStore('style', () => {
  const style = ref<ThemeStyle>('default');
  const styleParams = ref<Record<string, unknown> | null>(null);
  const backgroundUrl = ref<string | null>(null);
  const distribution = ref<Record<string, number>>({});
  const loaded = ref(false);

  // Pending style — held until background image is preloaded, then applied with transition
  const pendingParams = ref<Record<string, unknown> | null>(null);
  const pendingStyle = ref<ThemeStyle>('default');
  const pendingBackgroundUrl = ref<string | null>(null);
  const isPendingReady = ref(false);

  let checkTimer: ReturnType<typeof setTimeout> | null = null;

  const themeClass = computed(() => '');

  function applyTheme(): void {
    const el = document.documentElement;

    const p = styleParams.value;
    // Only apply AI style overrides for non-default styles.
    // Default style uses the hardcoded CSS defaults in style.css.
    if (!p || style.value === 'default') {
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
    // Text colors: prefer dedicated fields, fall back to leaf colors for backwards compat
    const textPrimary = Array.isArray(p.textPrimaryColor) ? p.textPrimaryColor as number[] : leafMid;
    const textHint = Array.isArray(p.textHintColor) ? p.textHintColor as number[] : leafLight;
    const skyTop = Array.isArray(p.skyTopColor) ? p.skyTopColor as number[] : [0.5, 0.8, 0.9];
    const skyBottom = Array.isArray(p.skyBottomColor) ? p.skyBottomColor as number[] : [0.9, 0.9, 0.9];

    const primary = colorTupleToCSS(textPrimary);
    const hint = colorTupleToCSS(textHint);
    const glassBorderRgb = textPrimary.map((v) => Math.round(v * 255));
    const glassBgRgb = textPrimary.map((v) => Math.round(v * 255));
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
        backgroundUrl.value = data.backgroundUrl ?? null;
        styleParams.value = (data.params as Record<string, unknown>) ?? null;
        distribution.value = data.distribution ?? {};
        style.value = data.style ?? 'default';
      }
    } catch {
      // silent fallback
    } finally {
      loaded.value = true;
      applyTheme();
    }
  }

  function forceStyle(s: ThemeStyle, dist?: Record<string, number>, params?: Record<string, unknown>, bgUrl?: string | null): void {
    style.value = s;
    if (dist) distribution.value = dist;
    if (params) styleParams.value = params;
    if (bgUrl !== undefined) backgroundUrl.value = bgUrl;
    loaded.value = true;
    applyTheme();
  }

  function reset(): void {
    style.value = 'default';
    styleParams.value = null;
    backgroundUrl.value = null;
    distribution.value = {};
    loaded.value = false;
    applyTheme();
  }

  // ── Pending style + trigger ──────────────────────────────────────────

  function scheduleCheck(userId: string): void {
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      checkTimer = null;
      checkAndFetchStyle(userId);
    }, 30_000); // 30s debounce
  }

  async function checkAndFetchStyle(userId: string): Promise<void> {
    try {
      const adapter = getDataAdapter();
      await adapter.tagNodes?.(userId);
      const data = await adapter.fetchStyle?.(userId);
      if (!data) return;

      // Skip if same as current
      if (data.style === style.value && _paramsEqual(data.params as Record<string, unknown> | null, styleParams.value)) {
        return;
      }

      const bgUrl = data.backgroundUrl ?? null;

      // Preload background image if present
      if (bgUrl) {
        const loaded = await _preloadImage(bgUrl);
        if (!loaded) {
          console.warn('[styleStore] Background image preload failed, applying without new background');
        }
      }

      pendingParams.value = (data.params as Record<string, unknown>) ?? null;
      pendingStyle.value = data.style ?? 'default';
      pendingBackgroundUrl.value = bgUrl;
      isPendingReady.value = true;
    } catch {
      // silent fallback
    }
  }

  function applyPendingStyle(): void {
    style.value = pendingStyle.value;
    styleParams.value = pendingParams.value;
    backgroundUrl.value = pendingBackgroundUrl.value;
    distribution.value = {};  // distribution will be set by the next full fetch if needed

    pendingParams.value = null;
    pendingStyle.value = 'default';
    pendingBackgroundUrl.value = null;
    isPendingReady.value = false;

    loaded.value = true;
    applyTheme();
  }

  async function forceRegenerateStyle(userId: string): Promise<void> {
    try {
      const adapter = getDataAdapter();
      await adapter.tagNodes?.(userId);
      const data = await adapter.fetchStyle?.(userId, true);
      if (!data) return;

      const bgUrl = data.backgroundUrl ?? null;
      if (bgUrl) {
        await _preloadImage(bgUrl);
      }

      pendingParams.value = (data.params as Record<string, unknown>) ?? null;
      pendingStyle.value = data.style ?? 'default';
      pendingBackgroundUrl.value = bgUrl;
      isPendingReady.value = true;
    } catch {
      // silent fallback
    }
  }

  return { style, styleParams, backgroundUrl, distribution, loaded, pendingParams, pendingStyle, pendingBackgroundUrl, isPendingReady, themeClass, fetchStyle, forceStyle, reset, scheduleCheck, checkAndFetchStyle, applyPendingStyle, forceRegenerateStyle };
});
