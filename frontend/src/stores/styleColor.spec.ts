// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  colorTupleToCSS,
  ensureContrastAgainstWhite,
  ensureContrastAgainstDark,
  isSkyDark,
} from './styleColor';

// WCAG 2.x relative luminance + contrast ratio — the standard the module implements.
function linearize(c: number): number {
  if (c <= 0.04045) return c / 12.92;
  return Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb: number[]): number {
  return 0.2126 * linearize(rgb[0]!) + 0.7152 * linearize(rgb[1]!) + 0.0722 * linearize(rgb[2]!);
}

function contrastRatio(lum1: number, lum2: number): number {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('colorTupleToCSS', () => {
  it('maps a [0,1] tuple to an rgb() string', () => {
    expect(colorTupleToCSS([0.5, 0.5, 0.5])).toBe('rgb(128,128,128)');
    expect(colorTupleToCSS([1, 0, 0.4])).toBe('rgb(255,0,102)');
    expect(colorTupleToCSS([0, 0, 0])).toBe('rgb(0,0,0)');
    expect(colorTupleToCSS([1, 1, 1])).toBe('rgb(255,255,255)');
  });

  it('coerces string entries through Number()', () => {
    expect(colorTupleToCSS(['0.5', '0.5', '0.5'])).toBe('rgb(128,128,128)');
  });

  it('falls back for non-array values', () => {
    const fallback = 'rgb(102,128,255)';
    expect(colorTupleToCSS(null)).toBe(fallback);
    expect(colorTupleToCSS(undefined)).toBe(fallback);
    expect(colorTupleToCSS(42)).toBe(fallback);
    expect(colorTupleToCSS('0.5,0.5,0.5')).toBe(fallback);
    expect(colorTupleToCSS({})).toBe(fallback);
  });

  it('falls back for arrays shorter than 3 entries', () => {
    const fallback = 'rgb(102,128,255)';
    expect(colorTupleToCSS([])).toBe(fallback);
    expect(colorTupleToCSS([0.5, 0.5])).toBe(fallback);
  });
});

describe('ensureContrastAgainstWhite', () => {
  it('returns rgb unchanged when already at least 4.5:1 against white', () => {
    expect(ensureContrastAgainstWhite([0, 0, 0])).toEqual([0, 0, 0]);
    expect(ensureContrastAgainstWhite([0.1, 0.1, 0.1])).toEqual([0.1, 0.1, 0.1]);
  });

  it('darkens a light color until contrast against white reaches 4.5', () => {
    const result = ensureContrastAgainstWhite([1, 1, 1]);
    expect(contrastRatio(relativeLuminance(result), 1.0)).toBeGreaterThanOrEqual(4.5);
    expect(result[0]).toBeGreaterThan(0.4);
    expect(result[0]).toBeLessThan(0.5);
  });

  it('darkens mid-gray [0.5,0.5,0.5] and never lightens', () => {
    const input = [0.5, 0.5, 0.5];
    const result = ensureContrastAgainstWhite(input);
    expect(contrastRatio(relativeLuminance(result), 1.0)).toBeGreaterThanOrEqual(4.5);
    result.forEach((v, i) => expect(v).toBeLessThanOrEqual(input[i]!));
  });

  it('returns a 3-tuple rounded to 4 decimals in [0,1]', () => {
    const result = ensureContrastAgainstWhite([0.9, 0.9, 0.9]);
    expect(result).toHaveLength(3);
    result.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Number.isInteger(Math.round(v * 10000))).toBe(true);
    });
  });

  it('is idempotent — a compliant color is returned untouched', () => {
    const once = ensureContrastAgainstWhite([0.9, 0.9, 0.9]);
    expect(ensureContrastAgainstWhite(once)).toEqual(once);
  });
});

describe('ensureContrastAgainstDark', () => {
  it('returns rgb unchanged when already at least 4.5:1 against black', () => {
    expect(ensureContrastAgainstDark([1, 1, 1])).toEqual([1, 1, 1]);
    expect(ensureContrastAgainstDark([0.9, 0.9, 0.9])).toEqual([0.9, 0.9, 0.9]);
  });

  it('lightens black until contrast against black reaches 4.5', () => {
    const result = ensureContrastAgainstDark([0, 0, 0]);
    expect(contrastRatio(relativeLuminance(result), 0.0)).toBeGreaterThanOrEqual(4.5);
    expect(result[0]).toBeGreaterThan(0.4);
    expect(result[0]).toBeLessThan(0.5);
  });

  it('lightens a dark color and never darkens it', () => {
    const input = [0.2, 0.2, 0.2];
    const result = ensureContrastAgainstDark(input);
    expect(contrastRatio(relativeLuminance(result), 0.0)).toBeGreaterThanOrEqual(4.5);
    result.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(input[i]!));
  });

  it('is idempotent — a compliant color is returned untouched', () => {
    const once = ensureContrastAgainstDark([0.2, 0.2, 0.2]);
    expect(ensureContrastAgainstDark(once)).toEqual(once);
  });
});

describe('isSkyDark', () => {
  it('returns true for dark skies', () => {
    expect(isSkyDark([0, 0, 0])).toBe(true);
    expect(isSkyDark([0.5, 0.5, 0.5])).toBe(true);
    expect(isSkyDark([0.73, 0.73, 0.73])).toBe(true);
    expect(isSkyDark([0.9, 0.1, 0.1])).toBe(true);
  });

  it('returns false for light skies', () => {
    expect(isSkyDark([1, 1, 1])).toBe(false);
    expect(isSkyDark([0.9, 0.9, 0.9])).toBe(false);
    expect(isSkyDark([0.74, 0.74, 0.74])).toBe(false);
    expect(isSkyDark([0.9, 0.9, 0.1])).toBe(false);
  });

  it('uses relative luminance weighted by channel', () => {
    // Same average channel value, different luminance weighting.
    expect(isSkyDark([0.5, 0.5, 0.5])).toBe(true);
    expect(isSkyDark([0.6, 0.6, 0.3])).toBe(true);
    expect(isSkyDark([0.8, 0.8, 0.8])).toBe(false);
  });
});
