import * as THREE from 'three';
import { backgroundVertexShader, backgroundFragmentShader } from '../shaders/backgroundRaymarch';
import { createUniforms, applyParamsToUniforms, generateGlslUniforms } from './SdfParamRegistry';
import type { TreeStyleParams } from '../../../constants/theme';
import { SDF_PRIMITIVES } from '../shaders/sdfPrimitives';
import { SDF_ARCHITECTURE } from '../shaders/sdfArchitecture';
import { SDF_PLATFORMS } from '../shaders/sdfPlatforms';
import mapDefaultSrc from '../shaders/vista/mapDefault.glsl?raw';
import mapSakuraSrc from '../shaders/vista/mapSakura.glsl?raw';
import mapCyberpunkSrc from '../shaders/vista/mapCyberpunk.glsl?raw';
import mapInkSrc from '../shaders/vista/mapInk.glsl?raw';

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

    // TEMP: Debug raymarching - show hit/miss in red/blue
    const testFragmentShader = /* glsl */ `
      ${generateGlslUniforms()}
      uniform float uTime;
      uniform float uSeed;
      uniform float uStyleType;
      uniform vec2 uResolution;
      uniform vec2 uMouseUV;
      ${SDF_PRIMITIVES}
      ${SDF_ARCHITECTURE}
      ${mapDefaultSrc}
      ${mapSakuraSrc}
      ${mapCyberpunkSrc}
      ${mapInkSrc}
      ${SDF_PLATFORMS}

      varying vec2 vScreenUV;

      float mapVista(vec3 p) {
        int style = int(uStyleType + 0.5);
        if (style == 1) return mapSakura(p);
        else if (style == 2) return mapCyberpunk(p);
        else if (style == 3) return mapInk(p);
        else return mapDefault(p);
      }

      float mapPlatform(vec3 p) {
        vec3 ro = vec3(0.0, uCamY, uCamZ);
        vec3 forward = normalize(vec3(0.0, sin(uCamPitch), cos(uCamPitch)));
        vec3 platformOrigin = ro + forward * uPlatformZ;
        platformOrigin.y -= 2.0;  // Drop platform 2.0 units below camera
        return sdPlatform(p - platformOrigin, uPlatformType);
      }

      float map(vec3 p) {
        return min(mapVista(p), mapPlatform(p));
      }

      void main() {
        vec3 ro = vec3(0.0, uCamY, uCamZ);
        vec3 forward = normalize(vec3(0.0, sin(uCamPitch), cos(uCamPitch)));
        vec3 worldUp = vec3(0.0, 1.0, 0.0);
        vec3 right = normalize(cross(forward, worldUp));
        vec3 up = cross(right, forward);

        float aspect = uResolution.x / uResolution.y;
        vec2 uv = vScreenUV * 2.0 - 1.0;
        uv.x *= aspect;
        vec3 rd = normalize(forward + right * uv.x * uFovZoom + up * uv.y * uFovZoom);

        // Early sky check: if ray points significantly upward, treat as sky
        if (rd.y > 0.3) {
          gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0);  // Blue = sky
          return;
        }

        float t = 0.0;
        float tMax = uFogDistance + 10.0;
        bool hit = false;

        for (int i = 0; i < 80; i++) {
          vec3 p = ro + rd * t;
          float d = map(p);

          if (d < 0.001) {
            hit = true;
            break;
          }
          t += max(d * 0.8, 0.02);
          if (t > tMax) break;
        }

        // Simple: red if hit anything, blue if miss (sky)
        vec3 col = hit ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    this.material = new THREE.ShaderMaterial({
      vertexShader: backgroundVertexShader,
      fragmentShader: backgroundFragmentShader,
      uniforms: {
        ...registryUniforms,
        // Non-registry dynamic uniforms (not managed by SdfParamRegistry)
        uFogColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
        uTime: { value: 0 },
        uSeed: { value: seed },
        uStyleType: { value: styleType },
        uResolution: { value: new THREE.Vector2(1024, 1024) },
        uMouseUV: { value: new THREE.Vector2(0.5, 0.5) }, // CAM-05: initial centered
      },
      depthWrite: false,
      depthTest: false,
    });

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

  /** Debug: directly set platform type uniform (0-4) without going through params. */
  setPlatformType(type: number): void {
    const t = Math.round(Math.max(0, Math.min(4, type)));
    this.material.uniforms.uPlatformType!.value = t;
  }

  /** Debug: directly set platform Z distance uniform (2-5). */
  setPlatformZ(z: number): void {
    this.material.uniforms.uPlatformZ!.value = Math.max(2, Math.min(5, z));
  }

  /** Update time uniform for animated elements */
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
