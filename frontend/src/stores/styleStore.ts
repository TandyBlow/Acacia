import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import { getDataAdapter } from './nodeStore';
import type { StyleResult } from '../types/node';

export type ThemeStyle = string;

function _linearize(c: number): number {
  if (c <= 0.04045) return c / 12.92;
  return Math.pow((c + 0.055) / 1.055, 2.4);
}

function _relativeLuminance(rgb: number[]): number {
  return 0.2126 * _linearize(rgb[0]!)
       + 0.7152 * _linearize(rgb[1]!)
       + 0.0722 * _linearize(rgb[2]!);
}

function _contrastRatio(lum1: number, lum2: number): number {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

const MIN_CONTRAST_AGAINST_WHITE = 4.5;
const WHITE_LUMINANCE = 1.0;

function _ensureContrastAgainstWhite(rgb: number[]): number[] {
  const textLum = _relativeLuminance(rgb);
  if (_contrastRatio(textLum, WHITE_LUMINANCE) >= MIN_CONTRAST_AGAINST_WHITE) {
    return rgb;
  }
  let lo = 0.0, hi = 1.0;
  let best = [...rgb];
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const blended = [rgb[0]! * (1 - mid), rgb[1]! * (1 - mid), rgb[2]! * (1 - mid)];
    if (_contrastRatio(_relativeLuminance(blended), WHITE_LUMINANCE) >= MIN_CONTRAST_AGAINST_WHITE) {
      best = blended;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best.map(v => Math.round(v * 10000) / 10000);
}

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

async function _tryRecoverBgUrl(userId: string): Promise<string | null> {
  const fallbackUrl = `/backgrounds/ai/${userId}.png`;
  const ok = await _preloadImage(fallbackUrl);
  return ok ? fallbackUrl : null;
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

  // Generation polling
  const generating = ref(false);
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollGeneration = 0;
  const POLL_INTERVAL = 3000; // 3s
  const POLL_MAX_MS = 360_000; // 6 min (covers 300s image + 60s LLM)

  const styleLocked = ref(false);

  const themeClass = computed(() => '');

  function applyTheme(): void {
    const el = document.documentElement;

    const p = styleParams.value;
    if (!p || style.value === 'default') {
      el.style.removeProperty('--color-primary');
      el.style.removeProperty('--color-hint');
      el.style.removeProperty('--color-primary-on-light');
      el.style.removeProperty('--color-hint-on-light');
      el.style.removeProperty('--color-glass-border');
      el.style.removeProperty('--color-glass-bg');
      el.style.removeProperty('--shadow-inset-a');
      el.style.removeProperty('--shadow-inset-b');
      el.style.removeProperty('--shadow-raised-a');
      el.style.removeProperty('--shadow-raised-b');
      el.style.removeProperty('--bg-gradient');
      document.body.style.background = 'linear-gradient(180deg, #ffffff 0%, #eefaff 20%, #bfefff 55%, #66ccff 100%)';
      return;
    }

    const leafMid = Array.isArray(p.leafMidColor) ? p.leafMidColor as number[] : [0.4, 0.5, 0.4];
    const leafLight = Array.isArray(p.leafLightColor) ? p.leafLightColor as number[] : [0.6, 0.7, 0.5];
    const textPrimary = Array.isArray(p.textPrimaryColor) ? p.textPrimaryColor as number[] : leafMid;
    const textHint = Array.isArray(p.textHintColor) ? p.textHintColor as number[] : leafLight;
    const skyBottom = Array.isArray(p.skyBottomColor) ? p.skyBottomColor as number[] : [0.9, 0.9, 0.9];

    const primary = colorTupleToCSS(textPrimary);
    const hint = colorTupleToCSS(textHint);
    const glassBorderRgb = textPrimary.map((v) => Math.round(v * 255));
    const glassBgRgb = textPrimary.map((v) => Math.round(v * 255));
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
      `linear-gradient(180deg, #ffffff 0%, rgb(${skyBottomRgb.join(',')}) 55%, rgb(${skyBottomRgb.join(',')}) 100%)`,
    );
    document.body.style.background = `linear-gradient(180deg, #ffffff 0%, rgb(${skyBottomRgb.join(',')}) 55%, rgb(${skyBottomRgb.join(',')}) 100%)`;
    const primaryOnLight = _ensureContrastAgainstWhite(textPrimary);
    const hintOnLight = _ensureContrastAgainstWhite(textHint);
    el.style.setProperty('--color-primary-on-light', colorTupleToCSS(primaryOnLight));
    el.style.setProperty('--color-hint-on-light', colorTupleToCSS(hintOnLight));
  }

  async function _waitForStyleGeneration(userId: string): Promise<StyleResult | null> {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    generating.value = true;
    const gen = ++pollGeneration;
    const deadline = Date.now() + POLL_MAX_MS;

    console.log('[styleStore] 开始轮询等待风格生成完成 (最长6分钟, 每3秒一次)...');

    let pollCount = 0;
    while (Date.now() < deadline) {
      await new Promise<void>(r => {
        pollTimer = setTimeout(r, POLL_INTERVAL);
      });
      pollTimer = null;
      pollCount++;

      if (gen !== pollGeneration) return null;

      try {
        const adapter = getDataAdapter();
        const data = await adapter.fetchStyle?.(userId);
        if (data && !data.generating) {
          console.log(`[styleStore] 轮询 #${pollCount} — 生成完成! style="${data.style}", backgroundUrl="${data.backgroundUrl}", bgError="${data.bgError || 'none'}"`);
          generating.value = false;
          return data;
        }
        console.log(`[styleStore] 轮询 #${pollCount} — 仍在生成中...`);
      } catch (e) {
        console.warn(`[styleStore] 轮询 #${pollCount} — 网络错误, 继续等待:`, e);
      }
    }

    console.warn('[styleStore] 轮询超时 — 6分钟内风格未生成完成');
    generating.value = false;
    return null;
  }

  async function fetchStyle(userId: string): Promise<void> {
    try {
      const adapter = getDataAdapter();
      await adapter.tagNodes?.(userId);
      const resp = await adapter.fetchStyle?.(userId);
      if (!resp) {
        console.warn('[styleStore] fetchStyle — 后端返回空响应');
        return;
      }

      console.log(`[styleStore] fetchStyle 响应: generating=${resp.generating}, style="${resp.style}", backgroundUrl="${resp.backgroundUrl}", bgError="${resp.bgError || 'none'}", hasParams=${!!resp.params}`);

      // If generation is in progress, poll until it completes
      if (resp.generating) {
        console.log('[styleStore] 后台正在生成风格，等待完成...');
      }

      // If generation is in progress, poll until it completes
      const data = resp.generating ? await _waitForStyleGeneration(userId) : resp;
      if (!data) return;

      const bgUrl = data.backgroundUrl ?? null;
      const newStyle = data.style ?? 'default';

      // Non-default styles require a background image; try disk fallback if missing
      if (newStyle !== 'default') {
        console.log(`[styleStore] 初始加载: AI风格 "${newStyle}", 检查背景图...`);
        const resolvedBgUrl = bgUrl ?? await _tryRecoverBgUrl(userId);
        if (!resolvedBgUrl) {
          console.warn(`[styleStore] 初始加载: 无背景图URL, 保持default风格. bgUrl=${bgUrl}, bgError="${data.bgError || 'none'}", 磁盘恢复也失败`);
        } else {
          const ok = await _preloadImage(resolvedBgUrl);
          if (!ok) {
            console.warn(`[styleStore] 初始加载: 背景图预加载失败 url=${resolvedBgUrl}, 保持default风格`);
          } else {
            console.log(`[styleStore] 初始加载: 背景图就绪, 应用AI风格 "${newStyle}"`);
            backgroundUrl.value = resolvedBgUrl;
            styleParams.value = (data.params as Record<string, unknown>) ?? null;
            distribution.value = data.distribution ?? {};
            style.value = newStyle;
          }
        }
      } else {
        console.log(`[styleStore] 初始加载: default风格`);
        backgroundUrl.value = bgUrl;
        styleParams.value = (data.params as Record<string, unknown>) ?? null;
        distribution.value = data.distribution ?? {};
        style.value = newStyle;
      }
    } catch (e) {
      console.warn('[styleStore] fetchStyle 异常:', e);
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

  function resetAndLock(): void {
    styleLocked.value = true;
    reset();
  }

  // ── Pending style + trigger ──────────────────────────────────────────

  function scheduleCheck(userId: string): void {
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      checkTimer = null;
      checkAndFetchStyle(userId);
    }, 30_000);
  }

  async function checkAndFetchStyle(userId: string): Promise<void> {
    if (styleLocked.value) return;
    try {
      const adapter = getDataAdapter();
      await adapter.tagNodes?.(userId);
      const resp = await adapter.fetchStyle?.(userId);
      if (!resp) return;

      console.log(`[styleStore] checkAndFetch 响应: generating=${resp.generating}, style="${resp.style}", backgroundUrl="${resp.backgroundUrl}", bgError="${resp.bgError || 'none'}", hasParams=${!!resp.params}`);

      // If generation is in progress, poll until it completes
      const data = resp.generating ? await _waitForStyleGeneration(userId) : resp;
      if (!data) return;

      // Skip if same as current
      if (data.style === style.value && _paramsEqual(data.params as Record<string, unknown> | null, styleParams.value)) {
        console.log(`[styleStore] checkAndFetch: 风格未变, 跳过 ("${data.style}")`);
        return;
      }

      const newStyle = data.style ?? 'default';
      console.log(`[styleStore] checkAndFetch: 新风格 "${newStyle}" (当前 "${style.value}")`);

      const bgUrl = data.backgroundUrl ?? null;
      let resolvedBgUrl = bgUrl;

      // Non-default styles require a background image; try disk fallback if missing
      if (newStyle !== 'default') {
        resolvedBgUrl = bgUrl ?? await _tryRecoverBgUrl(userId);
        if (!resolvedBgUrl) {
          console.warn(`[styleStore] checkAndFetch: 无背景图URL, 放弃切换. bgUrl=${bgUrl}, bgError="${data.bgError || 'none'}"`);
          return;
        }
        const ok = await _preloadImage(resolvedBgUrl);
        if (!ok) {
          console.warn(`[styleStore] checkAndFetch: 背景图预加载失败 url=${resolvedBgUrl}, 放弃切换`);
          return;
        }
      }

      console.log(`[styleStore] checkAndFetch: 背景图就绪, 准备过渡到 "${newStyle}"`);
      pendingParams.value = (data.params as Record<string, unknown>) ?? null;
      pendingStyle.value = newStyle;
      pendingBackgroundUrl.value = resolvedBgUrl;
      isPendingReady.value = true;
    } catch (e) {
      console.warn('[styleStore] checkAndFetch 异常:', e);
    }
  }

  function applyPendingStyle(): void {
    const prevStyle = style.value;
    style.value = pendingStyle.value;
    styleParams.value = pendingParams.value;
    backgroundUrl.value = pendingBackgroundUrl.value;
    distribution.value = {};

    pendingParams.value = null;
    pendingStyle.value = 'default';
    pendingBackgroundUrl.value = null;
    isPendingReady.value = false;

    loaded.value = true;
    applyTheme();
    console.log(`[styleStore] 风格切换完成: "${prevStyle}" → "${style.value}"`);
  }

  async function forceRegenerateStyle(userId: string): Promise<void> {
    try {
      console.log('[styleStore] forceRegenerate: 开始强制重新生成...');
      const adapter = getDataAdapter();
      await adapter.tagNodes?.(userId);
      const resp = await adapter.fetchStyle?.(userId, true);
      if (!resp) return;

      console.log(`[styleStore] forceRegenerate 响应: generating=${resp.generating}, style="${resp.style}", backgroundUrl="${resp.backgroundUrl}", bgError="${resp.bgError || 'none'}"`);

      // If another generation is already in progress, wait for it
      const data = resp.generating ? await _waitForStyleGeneration(userId) : resp;
      if (!data) return;

      const bgUrl = data.backgroundUrl ?? null;
      const newStyle = data.style ?? 'default';
      let resolvedBgUrl = bgUrl;

      // Non-default styles require a background image; try disk fallback if missing
      if (newStyle !== 'default') {
        resolvedBgUrl = bgUrl ?? await _tryRecoverBgUrl(userId);
        if (!resolvedBgUrl) {
          console.warn(`[styleStore] forceRegenerate: 无背景图URL, 放弃. bgUrl=${bgUrl}, bgError="${data.bgError || 'none'}"`);
          return;
        }
        const ok = await _preloadImage(resolvedBgUrl);
        if (!ok) {
          console.warn(`[styleStore] forceRegenerate: 背景图预加载失败 url=${resolvedBgUrl}, 放弃`);
          return;
        }
      }

      console.log(`[styleStore] forceRegenerate: 背景图就绪, 准备过渡到 "${newStyle}"`);
      pendingParams.value = (data.params as Record<string, unknown>) ?? null;
      pendingStyle.value = newStyle;
      pendingBackgroundUrl.value = resolvedBgUrl;
      isPendingReady.value = true;
    } catch (e) {
      console.warn('[styleStore] forceRegenerate 异常:', e);
    }
  }

  return { style, styleParams, backgroundUrl, distribution, loaded, generating, styleLocked, pendingParams, pendingStyle, pendingBackgroundUrl, isPendingReady, themeClass, applyTheme, fetchStyle, forceStyle, reset, resetAndLock, scheduleCheck, checkAndFetchStyle, applyPendingStyle, forceRegenerateStyle };
});
