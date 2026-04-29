import { describe, it, expect } from 'vitest';
import { SDF_PRIMITIVES } from '../shaders/sdfPrimitives';

/** Extract the body of the sdCliff function from the GLSL string. */
function getCliffBody(): string {
  const cliffStart = SDF_PRIMITIVES.indexOf('float sdCliff');
  // Find the NEXT function definition (starts at beginning of line)
  const nextFuncMatch = SDF_PRIMITIVES.slice(cliffStart + 10).match(/\nfloat\s+\w+\s*\(/);
  const nextFunc = nextFuncMatch
    ? cliffStart + 10 + (nextFuncMatch.index ?? 0) + 1
    : -1;
  return nextFunc > cliffStart
    ? SDF_PRIMITIVES.substring(cliffStart, nextFunc)
    : SDF_PRIMITIVES.substring(cliffStart);
}

describe('SDF_PRIMITIVES export', () => {
  it('is a non-empty string', () => {
    expect(typeof SDF_PRIMITIVES).toBe('string');
    expect(SDF_PRIMITIVES.length).toBeGreaterThan(1000);
  });

  it('contains all IQ primitive functions', () => {
    expect(SDF_PRIMITIVES).toMatch(/float sdBox\(vec3 p, vec3 b\)/);
    expect(SDF_PRIMITIVES).toMatch(/float sdRoundBox\(vec3 p, vec3 b, float r\)/);
    expect(SDF_PRIMITIVES).toMatch(/float sdCylinder\(vec3 p, float r, float h\)/);
    expect(SDF_PRIMITIVES).toMatch(/float sdPlane\(vec3 p, vec3 n, float h\)/);
    expect(SDF_PRIMITIVES).toMatch(/float fbm\(vec2 p\)/);
    expect(SDF_PRIMITIVES).toMatch(/float hash11\(float n\)/);
  });

  it('contains sdCliff function with correct signature', () => {
    expect(SDF_PRIMITIVES).toMatch(
      /float sdCliff\s*\(\s*vec3\s+p\s*,\s*float\s+width\s*,\s*float\s+height\s*,\s*float\s+edgeRound\s*\)/
    );
  });

  it('sdCliff uses sdRoundBox as its base primitive', () => {
    expect(getCliffBody()).toMatch(/sdRoundBox/);
  });

  it('sdCliff uses fbm for organic noise', () => {
    expect(getCliffBody()).toMatch(/fbm\(p\.xz/);
  });

  it('sdCliff uses smoothstep for topMask blending', () => {
    expect(getCliffBody()).toMatch(/smoothstep/);
  });

  it('sdCliff references all three parameters', () => {
    const body = getCliffBody();
    expect(body).toMatch(/width/);
    expect(body).toMatch(/height/);
    expect(body).toMatch(/edgeRound/);
  });
});
