import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  SDF_PARAM_REGISTRY,
  generateGlslUniforms,
  createUniforms,
  applyParamsToUniforms,
} from '../scene/SdfParamRegistry';
import type { SdfParamEntry } from '../scene/SdfParamRegistry';
import { THEME_DEFAULT, THEME_SAKURA, THEME_CYBERPUNK, THEME_INK } from '../../../constants/theme';
import type { TreeStyleParams } from '../../../constants/theme';

describe('SdfParamRegistry', () => {
  it('SDF_PARAM_REGISTRY is a non-empty array', () => {
    expect(Array.isArray(SDF_PARAM_REGISTRY)).toBe(true);
    expect(SDF_PARAM_REGISTRY.length).toBeGreaterThan(0);
  });

  it('each entry has required SdfParamEntry shape', () => {
    for (const entry of SDF_PARAM_REGISTRY) {
      expect(typeof entry.name).toBe('string');
      expect(entry.name.startsWith('u')).toBe(true);
      expect(['vec3', 'float', 'int']).toContain(entry.glslType);
      expect(typeof entry.tsKey).toBe('string');
      expect(entry.defaultValue).toBeDefined();
      expect(['color', 'geometry', 'camera', 'fog']).toContain(entry.category);
    }
  });

  it('has correct category counts', () => {
    const categories = { color: 0, camera: 0, geometry: 0, fog: 0 };
    for (const entry of SDF_PARAM_REGISTRY) {
      categories[entry.category]++;
    }
    expect(categories.color).toBe(3);
    expect(categories.camera).toBe(4);
    expect(categories.geometry).toBe(9);
    expect(categories.fog).toBe(1);
  });

  it('all tsKey values exist in TreeStyleParams', () => {
    for (const entry of SDF_PARAM_REGISTRY) {
      expect(entry.tsKey in THEME_DEFAULT).toBe(true);
    }
  });
});

describe('generateGlslUniforms', () => {
  it('returns a non-empty string', () => {
    const result = generateGlslUniforms();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('contains vec3 color uniform declarations', () => {
    const result = generateGlslUniforms();
    expect(result).toContain('uniform vec3 uSkyTopColor;');
    expect(result).toContain('uniform vec3 uSkyBottomColor;');
    expect(result).toContain('uniform vec3 uGroundColor;');
  });

  it('contains float uniform declarations', () => {
    const result = generateGlslUniforms();
    expect(result).toContain('uniform float uFogDistance;');
    expect(result).toContain('uniform float uCamY;');
    expect(result).toContain('uniform float uBuildingDensity;');
  });

  it('vec3 uniforms have rgb comment', () => {
    const result = generateGlslUniforms();
    expect(result).toContain('uniform vec3 uSkyTopColor; // rgb');
  });

  it('generates exactly one line per registry entry', () => {
    const result = generateGlslUniforms();
    const lines = result.split('\n');
    expect(lines.length).toBe(SDF_PARAM_REGISTRY.length);
  });
});

describe('createUniforms', () => {
  it('returns object with keys matching registry entries', () => {
    const uniforms = createUniforms();
    for (const entry of SDF_PARAM_REGISTRY) {
      expect(uniforms).toHaveProperty(entry.name);
    }
  });

  it('vec3 uniforms are THREE.Color instances', () => {
    const uniforms = createUniforms();
    expect(uniforms.uSkyTopColor.value).toBeInstanceOf(THREE.Color);
    expect(uniforms.uGroundColor.value).toBeInstanceOf(THREE.Color);
  });

  it('float uniforms are numbers', () => {
    const uniforms = createUniforms();
    expect(typeof uniforms.uFogDistance.value).toBe('number');
    expect(uniforms.uFogDistance.value).toBe(60.0);
    expect(uniforms.uCamY.value).toBe(2.8);
  });
});

describe('applyParamsToUniforms', () => {
  it('writes TreeStyleParams values into uniforms', () => {
    const uniforms = createUniforms();
    const params: TreeStyleParams = { ...THEME_DEFAULT };

    applyParamsToUniforms(uniforms, params);

    // Check a float uniform
    expect(uniforms.uCamY.value).toBe(params.bgCamY);
    expect(uniforms.uFogDistance.value).toBe(params.bgFogDistance);

    // Check a vec3 uniform
    const skyColor = uniforms.uSkyTopColor.value as THREE.Color;
    expect(skyColor.r).toBeCloseTo(params.skyTopColor[0]);
    expect(skyColor.g).toBeCloseTo(params.skyTopColor[1]);
    expect(skyColor.b).toBeCloseTo(params.skyTopColor[2]);
  });

  it('reflects changes when params differ', () => {
    const uniforms = createUniforms();
    const modified: TreeStyleParams = {
      ...THEME_DEFAULT,
      bgCamY: 3.5,
      bgFogDistance: 100.0,
    };

    applyParamsToUniforms(uniforms, modified);

    expect(uniforms.uCamY.value).toBe(3.5);
    expect(uniforms.uFogDistance.value).toBe(100.0);
  });
});

describe('platform uniforms (PLAT-03)', () => {
  it('SDF_PARAM_REGISTRY contains uPlatformType entry with float type', () => {
    const platformType = SDF_PARAM_REGISTRY.find(e => e.name === 'uPlatformType');
    expect(platformType).toBeDefined();
    expect(platformType!.glslType).toBe('float');
    expect(platformType!.defaultValue).toBe(0);
    expect(platformType!.min).toBe(0);
    expect(platformType!.max).toBe(4);
    expect(platformType!.tsKey).toBe('bgPlatformType');
  });

  it('SDF_PARAM_REGISTRY contains uPlatformZ entry with float type', () => {
    const platformZ = SDF_PARAM_REGISTRY.find(e => e.name === 'uPlatformZ');
    expect(platformZ).toBeDefined();
    expect(platformZ!.glslType).toBe('float');
    expect(platformZ!.defaultValue).toBe(8.0);
    expect(platformZ!.min).toBe(3);
    expect(platformZ!.max).toBe(15);
    expect(platformZ!.tsKey).toBe('bgPlatformZ');
  });

  it('generateGlslUniforms() includes platform uniform declarations', () => {
    const result = generateGlslUniforms();
    expect(result).toContain('uniform float uPlatformType;');
    expect(result).toContain('uniform float uPlatformZ;');
  });

  it('createUniforms() creates platform uniforms with correct defaults', () => {
    const uniforms = createUniforms();
    expect(uniforms.uPlatformType.value).toBe(0);
    expect(uniforms.uPlatformZ.value).toBe(8.0);
  });

  it('applyParamsToUniforms() writes bgPlatformType and bgPlatformZ as floats', () => {
    const uniforms = createUniforms();
    const params = { ...THEME_DEFAULT, bgPlatformType: 2, bgPlatformZ: 9.5 };
    applyParamsToUniforms(uniforms, params);
    expect(uniforms.uPlatformType.value).toBe(2);
    expect(uniforms.uPlatformZ.value).toBe(9.5);
  });

  it('all platform tsKey values exist in THEME_DEFAULT', () => {
    const platformEntries = SDF_PARAM_REGISTRY.filter(e =>
      e.name === 'uPlatformType' || e.name === 'uPlatformZ'
    );
    for (const entry of platformEntries) {
      expect(entry.tsKey in THEME_DEFAULT).toBe(true);
    }
  });

  it('platform tsKey values exist in all 4 theme presets', () => {
    const presets = [THEME_DEFAULT, THEME_SAKURA, THEME_CYBERPUNK, THEME_INK];
    for (const preset of presets) {
      expect(typeof preset.bgPlatformType).toBe('number');
      expect(typeof preset.bgPlatformZ).toBe('number');
      expect(preset.bgPlatformType).toBeGreaterThanOrEqual(0);
      expect(preset.bgPlatformType).toBeLessThanOrEqual(4);
      expect(preset.bgPlatformZ).toBeGreaterThanOrEqual(3);
      expect(preset.bgPlatformZ).toBeLessThanOrEqual(15);
    }
  });
});
