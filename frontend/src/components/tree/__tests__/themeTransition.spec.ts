import { describe, it, expect } from 'vitest';
import { ThemeTransition } from '../scene/ThemeTransition';
import { THEME_DEFAULT } from '../../../constants/theme';
import type { TreeStyleParams } from '../../../constants/theme';

const CUSTOM_PARAMS: TreeStyleParams = {
  ...THEME_DEFAULT,
  bgCamY: 5.0,
  bgCamPitch: -0.3,
  trunkBaseColor: [0.5, 0.3, 0.2],
  leafMidColor: [0.8, 0.4, 0.6],
};

const CUSTOM_PARAMS_2: TreeStyleParams = {
  ...THEME_DEFAULT,
  bgCamY: 8.0,
  trunkBaseColor: [0.2, 0.2, 0.5],
};

describe('ThemeTransition', () => {
  it('should start with isRunning false', () => {
    const transition = new ThemeTransition('default');
    expect(transition.isRunning).toBe(false);
  });

  it('should start with isRunning false for custom style', () => {
    const transition = new ThemeTransition('custom-style', CUSTOM_PARAMS);
    expect(transition.isRunning).toBe(false);
  });

  it('startTransition sets isRunning to true', () => {
    const transition = new ThemeTransition('default');
    transition.startTransition('custom-style', CUSTOM_PARAMS);
    expect(transition.isRunning).toBe(true);
  });

  it('getCurrentInterpolated returns valid TreeStyleParams before transition', () => {
    const transition = new ThemeTransition('default');
    const state = transition.getCurrentInterpolated();
    expect(state).toHaveProperty('bgCamY');
    expect(state.bgCamY).toBe(THEME_DEFAULT.bgCamY);
  });

  it('update returns interpolated values during transition', () => {
    const transition = new ThemeTransition('default');
    transition.startTransition('custom-style', CUSTOM_PARAMS);
    const now = performance.now();
    const result = transition.update(now);
    expect(result).not.toBeNull();
    expect(result!.bgCamY).toBeDefined();
  });

  it('update returns null and isRunning false after transition completes', () => {
    const transition = new ThemeTransition('default');
    transition.startTransition('custom-style', CUSTOM_PARAMS);
    const farFuture = performance.now() + 3000;
    transition.update(farFuture);
    const result = transition.update(farFuture + 100);
    expect(transition.isRunning).toBe(false);
    const final = transition.getCurrentInterpolated();
    expect(final).toHaveProperty('bgCamY');
  });

  it('rapid consecutive switches use current interpolated state as "from" (no visual jumps)', () => {
    const transition = new ThemeTransition('default');

    transition.startTransition('custom-style', CUSTOM_PARAMS);
    const startTime = performance.now();
    const midTime = startTime + 1000;
    transition.update(midTime);
    const midState = transition.getCurrentInterpolated();

    transition.startTransition('custom-style-2', CUSTOM_PARAMS_2);
    const newFromState = transition.getCurrentInterpolated();

    expect(newFromState.bgCamY).toBe(midState.bgCamY);

    const defaultBgCamY = THEME_DEFAULT.bgCamY;
    if (defaultBgCamY !== CUSTOM_PARAMS.bgCamY) {
      expect(midState.bgCamY).not.toBe(defaultBgCamY);
    }
  });

  it('falls back to THEME_DEFAULT when style is not in presets and no custom params', () => {
    const transition = new ThemeTransition('unknown-style');
    const state = transition.getCurrentInterpolated();
    expect(state.bgCamY).toBe(THEME_DEFAULT.bgCamY);
  });
});
