import { describe, it, expect } from 'vitest';
import { THEME_PRESETS, THEME_DEFAULT } from '../theme';
import type { TreeStyleParams } from '../theme';

const BG_PARAM_RANGES: Record<string, { min: number; max: number }> = {
  bgCamY: { min: 0.5, max: 15 },
  bgCamPitch: { min: -0.8, max: 0.3 },
  bgCamZ: { min: -20, max: -1 },
  bgGroundY: { min: -5, max: 5 },
  bgHillFreq: { min: 0.05, max: 1.0 },
  bgHillAmp: { min: 1, max: 20 },
  bgHillDepth: { min: 10, max: 150 },
  bgBldgDepth: { min: 10, max: 150 },
  bgFovZoom: { min: 0.5, max: 5 },
  bgFogDistance: { min: 10, max: 200 },
  bgBuildingDensity: { min: 0.1, max: 1.0 },
  bgBuildingHeight: { min: 1, max: 30 },
};

describe('Theme Presets', () => {
  it('should have exactly 1 theme (default only)', () => {
    const keys = Object.keys(THEME_PRESETS);
    expect(keys).toEqual(['default']);
  });

  it('default theme has all required bg* parameters with valid ranges', () => {
    const preset = THEME_DEFAULT;
    for (const [param, range] of Object.entries(BG_PARAM_RANGES)) {
      const value = (preset as Record<string, unknown>)[param];
      expect(value).toBeDefined();
      expect(typeof value).toBe('number');
      expect(value as number).toBeGreaterThanOrEqual(range.min);
      expect(value as number).toBeLessThanOrEqual(range.max);
    }
  });

  it('default theme has valid color tuples', () => {
    const colorKeys = ['skyTopColor', 'skyBottomColor', 'groundColor'] as const;
    for (const key of colorKeys) {
      const color = THEME_DEFAULT[key];
      expect(Array.isArray(color)).toBe(true);
      expect(color).toHaveLength(3);
      for (const channel of color) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('CAM-02: Camera pitch is negative (downward look)', () => {
  it('default theme has negative bgCamPitch', () => {
    expect(THEME_DEFAULT.bgCamPitch).toBeLessThan(0);
  });

  it('sin(bgCamPitch) < 0 (downward forward.y)', () => {
    expect(Math.sin(THEME_DEFAULT.bgCamPitch)).toBeLessThan(0);
  });
});
