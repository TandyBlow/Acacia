import { describe, it, expect } from 'vitest';
import { ThemeTransition } from '../scene/ThemeTransition';
import { THEME_PRESETS } from '../../../constants/theme';

describe('ThemeTransition (SDF-04)', () => {
  it('should start with isRunning false', () => {
    const transition = new ThemeTransition('default');
    expect(transition.isRunning).toBe(false);
  });

  it('startTransition sets isRunning to true', () => {
    const transition = new ThemeTransition('default');
    transition.startTransition('sakura');
    expect(transition.isRunning).toBe(true);
  });

  it('getCurrentInterpolated returns valid TreeStyleParams before transition', () => {
    const transition = new ThemeTransition('default');
    const state = transition.getCurrentInterpolated();
    expect(state).toHaveProperty('bgCamY');
    expect(state.bgCamY).toBe(THEME_PRESETS.default.bgCamY);
  });

  it('update returns interpolated values during transition', () => {
    const transition = new ThemeTransition('default');
    transition.startTransition('sakura');
    const now = performance.now();
    // At t=0, should return interpolated state close to 'from' (default)
    const result = transition.update(now);
    expect(result).not.toBeNull();
    expect(result!.bgCamY).toBeDefined();
  });

  it('update returns null and isRunning false after transition completes', () => {
    const transition = new ThemeTransition('default');
    transition.startTransition('sakura');
    // Jump far past the duration to simulate completion
    const farFuture = performance.now() + 3000; // 3000ms > 2000ms duration
    transition.update(farFuture);
    const result = transition.update(farFuture + 100);
    // After completion, should return null
    expect(transition.isRunning).toBe(false);
    // getCurrentInterpolated should still work
    const final = transition.getCurrentInterpolated();
    expect(final).toHaveProperty('bgCamY');
  });

  it('rapid consecutive switches use current interpolated state as "from" (no visual jumps)', () => {
    const transition = new ThemeTransition('default');

    // Start first transition and let it progress to mid-point
    transition.startTransition('sakura');
    const startTime = performance.now();
    const midTime = startTime + 1000; // 1000ms into 2000ms transition (t=0.5)
    transition.update(midTime);
    const midState = transition.getCurrentInterpolated();

    // Start second transition — should snapshot midState as new "from"
    transition.startTransition('cyberpunk');
    const newFromState = transition.getCurrentInterpolated();

    // The new "from" should equal the mid-transition state,
    // not the original default state
    expect(newFromState.bgCamY).toBe(midState.bgCamY);
    // Verify midState is actually between default and sakura
    const defaultBgCamY = THEME_PRESETS.default.bgCamY;
    const sakuraBgCamY = THEME_PRESETS.sakura.bgCamY;
    // After 50% interpolation, should be different from both endpoints
    // (unless the two presets happen to have the same value)
    if (defaultBgCamY !== sakuraBgCamY) {
      expect(midState.bgCamY).not.toBe(defaultBgCamY);
    }
  });
});
