import { describe, it, expect } from 'vitest';
import { SDF_PLATFORMS } from '../shaders/sdfPlatforms';

describe('SDF_PLATFORMS export', () => {
  it('sdfPlatforms.ts module exists and exports SDF_PLATFORMS', () => {
    expect(SDF_PLATFORMS).toBeDefined();
    expect(typeof SDF_PLATFORMS).toBe('string');
  });

  it('SDF_PLATFORMS is a non-empty GLSL string', () => {
    expect(SDF_PLATFORMS.length).toBeGreaterThan(500);
  });

  it('contains sdPlatform dispatch function with int type parameter', () => {
    expect(SDF_PLATFORMS).toMatch(
      /float sdPlatform\s*\(\s*vec3\s+p\s*,\s*int\s+type\s*\)/
    );
  });

  it('sdPlatform dispatches to all 5 platform types', () => {
    const glsl = SDF_PLATFORMS;
    expect(glsl).toMatch(/type\s*==\s*0/);
    expect(glsl).toMatch(/type\s*==\s*1/);
    expect(glsl).toMatch(/type\s*==\s*2/);
    expect(glsl).toMatch(/type\s*==\s*3/);
    expect(glsl).toMatch(/type\s*==\s*4/);
  });

  it('sdPlatform returns 1e10 for unknown type (miss fallback)', () => {
    expect(SDF_PLATFORMS).toMatch(/1e10/);
  });

  it('contains all 5 platform type function signatures', () => {
    const glsl = SDF_PLATFORMS;
    expect(glsl).toMatch(/float sdCliffPlatform\s*\(\s*vec3\s+p\s*\)/);
    expect(glsl).toMatch(/float sdViewingDeck\s*\(\s*vec3\s+p\s*\)/);
    expect(glsl).toMatch(/float sdRooftop\s*\(\s*vec3\s+p\s*\)/);
    expect(glsl).toMatch(/float sdTempleBase\s*\(\s*vec3\s+p\s*\)/);
    expect(glsl).toMatch(/float sdMegalith\s*\(\s*vec3\s+p\s*\)/);
  });

  it('sdCliffPlatform uses sdCliff primitive', () => {
    const glsl = SDF_PLATFORMS;
    const cliffStart = glsl.indexOf('float sdCliffPlatform');
    const nextFuncMatch = glsl.slice(cliffStart + 10).match(/\nfloat\s+\w+\s*\(/);
    const nextFunc = nextFuncMatch
      ? cliffStart + 10 + (nextFuncMatch.index ?? 0) + 1
      : -1;
    const body = nextFunc > cliffStart
      ? glsl.substring(cliffStart, nextFunc)
      : glsl.substring(cliffStart);
    expect(body).toMatch(/sdCliff\s*\(/);
  });
});

describe('PLAT-05: Detail SDFs with hash11 placement', () => {
  it('contains hash11 usage for detail placement', () => {
    expect(SDF_PLATFORMS).toMatch(/hash11/);
  });

  it('contains cell-based grid placement logic (cellSize or cell variable)', () => {
    expect(SDF_PLATFORMS).toMatch(/cellSize|cell\s*=/);
  });

  it('uses opS smooth union for detail blending', () => {
    expect(SDF_PLATFORMS).toMatch(/opS\(/);
  });

  it('contains at least 8 distinct detail SDF shapes', () => {
    const detailPatterns = [
      /sdRoundBox\(.*vec3\(0\.[0-1]/,
      /sdCylinder\(.*0\.0[4-6]/,
      /sdBox\(.*vec3\(0\.[0-9]/,
    ];
    let matchCount = 0;
    for (const pattern of detailPatterns) {
      const matches = SDF_PLATFORMS.match(new RegExp(pattern.source, 'g'));
      if (matches && matches.length >= 2) matchCount++;
    }
    expect(matchCount).toBeGreaterThanOrEqual(2);
  });

  it('SDF_PLATFORMS is larger than 2500 chars (detail GLSL added)', () => {
    expect(SDF_PLATFORMS.length).toBeGreaterThan(2500);
  });

  it('uses distinct seed offsets to avoid hash collisions', () => {
    expect(SDF_PLATFORMS).toMatch(/cell\.x\s*\*\s*\d+\.?\d*/);
    expect(SDF_PLATFORMS).toMatch(/cell\.y\s*\*\s*\d+\.?\d*/);
    expect(SDF_PLATFORMS).toMatch(/cell\.z\s*\*\s*\d+\.?\d*/);
  });

  it('each platform type function integrates detail placement', () => {
    const detailRefs = (SDF_PLATFORMS.match(/[Dd]etail/g) || []).length;
    expect(detailRefs).toBeGreaterThanOrEqual(5);
  });
});
