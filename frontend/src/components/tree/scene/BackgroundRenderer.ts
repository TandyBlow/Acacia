import * as THREE from 'three';
import { backgroundVertexShader, backgroundFragmentShader } from '../shaders/backgroundRaymarch';
import type { TreeStyleParams } from '../../../constants/theme';

export interface BackgroundUniformParams {
  skyTopColor: [number, number, number];
  skyBottomColor: [number, number, number];
  groundColor: [number, number, number];
  fogColor: [number, number, number];
  fogDistance: number;
  buildingDensity: number;
  buildingHeight: number;
  styleType: number;
  seed: number;
}

/**
 * Full-screen quad with raymarched SDF background.
 * Replaces the old sky2d gradient quad.
 */
export class BackgroundRenderer {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(styleType: number, seed: number) {
    const geo = new THREE.PlaneGeometry(2, 2);

    this.material = new THREE.ShaderMaterial({
      vertexShader: backgroundVertexShader,
      fragmentShader: backgroundFragmentShader,
      uniforms: {
        uSkyTopColor: { value: new THREE.Color(0.53, 0.81, 0.92) },
        uSkyBottomColor: { value: new THREE.Color(0.96, 0.94, 0.92) },
        uFogColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
        uGroundColor: { value: new THREE.Color(0.36, 0.23, 0.12) },
        uFogDistance: { value: 60.0 },
        uBuildingDensity: { value: 0.5 },
        uBuildingHeight: { value: 4.0 },
        uSeed: { value: seed },
        uTime: { value: 0 },
        uStyleType: { value: styleType },
        uResolution: { value: new THREE.Vector2(1024, 1024) },
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

  /** Update all background parameters (called on style change or user data change) */
  update(params: BackgroundUniformParams) {
    const u = this.material.uniforms;
    u.uSkyTopColor!.value.set(...params.skyTopColor);
    u.uSkyBottomColor!.value.set(...params.skyBottomColor);
    u.uGroundColor!.value.set(...params.groundColor);
    u.uFogColor!.value.set(...params.fogColor);
    u.uFogDistance!.value = params.fogDistance;
    u.uBuildingDensity!.value = params.buildingDensity;
    u.uBuildingHeight!.value = params.buildingHeight;
    u.uStyleType!.value = params.styleType;
    u.uSeed!.value = params.seed;
  }

  /** Update time uniform for animated elements */
  updateTime(time: number) {
    this.material.uniforms.uTime!.value = time;
  }

  /** Update resolution uniform on resize */
  updateSize(w: number, h: number) {
    this.material.uniforms.uResolution!.value.set(w, h);
  }

  /** Clean up GPU resources */
  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  /** Build background params from TreeStyleParams */
  static paramsFromTheme(theme: TreeStyleParams, styleType: number, seed: number): BackgroundUniformParams {
    const fogColor: [number, number, number] = [
      theme.skyBottomColor[0] * 0.85,
      theme.skyBottomColor[1] * 0.85,
      theme.skyBottomColor[2] * 0.85,
    ];

    return {
      skyTopColor: theme.skyTopColor,
      skyBottomColor: theme.skyBottomColor,
      groundColor: theme.groundColor,
      fogColor,
      fogDistance: 60.0,
      buildingDensity: 0.5,
      buildingHeight: 4.0,
      styleType,
      seed,
    };
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
