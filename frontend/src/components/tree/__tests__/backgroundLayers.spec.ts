import { describe, it, expect } from 'vitest';
import { backgroundFragmentShader } from '../shaders/backgroundRaymarch';

describe('SDF-01: Four-Layer Depth Composition', () => {
  it('shader source is a non-empty string with sufficient length', () => {
    expect(typeof backgroundFragmentShader).toBe('string');
    expect(backgroundFragmentShader.length).toBeGreaterThan(5000);
  });

  it('contains all 4 map functions', () => {
    expect(backgroundFragmentShader).toMatch(/float mapDefault\s*\(/);
    expect(backgroundFragmentShader).toMatch(/float mapSakura\s*\(/);
    expect(backgroundFragmentShader).toMatch(/float mapCyberpunk\s*\(/);
    expect(backgroundFragmentShader).toMatch(/float mapInk\s*\(/);
  });

  it('mapDefault uses ground plane via sdPlane with uGroundY', () => {
    expect(backgroundFragmentShader).toMatch(/sdPlane.*uGroundY/);
  });

  it('each map function uses sdPlane for ground layer', () => {
    const mapFunctions = ['mapDefault', 'mapSakura', 'mapCyberpunk', 'mapInk'];
    for (const fn of mapFunctions) {
      const fnStart = backgroundFragmentShader.indexOf(`float ${fn}(`);
      const nextFn = mapFunctions.find(
        (f) =>
          f !== fn &&
          backgroundFragmentShader.indexOf(`float ${f}(`, fnStart + 1) > fnStart,
      );
      const fnEnd = nextFn
        ? backgroundFragmentShader.indexOf(`float ${nextFn}(`, fnStart + 1)
        : backgroundFragmentShader.length;
      const fnBody = backgroundFragmentShader.slice(fnStart, fnEnd);
      expect(fnBody).toMatch(/sdPlane/);
    }
  });
});

describe('CAM-01: No hardcoded camera values', () => {
  it('does not contain hardcoded ro = vec3(0.0, 2.8, ...)', () => {
    expect(backgroundFragmentShader).not.toMatch(
      /ro\s*=\s*vec3\s*\(\s*0\.0\s*,\s*2\.8/,
    );
  });

  it('does not contain hardcoded lookAt = vec3(0.0, 3.5, ...)', () => {
    expect(backgroundFragmentShader).not.toMatch(
      /lookAt\s*=\s*vec3\s*\(\s*0\.0\s*,\s*3\.5/,
    );
  });

  it('does not contain standalone hardcoded zoom = 1.8', () => {
    expect(backgroundFragmentShader).not.toMatch(/zoom\s*=\s*1\.8/);
  });

  it('contains uniform uCamY declaration', () => {
    expect(backgroundFragmentShader).toMatch(/uniform float uCamY;/);
  });

  it('contains uniform uCamPitch declaration', () => {
    expect(backgroundFragmentShader).toMatch(/uniform float uCamPitch;/);
  });
});

describe('SDF-07: Density Increase 3-5x', () => {
  it('mapDefault has >= 15 hill elements', () => {
    const hasLoop15 = /for\s*\([^)]*i\s*<\s*(1[5-9]|2\d)/.test(
      backgroundFragmentShader,
    );
    const hillCalls = (backgroundFragmentShader.match(/sdHill\s*\(/g) || [])
      .length;
    expect(hasLoop15 || hillCalls >= 15).toBe(true);
  });

  it('mapSakura has >= 20 machiya in loop', () => {
    const hasLoop20 = /for\s*\([^)]*i\s*<\s*(2\d|30)/.test(
      backgroundFragmentShader,
    );
    expect(hasLoop20).toBe(true);
  });

  it('mapCyberpunk has >= 45 total skyscraper iterations across loops', () => {
    const cyberStart = backgroundFragmentShader.indexOf('float mapCyberpunk(');
    const cyberEnd = backgroundFragmentShader.indexOf(
      'float mapInk(',
      cyberStart,
    );
    const cyberBody = backgroundFragmentShader.slice(
      cyberStart,
      cyberEnd > 0 ? cyberEnd : undefined,
    );
    const cyberBounds = cyberBody.match(/i\s*<\s*(\d+)/g) || [];
    let cyberTotal = 0;
    for (const lb of cyberBounds) {
      cyberTotal += parseInt(lb.match(/\d+/)?.[0] || '0', 10);
    }
    expect(cyberTotal).toBeGreaterThanOrEqual(45);
  });

  it('mapInk has >= 10 mountain/rock elements', () => {
    const hasLoop10 = /for\s*\([^)]*i\s*<\s*(1\d|20)/.test(
      backgroundFragmentShader,
    );
    const inkStart = backgroundFragmentShader.indexOf('float mapInk(');
    const inkBody = backgroundFragmentShader.slice(
      inkStart,
      backgroundFragmentShader.indexOf('// --- Main scene map', inkStart),
    );
    const inkElements = (inkBody.match(/sdHill|sdRock|sdMist/g) || []).length;
    expect(hasLoop10 || inkElements >= 10).toBe(true);
  });
});
