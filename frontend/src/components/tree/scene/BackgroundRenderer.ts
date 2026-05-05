import * as THREE from 'three';
import { backgroundVertexShader, backgroundFragmentShader } from '../shaders/backgroundRaymarch';
import { createUniforms, applyParamsToUniforms } from './SdfParamRegistry';
import type { TreeStyleParams } from '../../../constants/theme';

/**
 * Full-screen quad with raymarched SDF background.
 *
 * CAM-03: Uses SdfParamRegistry.createUniforms() and applyParamsToUniforms()
 *         instead of hardcoding uniform lists. All bg* params from
 *         TreeStyleParams flow automatically through the registry.
 *
 * CAM-05: updateMouseUV() writes mouse position to uMouseUV uniform
 *         for vista-layer parallax offset (applied in fragment shader
 *         via PARALLAX_THRESHOLD + smoothstep — see Plan 01-01).
 */
export class BackgroundRenderer {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private styleType: number;
  private seed: number;

  constructor(styleType: number, seed: number) {
    this.styleType = styleType;
    this.seed = seed;

    const geo = new THREE.PlaneGeometry(2, 2);

    // CAM-03: Use SdfParamRegistry to create all registered uniforms
    const registryUniforms = createUniforms();

    // Create a simple test texture (red-green gradient) to verify texture sampling works
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const idx = (i * size + j) * 4;
        data[idx] = (i / size) * 255;
        data[idx + 1] = (j / size) * 255;
        data[idx + 2] = 128;
        data[idx + 3] = 255;
      }
    }
    const testTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    testTexture.wrapS = THREE.RepeatWrapping;
    testTexture.wrapT = THREE.RepeatWrapping;
    testTexture.needsUpdate = true;
    console.log('✓ Test texture created (RGBA):', size, 'x', size);

    this.material = new THREE.ShaderMaterial({
      vertexShader: backgroundVertexShader,
      fragmentShader: backgroundFragmentShader,
      uniforms: {
        ...registryUniforms,
        uFogColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
        uTime: { value: 0 },
        uSeed: { value: seed },
        uStyleType: { value: styleType },
        uResolution: { value: new THREE.Vector2(1024, 1024) },
        uMouseUV: { value: new THREE.Vector2(0.5, 0.5) },
        uPlatformTexture: { value: testTexture },
      },
      depthWrite: false,
      depthTest: false,
    });

    // Check for shader compilation errors
    this.material.onBeforeCompile = (shader) => {
      console.log('[Shader] Compiling background shader...');
    };

    // Listen for WebGL errors
    const checkShaderError = () => {
      if (this.material.program) {
        const gl = this.material.program.gl;
        const error = gl.getError();
        if (error !== gl.NO_ERROR) {
          console.error('[Shader] WebGL error:', error);
        }
      }
    };
    setTimeout(checkShaderError, 1000);

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'background';
    this.mesh.renderOrder = -2;
    this.mesh.frustumCulled = false;
  }

  /** Get the mesh to add to the scene */
  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  /** Get the shader material for direct uniform access */
  getMaterial(): THREE.ShaderMaterial {
    return this.material;
  }

  /**
   * CAM-03: Update all registry-managed uniforms from TreeStyleParams.
   * Replaces the old update(BackgroundUniformParams) and paramsFromTheme().
   *
   * applyParamsToUniforms iterates SDF_PARAM_REGISTRY and writes each
   * params[entry.tsKey] to uniforms[entry.name]. This covers all bg*
   * fields including bgCamY/bgCamPitch/bgCamZ/bgFovZoom (CAM-04 data flow).
   */
  updateParams(params: TreeStyleParams): void {
    // Registry-managed params (colors, camera, geometry, fog)
    applyParamsToUniforms(this.material.uniforms, params);

    // Non-registry params that change on style switch
    this.material.uniforms.uSeed!.value = this.seed;
    this.material.uniforms.uStyleType!.value = this.styleType;
    // uFogColor derived from skyBottomColor
    const sbc = params.skyBottomColor;
    (this.material.uniforms.uFogColor!.value as THREE.Color).set(
      sbc[0] * 0.85,
      sbc[1] * 0.85,
      sbc[2] * 0.85,
    );
  }

  /**
   * CAM-05: Update mouse UV for vista-layer parallax.
   *
   * The parallax offset computation (smoothstep, PARALLAX_THRESHOLD) is
   * in the fragment shader (see Plan 01-01). This method only writes
   * the normalized mouse position to the uMouseUV uniform.
   *
   * SECURITY: Clamp to [0,1] and guard against NaN/Infinity to prevent
   * shader injection of invalid floating-point values (ASVS V5).
   */
  updateMouseUV(mouseUV: { x: number; y: number }): void {
    const clamp = (v: number): number => Math.max(0, Math.min(1, v));
    const x = Number.isFinite(mouseUV.x) ? clamp(mouseUV.x) : this.material.uniforms.uMouseUV!.value.x;
    const y = Number.isFinite(mouseUV.y) ? clamp(mouseUV.y) : this.material.uniforms.uMouseUV!.value.y;
    this.material.uniforms.uMouseUV!.value.set(x, y);
  }

  updateTime(time: number): void {
    this.material.uniforms.uTime!.value = time;
  }

  /** Update resolution uniform on resize */
  updateSize(w: number, h: number): void {
    this.material.uniforms.uResolution!.value.set(w, h);
  }

  /** Clean up GPU resources */
  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  /** Map ThemeStyle string to numeric type for the shader */
  static styleToType(style: string): number {
    switch (style) {
      case 'sakura': return 1;
      case 'cyberpunk': return 2;
      case 'ink': return 3;
      default: return 0;
    }
  }
}
