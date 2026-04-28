import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { BackgroundRenderer } from '../scene/BackgroundRenderer';
import { THEME_DEFAULT } from '../../../constants/theme';
import type { TreeStyleParams } from '../../../constants/theme';

// Mock the shader imports to avoid Vite raw import resolution in test
vi.mock('../shaders/backgroundRaymarch', () => ({
  backgroundVertexShader: 'void main() { gl_Position = vec4(0.0); }',
  backgroundFragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
}));

describe('BackgroundRenderer - SdfParamRegistry Integration (CAM-03)', () => {
  let renderer: BackgroundRenderer;

  beforeEach(() => {
    renderer = new BackgroundRenderer(0, 0.12345);
  });

  it('constructs with createUniforms() — all registry uniforms present', () => {
    const mat = renderer.getMaterial();
    // Camera uniforms from registry
    expect(mat.uniforms.uCamY.value).toBe(2.8);
    expect(mat.uniforms.uCamZ.value).toBe(-6.0);
    // Color uniforms from registry — THREE.Color instances
    expect(mat.uniforms.uSkyTopColor.value).toBeInstanceOf(THREE.Color);
    expect(mat.uniforms.uGroundColor.value).toBeInstanceOf(THREE.Color);
    // Geometry uniforms from registry
    expect(mat.uniforms.uGroundY.value).toBe(0.5);
    expect(mat.uniforms.uFogDistance.value).toBe(60.0);
    // Non-registry dynamic uniforms
    expect(mat.uniforms.uTime.value).toBe(0);
    expect(mat.uniforms.uStyleType.value).toBe(0);
    expect(mat.uniforms.uSeed.value).toBe(0.12345);
    // uMouseUV present (CAM-05)
    expect(mat.uniforms.uMouseUV.value).toBeInstanceOf(THREE.Vector2);
    expect(mat.uniforms.uMouseUV.value.x).toBe(0.5);
  });

  it('updateParams() writes TreeStyleParams into registry uniforms (CAM-03)', () => {
    const mat = renderer.getMaterial();
    const modified: TreeStyleParams = {
      ...THEME_DEFAULT,
      bgCamY: 3.5,
      bgFogDistance: 100.0,
      bgGroundY: -0.5,
    };
    renderer.updateParams(modified);
    // Registry-managed: bgCamY → uCamY
    expect(mat.uniforms.uCamY.value).toBe(3.5);
    // Registry-managed: bgFogDistance → uFogDistance
    expect(mat.uniforms.uFogDistance.value).toBe(100.0);
    // Registry-managed: bgGroundY → uGroundY
    expect(mat.uniforms.uGroundY.value).toBe(-0.5);
    // Registry-managed: bgCamPitch → uCamPitch (unchanged from THEME_DEFAULT)
    expect(mat.uniforms.uCamPitch.value).toBe(THEME_DEFAULT.bgCamPitch);
  });

  it('updateParams() sets non-registry uniforms correctly', () => {
    const mat = renderer.getMaterial();
    renderer.updateParams(THEME_DEFAULT);
    // uStyleType and uSeed should be set during construction and preserved
    expect(mat.uniforms.uStyleType.value).toBe(0);
    expect(mat.uniforms.uSeed.value).toBe(0.12345);
  });

  it('dispose() cleans up geometry and material', () => {
    const mat = renderer.getMaterial();
    const mesh = renderer.getMesh();
    const geoDisposeSpy = vi.spyOn(mesh.geometry, 'dispose');
    const matDisposeSpy = vi.spyOn(mat, 'dispose');
    renderer.dispose();
    expect(geoDisposeSpy).toHaveBeenCalled();
    expect(matDisposeSpy).toHaveBeenCalled();
  });
});

describe('BackgroundRenderer - Mouse Parallax (CAM-05)', () => {
  let renderer: BackgroundRenderer;

  beforeEach(() => {
    renderer = new BackgroundRenderer(1, 0.5);
  });

  it('updateMouseUV() sets uMouseUV uniform value', () => {
    const mat = renderer.getMaterial();
    renderer.updateMouseUV({ x: 0.2, y: 0.8 });
    expect(mat.uniforms.uMouseUV.value.x).toBe(0.2);
    expect(mat.uniforms.uMouseUV.value.y).toBe(0.8);
  });

  it('updateMouseUV() clamps values to [0, 1] range', () => {
    const mat = renderer.getMaterial();
    // Values outside range
    renderer.updateMouseUV({ x: 1.5, y: -0.3 });
    expect(mat.uniforms.uMouseUV.value.x).toBe(1.0);
    expect(mat.uniforms.uMouseUV.value.y).toBe(0.0);
    // Negative values clamped
    renderer.updateMouseUV({ x: -10, y: -5 });
    expect(mat.uniforms.uMouseUV.value.x).toBe(0.0);
    expect(mat.uniforms.uMouseUV.value.y).toBe(0.0);
  });

  it('updateMouseUV() guards against NaN (Number.isFinite check)', () => {
    const mat = renderer.getMaterial();
    // Set a known good value first
    renderer.updateMouseUV({ x: 0.7, y: 0.3 });
    expect(mat.uniforms.uMouseUV.value.x).toBe(0.7);

    // NaN input should keep previous value (not write NaN)
    renderer.updateMouseUV({ x: NaN, y: 0.5 });
    expect(Number.isFinite(mat.uniforms.uMouseUV.value.x)).toBe(true);
    // x should remain at 0.7 (previous valid value)
    expect(mat.uniforms.uMouseUV.value.x).toBe(0.7);
    // y should be 0.5 (valid)
    expect(mat.uniforms.uMouseUV.value.y).toBe(0.5);
  });

  it('updateMouseUV() guards against Infinity', () => {
    const mat = renderer.getMaterial();
    renderer.updateMouseUV({ x: Infinity, y: -Infinity });
    expect(Number.isFinite(mat.uniforms.uMouseUV.value.x)).toBe(true);
    expect(Number.isFinite(mat.uniforms.uMouseUV.value.y)).toBe(true);
  });

  it('getMesh() returns mesh with correct properties', () => {
    const mesh = renderer.getMesh();
    expect(mesh.name).toBe('background');
    expect(mesh.renderOrder).toBe(-2);
    expect(mesh.frustumCulled).toBe(false);
  });
});
