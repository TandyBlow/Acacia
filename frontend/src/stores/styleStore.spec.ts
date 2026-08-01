// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { DataAdapter, StyleResult } from '../types/node';

vi.mock('./styleDom', () => ({
  applyThemeToDOM: vi.fn(),
  applyParamsToDOM: vi.fn(),
  resetParamsToDOM: vi.fn(),
}));

vi.mock('./styleParams', () => ({
  paramsEqual: vi.fn(),
  tryRecoverBgUrl: vi.fn(),
  preloadImage: vi.fn(),
}));

import { applyParamsToDOM, applyThemeToDOM, resetParamsToDOM } from './styleDom';
import { paramsEqual, preloadImage, tryRecoverBgUrl } from './styleParams';
import { setDataAdapter } from './nodeStore';
import { useStyleStore } from './styleStore';

const mockAdapter = {
  tagNodes: vi.fn<(userId: string) => Promise<void>>(async () => {}),
  fetchStyle: vi.fn<(userId: string, force?: boolean) => Promise<StyleResult | undefined>>(),
  testSakuraTag: vi.fn(),
};

describe('useStyleStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.resetAllMocks();
    setDataAdapter(mockAdapter as unknown as DataAdapter);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes initial state defaults', () => {
    const store = useStyleStore();
    expect(store.themeClass).toBe('');
    expect(store.generating).toBe(false);
    expect(store.style).toBe('default');
    expect(store.styleParams).toBeNull();
    expect(store.backgroundUrl).toBeNull();
    expect(store.distribution).toEqual({});
    expect(store.loaded).toBe(false);
    expect(store.isPendingReady).toBe(false);
    expect(store.styleLocked).toBe(false);
  });

  describe('forceStyle / reset / applyPendingStyle', () => {
    it('forceStyle writes all state and applies theme', () => {
      const store = useStyleStore();
      store.forceStyle('aurora', { a: 1 }, { p: 1 }, 'http://bg');

      expect(store.style).toBe('aurora');
      expect(store.distribution).toEqual({ a: 1 });
      expect(store.styleParams).toEqual({ p: 1 });
      expect(store.backgroundUrl).toBe('http://bg');
      expect(store.loaded).toBe(true);
      expect(applyThemeToDOM).toHaveBeenCalledWith('aurora', { p: 1 });
    });

    it('forceStyle works with style-only arguments', () => {
      const store = useStyleStore();
      store.forceStyle('aurora');
      expect(store.style).toBe('aurora');
      expect(store.distribution).toEqual({});
      expect(store.styleParams).toBeNull();
    });

    it('reset returns to default state and applies theme', () => {
      const store = useStyleStore();
      store.forceStyle('aurora', { a: 1 }, { p: 1 }, 'http://bg');
      store.reset();

      expect(store.style).toBe('default');
      expect(store.styleParams).toBeNull();
      expect(store.backgroundUrl).toBeNull();
      expect(store.distribution).toEqual({});
      expect(store.loaded).toBe(false);
      expect(applyThemeToDOM).toHaveBeenCalledWith('default', null);
    });

    it('resetAndLock locks the style and resets state', () => {
      const store = useStyleStore();
      store.forceStyle('aurora', { a: 1 }, { p: 1 }, 'http://bg');
      store.resetAndLock();

      expect(store.styleLocked).toBe(true);
      expect(store.style).toBe('default');
      expect(store.loaded).toBe(false);
    });

    it('applyPendingStyle commits pending values and clears the pending slot', () => {
      const store = useStyleStore();
      store.pendingStyle = 'aurora';
      store.pendingParams = { p: 1 };
      store.pendingBackgroundUrl = 'http://bg';
      store.isPendingReady = true;

      store.applyPendingStyle();

      expect(store.style).toBe('aurora');
      expect(store.styleParams).toEqual({ p: 1 });
      expect(store.backgroundUrl).toBe('http://bg');
      expect(store.distribution).toEqual({});
      expect(store.pendingStyle).toBe('default');
      expect(store.pendingParams).toBeNull();
      expect(store.pendingBackgroundUrl).toBeNull();
      expect(store.isPendingReady).toBe(false);
      expect(store.loaded).toBe(true);
      expect(applyThemeToDOM).toHaveBeenCalledWith('aurora', { p: 1 });
    });

    it('applyThemeFromParams forwards params to the DOM applier', () => {
      const store = useStyleStore();
      const params = { leafMidColor: [0.5, 0.5, 0.5] };
      store.applyThemeFromParams(params);
      expect(applyParamsToDOM).toHaveBeenCalledWith(params);
    });
  });

  describe('fetchStyle', () => {
    it('applies a default style directly', async () => {
      mockAdapter.fetchStyle!.mockResolvedValue({
        style: 'default',
        distribution: { a: 1 },
        params: { p: 1 },
        backgroundUrl: null,
      });
      const store = useStyleStore();

      await store.fetchStyle('u1');

      expect(mockAdapter.tagNodes).toHaveBeenCalledWith('u1');
      expect(mockAdapter.fetchStyle).toHaveBeenCalledWith('u1');
      expect(store.style).toBe('default');
      expect(store.styleParams).toEqual({ p: 1 });
      expect(store.distribution).toEqual({ a: 1 });
      expect(store.loaded).toBe(true);
      expect(store.isPendingReady).toBe(false);
      expect(resetParamsToDOM).toHaveBeenCalled();
    });

    it('queues a non-default style as pending after preload succeeds', async () => {
      mockAdapter.fetchStyle!.mockResolvedValue({
        style: 'aurora',
        distribution: { a: 1 },
        params: { p: 1 },
        backgroundUrl: 'http://bg',
      });
      preloadImage.mockResolvedValue(true);
      const store = useStyleStore();

      await store.fetchStyle('u1');

      expect(store.style).toBe('default');
      expect(store.pendingStyle).toBe('aurora');
      expect(store.pendingParams).toEqual({ p: 1 });
      expect(store.pendingBackgroundUrl).toBe('http://bg');
      expect(store.distribution).toEqual({ a: 1 });
      expect(store.isPendingReady).toBe(true);
      expect(store.loaded).toBe(true);
    });

    it('keeps default when background preload fails', async () => {
      mockAdapter.fetchStyle!.mockResolvedValue({
        style: 'aurora',
        distribution: {},
        params: {},
        backgroundUrl: 'http://bg',
      });
      preloadImage.mockResolvedValue(false);
      const store = useStyleStore();

      await store.fetchStyle('u1');

      expect(store.style).toBe('default');
      expect(store.isPendingReady).toBe(false);
      expect(store.loaded).toBe(true);
    });

    it('keeps default when no background url exists and disk recovery fails', async () => {
      mockAdapter.fetchStyle!.mockResolvedValue({
        style: 'aurora',
        distribution: {},
        params: {},
        backgroundUrl: null,
        bgError: 'boom',
      });
      tryRecoverBgUrl.mockResolvedValue(null);
      const store = useStyleStore();

      await store.fetchStyle('u1');

      expect(tryRecoverBgUrl).toHaveBeenCalledWith('u1');
      expect(store.style).toBe('default');
      expect(store.isPendingReady).toBe(false);
      expect(store.loaded).toBe(true);
    });

    it('recovers background url from disk fallback when missing', async () => {
      mockAdapter.fetchStyle!.mockResolvedValue({
        style: 'aurora',
        distribution: {},
        params: { p: 1 },
        backgroundUrl: null,
      });
      tryRecoverBgUrl.mockResolvedValue('/api/backgrounds/ai/u1.png');
      preloadImage.mockResolvedValue(true);
      const store = useStyleStore();

      await store.fetchStyle('u1');

      expect(store.pendingBackgroundUrl).toBe('/api/backgrounds/ai/u1.png');
      expect(store.isPendingReady).toBe(true);
    });

    it('marks loaded when the backend returns no data', async () => {
      mockAdapter.fetchStyle!.mockResolvedValue(undefined);
      const store = useStyleStore();

      await store.fetchStyle('u1');

      expect(store.loaded).toBe(true);
      expect(store.style).toBe('default');
    });

    it('polls while the backend reports a generation in progress', async () => {
      vi.useFakeTimers();
      mockAdapter.fetchStyle
        .mockResolvedValueOnce({ generating: true, style: 'default', distribution: {} })
        .mockResolvedValueOnce({
          style: 'aurora',
          distribution: {},
          params: { p: 1 },
          backgroundUrl: 'http://bg',
        });
      preloadImage.mockResolvedValue(true);
      const store = useStyleStore();

      const pending = store.fetchStyle('u1');
      await Promise.resolve();
      await Promise.resolve();
      expect(store.generating).toBe(true);

      await vi.advanceTimersByTimeAsync(3000);
      await pending;

      expect(store.generating).toBe(false);
      expect(mockAdapter.fetchStyle).toHaveBeenCalledTimes(2);
      expect(store.pendingStyle).toBe('aurora');
      expect(store.isPendingReady).toBe(true);
      expect(store.loaded).toBe(true);
    });
  });

  describe('checkAndFetchStyle', () => {
    it('does nothing when the style is locked', async () => {
      const store = useStyleStore();
      store.styleLocked = true;

      await store.checkAndFetchStyle('u1');

      expect(mockAdapter.fetchStyle).not.toHaveBeenCalled();
      expect(store.isPendingReady).toBe(false);
    });

    it('skips when the server style and params match the current ones', async () => {
      mockAdapter.fetchStyle!.mockResolvedValue({
        style: 'aurora',
        distribution: {},
        params: { p: 1 },
        backgroundUrl: 'http://bg',
      });
      paramsEqual.mockReturnValue(true);
      const store = useStyleStore();
      store.style = 'aurora';
      store.styleParams = { p: 1 };

      await store.checkAndFetchStyle('u1');

      expect(store.isPendingReady).toBe(false);
      expect(store.pendingStyle).toBe('default');
    });

    it('queues a pending style when the server style differs', async () => {
      mockAdapter.fetchStyle!.mockResolvedValue({
        style: 'aurora',
        distribution: { a: 1 },
        params: { p: 2 },
        backgroundUrl: 'http://bg',
      });
      paramsEqual.mockReturnValue(false);
      preloadImage.mockResolvedValue(true);
      const store = useStyleStore();

      await store.checkAndFetchStyle('u1');

      expect(store.pendingStyle).toBe('aurora');
      expect(store.pendingParams).toEqual({ p: 2 });
      expect(store.pendingBackgroundUrl).toBe('http://bg');
      expect(store.isPendingReady).toBe(true);
    });

    it('abandons the switch when no background url can be resolved', async () => {
      mockAdapter.fetchStyle!.mockResolvedValue({
        style: 'aurora',
        distribution: {},
        params: {},
        backgroundUrl: null,
      });
      paramsEqual.mockReturnValue(false);
      tryRecoverBgUrl.mockResolvedValue(null);
      const store = useStyleStore();

      await store.checkAndFetchStyle('u1');

      expect(store.isPendingReady).toBe(false);
      expect(store.pendingStyle).toBe('default');
    });
  });

  describe('forceRegenerateStyle', () => {
    it('requests regeneration with force=true and queues the result', async () => {
      mockAdapter.fetchStyle!.mockResolvedValue({
        style: 'aurora',
        distribution: {},
        params: { p: 1 },
        backgroundUrl: 'http://bg',
      });
      preloadImage.mockResolvedValue(true);
      const store = useStyleStore();

      await store.forceRegenerateStyle('u1');

      expect(mockAdapter.fetchStyle).toHaveBeenCalledWith('u1', true);
      expect(store.pendingStyle).toBe('aurora');
      expect(store.isPendingReady).toBe(true);
    });

    it('abandons when background preload fails', async () => {
      mockAdapter.fetchStyle!.mockResolvedValue({
        style: 'aurora',
        distribution: {},
        params: {},
        backgroundUrl: 'http://bg',
      });
      preloadImage.mockResolvedValue(false);
      const store = useStyleStore();

      await store.forceRegenerateStyle('u1');

      expect(store.isPendingReady).toBe(false);
      expect(store.pendingStyle).toBe('default');
    });
  });

  describe('scheduleCheck', () => {
    it('runs the check 30s after being scheduled', async () => {
      vi.useFakeTimers();
      mockAdapter.fetchStyle!.mockResolvedValue({
        style: 'aurora',
        distribution: {},
        params: { p: 1 },
        backgroundUrl: 'http://bg',
      });
      preloadImage.mockResolvedValue(true);
      const store = useStyleStore();

      store.scheduleCheck('u1');
      expect(mockAdapter.fetchStyle).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);

      expect(mockAdapter.fetchStyle).toHaveBeenCalledWith('u1');
      expect(store.isPendingReady).toBe(true);
    });

    it('cancels a previously scheduled check', async () => {
      vi.useFakeTimers();
      mockAdapter.fetchStyle!.mockResolvedValue({
        style: 'default',
        distribution: {},
      });
      const store = useStyleStore();

      store.scheduleCheck('u1');
      store.scheduleCheck('u2');
      await vi.advanceTimersByTimeAsync(30_000);

      expect(mockAdapter.fetchStyle).toHaveBeenCalledTimes(1);
      expect(mockAdapter.fetchStyle).toHaveBeenCalledWith('u2');
    });
  });
});
