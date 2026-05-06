import { describe, it, expect } from 'vitest';
import { THEME_PRESETS } from '../theme';
import type { TreeStyleParams } from '../theme';

const THEME_KEYS = ['default', 'sakura', 'cyberpunk', 'ink'] as const;

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

describe('Theme Presets (SDF-03)', () => {
  it('should have exactly 4 theme keys', () => {
    const keys = Object.keys(THEME_PRESETS);
    expect(keys.sort()).toEqual([...THEME_KEYS].sort());
  });

  it('each theme preset has all required bg* parameters with valid ranges', () => {
    for (const name of THEME_KEYS) {
      const preset = THEME_PRESETS[name];
      for (const [param, range] of Object.entries(BG_PARAM_RANGES)) {
        const value = (preset as Record<string, unknown>)[param];
        expect(value).toBeDefined();
        expect(typeof value).toBe('number');
        expect(value as number).toBeGreaterThanOrEqual(range.min);
        expect(value as number).toBeLessThanOrEqual(range.max);
      }
    }
  });

  it('each theme has valid color tuples', () => {
    const colorKeys = ['skyTopColor', 'skyBottomColor', 'groundColor'] as const;
    for (const name of THEME_KEYS) {
      const preset = THEME_PRESETS[name];
      for (const key of colorKeys) {
        const color = preset[key];
        expect(Array.isArray(color)).toBe(true);
        expect(color).toHaveLength(3);
        for (const channel of color) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('each theme has unique visual identity (at least one differing bg param)', () => {
    const defaultParams = THEME_PRESETS.default;
    for (const name of ['sakura', 'cyberpunk', 'ink'] as const) {
      const preset = THEME_PRESETS[name];
      let hasDifference = false;
      for (const param of Object.keys(BG_PARAM_RANGES)) {
        if (defaultParams[param as keyof TreeStyleParams] !== preset[param as keyof TreeStyleParams]) {
          hasDifference = true;
          break;
        }
      }
      expect(hasDifference).toBe(true);
    }
  });
});

describe('CAM-02: Camera pitch is negative (downward look)', () => {
  it('all theme presets have negative bgCamPitch', () => {
    for (const name of THEME_KEYS) {
      const pitch = THEME_PRESETS[name].bgCamPitch;
      expect(pitch).toBeLessThan(0);
    }
  });

  it('sin(bgCamPitch) < 0 for all presets (downward forward.y)', () => {
    for (const name of THEME_KEYS) {
      const pitch = THEME_PRESETS[name].bgCamPitch;
      expect(Math.sin(pitch)).toBeLessThan(0);
    }
  });
});
