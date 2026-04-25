import * as THREE from 'three';
import type { SkeletonData } from '../../../types/tree';
import type { TreeStyleParams } from '../../../constants/theme';
import { THEME_PRESETS } from '../../../constants/theme';
import type { ThemeStyle } from '../../../stores/styleStore';
import { ThemeTransition } from './ThemeTransition';
import { Tree as EzTree } from '@dgreenheck/ez-tree';
import { mapUserDataToEzTreeParams } from './UserDataMapper';

type EzTreeOptions = EzTree['options'];
import type { StatsNode } from '../../../composables/useStats';
import { ground2dVertexShader, ground2dFragmentShader } from '../shaders/ground2d';
// ground2d import kept for future re-enable
import { sky2dVertexShader, sky2dFragmentShader } from '../shaders/sky2d';
import { crownVertexShader, crownFragmentShader } from '../shaders/crown';
import { outlineVertexShader, outlineFragmentShader } from '../shaders/outline';
// import { particleVertexShader, particleFragmentShader } from '../shaders/particle';

import leafTex1Url from '../../../assets/textures/TreeLeaves01.png';
import leafTex2Url from '../../../assets/textures/TreeLeaves02.png';
import leafTex3Url from '../../../assets/textures/TreeLeaves03.png';

// --- Old proctree imports (kept as reference, commented out) ---
// import { Tree } from '../../../vendor/proctree';
// import { buildTrunkBufferGeometry, buildTwigBufferGeometry, buildCrownSpheres } from './ProctreeGeometry';
// import { crownVertexShader, crownFragmentShader } from '../shaders/crown';

export interface SceneManagerCallbacks {
  onResizeStart: () => void;
  onResizeEnd: () => void;
  onBranchClick: (nodeId: string) => void;
}

export class SceneManager {
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private renderer!: THREE.WebGLRenderer;

  private treeGroup!: THREE.Group;
  private trunkGroup!: THREE.Group;
  private leavesGroup!: THREE.Group;
  private outlineGroup!: THREE.Group;
  // private groundMesh: THREE.Mesh | null = null;
  // private groundMaterial: THREE.ShaderMaterial | null = null;
  private skyMesh: THREE.Mesh | null = null;
  private skyMaterial: THREE.ShaderMaterial | null = null;

  private mainLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;

  private ezTree: EzTree | null = null;
  private leafTextures: THREE.Texture[] = [];
  private currentLeafTextureIndex = 0;

  private themeTransition: ThemeTransition;

  private lastFrameTime = 0;
  private elapsedTime = 0;

  private container: HTMLElement;
  private skeleton: SkeletonData | null = null;
  private currentStyle: ThemeStyle;
  private currentParams: TreeStyleParams;
  private animationFrameId = 0;
  private callbacks: SceneManagerCallbacks;
  private userId = '';
  private lastUserOverrides: Partial<EzTreeOptions> | null = null;

  // Tree bounds for camera fitting
  private treeBounds: THREE.Box3 | null = null;
  private treeCenter = new THREE.Vector3();

  // Resize animation
  private sinkAnimProgress = 0;
  private riseAnimProgress = 0;
  private sinkTargetY = 0;
  private isSinking = false;
  private isRising = false;
  private resizeDebounceTimer: number | null = null;
  private refContainerW = 0;
  private refContainerH = 0;
  private lastContainerW = 0;
  private lastContainerH = 0;
  private treeHeight = 0;

  // Context loss
  private contextLost = false;

  // Particle system (disabled)
  // private particleMesh: THREE.Mesh | null = null;
  // private particleMaterial: THREE.ShaderMaterial | null = null;

  constructor(container: HTMLElement, initialStyle: ThemeStyle, callbacks: SceneManagerCallbacks) {
    this.container = container;
    this.currentStyle = initialStyle;
    this.currentParams = { ...THEME_PRESETS[initialStyle] };
    this.themeTransition = new ThemeTransition(initialStyle);
    this.callbacks = callbacks;
    this.loadLeafTextures();
  }

  private loadLeafTextures() {
    const loader = new THREE.TextureLoader();
    const urls = [leafTex1Url, leafTex2Url, leafTex3Url];
    for (const url of urls) {
      const tex = loader.load(url);
      tex.premultiplyAlpha = true;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.leafTextures.push(tex);
    }
  }

  // --- Public API ---

  buildScene(skeleton: SkeletonData) {
    this.skeleton = skeleton;
    this.disposeScene();

    this.scene = new THREE.Scene();

    this.createSky();
    this.createLights();

    this.treeGroup = new THREE.Group();
    this.treeGroup.name = 'tree';
    this.scene.add(this.treeGroup);

    this.trunkGroup = new THREE.Group();
    this.trunkGroup.name = 'trunk';
    this.treeGroup.add(this.trunkGroup);

    this.leavesGroup = new THREE.Group();
    this.leavesGroup.name = 'leaves';
    this.treeGroup.add(this.leavesGroup);

    this.outlineGroup = new THREE.Group();
    this.outlineGroup.name = 'outline';
    this.outlineGroup.visible = false;
    this.treeGroup.add(this.outlineGroup);

    this.buildTreeMeshes();
    // this.createGround();
    // this.createParticleMesh();
    this.setupCameraAndRenderer();

    this.renderer.domElement.addEventListener('click', this.onCanvasClick);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);

    this.applyStyleParams(this.currentParams);
    this.animate();
  }

  switchTheme(newStyle: ThemeStyle) {
    if (newStyle === this.currentStyle && !this.themeTransition.isRunning) return;
    this.currentStyle = newStyle;
    this.themeTransition.startTransition(newStyle);
  }

  setUserId(id: string) {
    this.userId = id;
  }

  updateUserData(statsNodes: StatsNode[], distribution: Record<string, number>) {
    if (!this.ezTree || !this.userId) return;

    const nodeCount = statsNodes.length;
    const maxDepth = statsNodes.reduce((m, n) => Math.max(m, n.depth), 0);
    const widthDepthRatio = maxDepth > 0 ? nodeCount / maxDepth : 1;

    const overrides = mapUserDataToEzTreeParams(nodeCount, maxDepth, widthDepthRatio, this.userId);
    this.lastUserOverrides = overrides;

    // loadFromJson does a recursive deep-copy merge, so pass overrides directly
    this.ezTree.loadFromJson(overrides);
    this.rebuildTreeGroups();
  }

  handleResize() {
    if (!this.container || !this.camera || !this.renderer) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    if (w === this.lastContainerW && h === this.lastContainerH) return;
    this.lastContainerW = w;
    this.lastContainerH = h;

    if (!this.isSinking && !this.isRising) {
      this.isSinking = true;
      this.sinkAnimProgress = 0;
      this.sinkTargetY = -this.treeHeight * 0.3;
      this.callbacks.onResizeStart();
    }

    if (this.resizeDebounceTimer !== null) {
      window.clearTimeout(this.resizeDebounceTimer);
    }
    this.resizeDebounceTimer = window.setTimeout(() => {
      this.resizeDebounceTimer = null;
      this.onResizeDebounced();
    }, 1000);

    const frustum = this.computeOrthoFrustum(w, h);
    this.camera.left = frustum.left;
    this.camera.right = frustum.right;
    this.camera.top = frustum.top;
    this.camera.bottom = frustum.bottom;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);

    // this.updateGroundLineY();
  }

  async rebuildScene() {
    if (!this.skeleton) return;
    this.disposeScene();
    this.buildScene(this.skeleton);
  }

  setLeafTexture(index: number) {
    if (index < 0 || index >= this.leafTextures.length) return;
    this.currentLeafTextureIndex = index;
    if (this.ezTree?.leavesMesh.material instanceof THREE.ShaderMaterial) {
      this.ezTree.leavesMesh.material.uniforms.uAlphaMask!.value = this.leafTextures[index];
    }
  }

  dispose() {
    this.stopAnimation();
    if (this.resizeDebounceTimer !== null) {
      window.clearTimeout(this.resizeDebounceTimer);
    }
    this.disposeScene();
  }

  // --- Debug API ---

  getCurrentParams(): TreeStyleParams {
    return { ...this.currentParams };
  }

  getEzTreeOptions(): EzTreeOptions | null {
    return this.ezTree ? this.ezTree.options : null;
  }

  setEzTreeOptions(options: EzTreeOptions) {
    if (!this.ezTree) return;
    this.ezTree.loadFromJson(options);
    this.ezTree.generate();
    this.rebuildTreeGroups();
  }

  loadEzTreePreset(presetName: string) {
    if (!this.ezTree) return;
    this.ezTree.loadPreset(presetName);
    this.ezTree.generate();
    this.rebuildTreeGroups();
  }

  setMainLightPos(x: number, y: number, z: number) {
    if (this.mainLight) {
      this.mainLight.position.set(x, y, z);
    }
  }

  setTrunkVisible(visible: boolean) {
    if (this.trunkGroup) {
      this.trunkGroup.visible = visible;
    }
  }

  applyStyleParamsPublic(params: TreeStyleParams) {
    this.applyStyleParams(params);
  }

  // --- Private: Tree generation ---

  private buildTreeMeshes() {
    const params = this.currentParams;

    this.ezTree = new EzTree();
    this.ezTree.loadPreset('Oak Medium');

    // Apply saved user overrides (loadFromJson deep-merges, keeping preset values)
    if (this.lastUserOverrides) {
      this.ezTree.loadFromJson(this.lastUserOverrides);
    }

    this.ezTree.generate();

    // Move branch and leaf meshes from ez-tree into our groups
    this.trunkGroup.add(this.ezTree.branchesMesh);
    this.leavesGroup.add(this.ezTree.leavesMesh);

    // Apply custom materials
    this.applyCustomMaterials();

    // Update bounds for camera
    this.treeGroup.updateMatrixWorld(true);
    this.treeBounds = new THREE.Box3().setFromObject(this.treeGroup);
    this.treeCenter = new THREE.Vector3();
    this.treeBounds.getCenter(this.treeCenter);
    const size = new THREE.Vector3();
    this.treeBounds.getSize(size);
    this.treeHeight = size.y;

    // Build outline meshes (inverted-hull, default hidden)
    this.buildOutlineMeshes();

    // Reposition camera if it already exists
    if (this.camera) {
      this.refitCamera();
      // this.updateGroundLineY();
      // this.updateParticleSpawnArea();
    }
  }

  private applyCustomMaterials() {
    if (!this.ezTree) return;
    const params = this.currentParams;

    // Override trunk material with MeshToonMaterial
    if (this.ezTree.branchesMesh.material instanceof THREE.Material) {
      this.ezTree.branchesMesh.material.dispose();
    }
    this.ezTree.branchesMesh.material = new THREE.MeshToonMaterial({
      color: new THREE.Color(...params.trunkBaseColor),
    });

    // Override leaf material with custom soft toon shader + alpha mask texture
    if (this.ezTree.leavesMesh.material instanceof THREE.Material) {
      this.ezTree.leavesMesh.material.dispose();
    }
    const leafTex = this.leafTextures[this.currentLeafTextureIndex] || this.leafTextures[0];
    const lightDir = this.mainLight
      ? this.mainLight.position.clone().normalize()
      : new THREE.Vector3(0.5, 0.8, 0.3);

    this.ezTree.leavesMesh.material = new THREE.ShaderMaterial({
      vertexShader: crownVertexShader,
      fragmentShader: crownFragmentShader,
      uniforms: {
        uBasisColor: { value: new THREE.Color(...params.leafMidColor) },
        uShadowColor: { value: new THREE.Color(...params.leafDarkColor) },
        uHighlightColor: { value: new THREE.Color(...params.leafLightColor) },
        uAlphaMask: { value: leafTex },
        uAlphaClipping: { value: params.leafAlphaClipping },
        uShadowSize: { value: params.leafShadowSize },
        uShadowSoftness: { value: params.leafShadowSoftness },
        uHighlightSize: { value: params.leafHighlightSize },
        uHighlightSoftness: { value: params.leafHighlightSoftness },
        uLightDir: { value: lightDir },
        uTime: { value: 0 },
        uWindStrength: { value: params.windStrength },
        uWindFrequency: { value: params.windFrequency },
        uWindScale: { value: params.windScale },
      },
      side: THREE.DoubleSide,
      transparent: true,
    });
  }

  private buildOutlineMeshes() {
    this.outlineGroup.clear();
    const outlineColor = new THREE.Color(...this.currentParams.outlineColor);

    // Trunk outline
    if (this.ezTree?.branchesMesh) {
      const outlineMat = new THREE.ShaderMaterial({
        vertexShader: outlineVertexShader,
        fragmentShader: outlineFragmentShader,
        uniforms: {
          uOutlineWidth: { value: 0.04 },
          uOutlineColor: { value: outlineColor },
        },
        side: THREE.BackSide,
      });
      const outlineMesh = new THREE.Mesh(this.ezTree.branchesMesh.geometry, outlineMat);
      this.outlineGroup.add(outlineMesh);
    }

    // Leaves outline
    if (this.ezTree?.leavesMesh) {
      const outlineMat = new THREE.ShaderMaterial({
        vertexShader: outlineVertexShader,
        fragmentShader: outlineFragmentShader,
        uniforms: {
          uOutlineWidth: { value: 0.02 },
          uOutlineColor: { value: outlineColor.clone() },
        },
        side: THREE.BackSide,
      });
      const outlineMesh = new THREE.Mesh(this.ezTree.leavesMesh.geometry, outlineMat);
      this.outlineGroup.add(outlineMesh);
    }
  }

  setOutlineVisible(visible: boolean) {
    if (this.outlineGroup) {
      this.outlineGroup.visible = visible;
    }
  }

  private rebuildTreeGroups() {
    // Remove old meshes from groups (they belong to ez-tree)
    const trunkChildren = [...this.trunkGroup.children];
    for (const child of trunkChildren) {
      this.trunkGroup.remove(child);
    }
    const leafChildren = [...this.leavesGroup.children];
    for (const child of leafChildren) {
      this.leavesGroup.remove(child);
    }

    // Re-add ez-tree meshes
    if (this.ezTree) {
      this.trunkGroup.add(this.ezTree.branchesMesh);
      this.leavesGroup.add(this.ezTree.leavesMesh);
      // Re-apply custom materials (ez-tree generate() resets them)
      this.applyCustomMaterials();
    }

    // Rebuild outline meshes with new geometry
    this.buildOutlineMeshes();

    // Compute bounds at rest position (y=0) to avoid offset from sink/rise animation
    const savedY = this.treeGroup.position.y;
    this.treeGroup.position.y = 0;
    this.treeGroup.updateMatrixWorld(true);
    this.treeBounds = new THREE.Box3().setFromObject(this.treeGroup);
    this.treeBounds.getCenter(this.treeCenter);
    const size = new THREE.Vector3();
    this.treeBounds.getSize(size);
    this.treeHeight = size.y;

    if (this.camera) {
      this.refitCamera();
      // this.updateGroundLineY();
      // this.updateParticleSpawnArea();
    }

    this.treeGroup.position.y = savedY;
  }

  private refitCamera() {
    if (!this.treeBounds || !this.camera) return;
    const w = this.refContainerW || this.container.clientWidth;
    const h = this.refContainerH || this.container.clientHeight;
    const frustum = this.computeOrthoFrustum(w, h);

    this.camera.left = frustum.left;
    this.camera.right = frustum.right;
    this.camera.top = frustum.top;
    this.camera.bottom = frustum.bottom;
    this.camera.updateProjectionMatrix();

    this.camera.position.set(
      this.treeCenter.x,
      this.treeCenter.y,
      this.treeCenter.z + 10,
    );
    this.camera.lookAt(this.treeCenter);
  }

  private computeOrthoFrustum(w: number, h: number) {
    if (!this.treeBounds) {
      const halfH = 4;
      const halfW = halfH * (w / h);
      return { left: -halfW, right: halfW, top: halfH, bottom: -halfH };
    }
    const size = new THREE.Vector3();
    this.treeBounds.getSize(size);
    const padding = 1.3;
    const halfH = (size.y / 2) * padding;
    const halfW = (size.x / 2) * padding;
    const aspect = w / h;
    const frustumHalfH = Math.max(halfH, halfW / aspect);
    const frustumHalfW = frustumHalfH * aspect;
    return { left: -frustumHalfW, right: frustumHalfW, top: frustumHalfH, bottom: -frustumHalfH };
  }

  // --- Private: Sky ---

  private createSky() {
    const params = this.currentParams;
    const geo = new THREE.PlaneGeometry(2, 2);

    this.skyMaterial = new THREE.ShaderMaterial({
      vertexShader: sky2dVertexShader,
      fragmentShader: sky2dFragmentShader,
      uniforms: {
        uSkyTopColor: { value: new THREE.Color(...params.skyTopColor) },
        uSkyBottomColor: { value: new THREE.Color(...params.skyBottomColor) },
      },
      depthWrite: false,
      depthTest: false,
    });

    this.skyMesh = new THREE.Mesh(geo, this.skyMaterial);
    this.skyMesh.name = 'sky';
    this.skyMesh.renderOrder = -2;
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);
  }

  // --- Private: Ground (disabled) ---
  /*
  private createGround() {
    const params = this.currentParams;
    const geo = new THREE.PlaneGeometry(2, 2);

    this.groundMaterial = new THREE.ShaderMaterial({
      vertexShader: ground2dVertexShader,
      fragmentShader: ground2dFragmentShader,
      uniforms: {
        uGroundColor: { value: new THREE.Color(...params.groundColor) },
        uGroundLineY: { value: 0.25 },
        uUndulation: { value: params.groundUndulation },
        uTime: { value: 0 },
      },
      depthWrite: false,
      depthTest: false,
    });

    this.groundMesh = new THREE.Mesh(geo, this.groundMaterial);
    this.groundMesh.name = 'ground';
    this.groundMesh.renderOrder = -1;
    this.groundMesh.frustumCulled = false;
    this.scene.add(this.groundMesh);
  }

  private updateGroundLineY() {
    if (this.groundMaterial && this.treeBounds) {
      const minY = this.treeBounds.min.y;
      const camBottom = this.camera.bottom;
      const camTop = this.camera.top;
      const normalizedY = (minY - camBottom) / (camTop - camBottom);
      this.groundMaterial.uniforms.uGroundLineY!.value = Math.max(0.05, normalizedY);
    }
  }
  */

  // --- Private: Particles (disabled) ---
  /*
  private createParticleMesh() {
    if (!this.treeBounds) return;

    const INSTANCE_COUNT = 300;
    const params = this.currentParams;

    const baseGeo = new THREE.PlaneGeometry(1, 1);
    const instancedGeo = new THREE.InstancedBufferGeometry();
    instancedGeo.index = baseGeo.index;
    instancedGeo.attributes = baseGeo.attributes;
    instancedGeo.instanceCount = INSTANCE_COUNT;

    const seeds = new Float32Array(INSTANCE_COUNT * 4);
    const driftScales = new Float32Array(INSTANCE_COUNT);
    for (let i = 0; i < INSTANCE_COUNT; i++) {
      seeds[i * 4 + 0] = Math.random();
      seeds[i * 4 + 1] = Math.random();
      seeds[i * 4 + 2] = Math.random();
      seeds[i * 4 + 3] = Math.random();
      driftScales[i] = 0.5 + Math.random() * 1.5;
    }
    instancedGeo.setAttribute('aRandomSeeds', new THREE.InstancedBufferAttribute(seeds, 4));
    instancedGeo.setAttribute('aDriftScale', new THREE.InstancedBufferAttribute(driftScales, 1));

    const lightDir = this.mainLight
      ? this.mainLight.position.clone().normalize()
      : new THREE.Vector3(0.5, 0.8, 0.3);

    this.particleMaterial = new THREE.ShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uSpawnMinY: { value: 0 },
        uSpawnMaxY: { value: 0 },
        uGroundY: { value: 0 },
        uSpawnCenterX: { value: 0 },
        uSpawnHalfWidth: { value: 0 },
        uParticleColor: { value: new THREE.Color(...params.particleColor) },
        uParticleShape: { value: params.particleShape },
        uParticleSpeed: { value: params.particleSpeed },
        uParticleDirection: { value: params.particleDirection },
        uParticleSpawnRate: { value: params.particleSpawnRate },
        uParticleSize: { value: params.particleSize },
        uLightDir: { value: lightDir },
        uWindStrength: { value: params.windStrength },
        uWindFrequency: { value: params.windFrequency },
        uWindScale: { value: params.windScale },
      },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });

    this.particleMesh = new THREE.Mesh(instancedGeo, this.particleMaterial);
    this.particleMesh.name = 'particles';
    this.particleMesh.renderOrder = 1;
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);

    this.updateParticleSpawnArea();
  }

  private updateParticleSpawnArea() {
    if (!this.particleMaterial || !this.treeBounds) return;

    const size = new THREE.Vector3();
    this.treeBounds.getSize(size);

    const u = this.particleMaterial.uniforms;
    u.uSpawnMinY!.value = this.treeBounds.max.y - size.y * 0.4;
    u.uSpawnMaxY!.value = this.treeBounds.max.y;
    u.uGroundY!.value = this.treeBounds.min.y;
    if (this.camera) {
      u.uSpawnCenterX!.value = (this.camera.left + this.camera.right) / 2;
      u.uSpawnHalfWidth!.value = (this.camera.right - this.camera.left) / 2;
    } else {
      u.uSpawnCenterX!.value = this.treeCenter.x;
      u.uSpawnHalfWidth!.value = size.x * 0.6;
    }
  }
  */

  // --- Private: Lights ---

  private createLights() {
    const hour = new Date().getHours();
    const lightDir = this.getLightDirection(hour);
    const lightColor = this.getLightColor(hour);

    this.mainLight = new THREE.DirectionalLight(lightColor, this.currentParams.mainLightIntensity);
    this.mainLight.position.copy(lightDir);
    this.scene.add(this.mainLight);

    this.ambientLight = new THREE.AmbientLight(
      new THREE.Color(...this.currentParams.ambientLightColor),
      this.currentParams.ambientLightIntensity,
    );
    this.scene.add(this.ambientLight);
  }

  private getLightDirection(hour: number): THREE.Vector3 {
    if (hour >= 6 && hour < 12) {
      return new THREE.Vector3(10, 10, 10);
    } else if (hour >= 12 && hour < 18) {
      return new THREE.Vector3(0, 12, 8);
    } else {
      return new THREE.Vector3(-8, 3, 5);
    }
  }

  private getLightColor(hour: number): number {
    if (hour >= 6 && hour < 12) {
      return 0xffe8b0;
    } else if (hour >= 12 && hour < 18) {
      return 0xffffff;
    } else {
      return 0x8888ff;
    }
  }

  private setupCameraAndRenderer() {
    const containerW = this.container.clientWidth;
    const containerH = this.container.clientHeight;
    this.refContainerW = containerW;
    this.refContainerH = containerH;
    this.lastContainerW = containerW;
    this.lastContainerH = containerH;

    const frustum = this.computeOrthoFrustum(containerW, containerH);
    this.camera = new THREE.OrthographicCamera(
      frustum.left, frustum.right,
      frustum.top, frustum.bottom,
      0.1, 200,
    );
    this.refitCamera();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(containerW, containerH);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.container.appendChild(this.renderer.domElement);
  }

  // --- Private: Style application ---

  private applyStyleParams(params: TreeStyleParams) {
    this.currentParams = params;

    // Update trunk color
    if (this.ezTree?.branchesMesh.material instanceof THREE.MeshToonMaterial) {
      this.ezTree.branchesMesh.material.color.set(new THREE.Color(...params.trunkBaseColor));
    }

    // Update leaf shader uniforms
    if (this.ezTree?.leavesMesh.material instanceof THREE.ShaderMaterial) {
      const u = this.ezTree.leavesMesh.material.uniforms;
      u.uBasisColor!.value.set(...params.leafMidColor);
      u.uShadowColor!.value.set(...params.leafDarkColor);
      u.uHighlightColor!.value.set(...params.leafLightColor);
      u.uShadowSize!.value = params.leafShadowSize;
      u.uShadowSoftness!.value = params.leafShadowSoftness;
      u.uHighlightSize!.value = params.leafHighlightSize;
      u.uHighlightSoftness!.value = params.leafHighlightSoftness;
      u.uAlphaClipping!.value = params.leafAlphaClipping;
      u.uWindStrength!.value = params.windStrength;
      u.uWindFrequency!.value = params.windFrequency;
      u.uWindScale!.value = params.windScale;
    }

    // Swap leaf texture if index changed
    if (params.leafTextureIndex !== this.currentLeafTextureIndex) {
      this.setLeafTexture(params.leafTextureIndex);
    }

    // Update ground (disabled)
    // if (this.groundMaterial) {
    //   this.groundMaterial.uniforms.uGroundColor!.value.set(...params.groundColor);
    //   this.groundMaterial.uniforms.uUndulation!.value = params.groundUndulation;
    // }

    // Update sky
    if (this.skyMaterial) {
      this.skyMaterial.uniforms.uSkyTopColor!.value.set(...params.skyTopColor);
      this.skyMaterial.uniforms.uSkyBottomColor!.value.set(...params.skyBottomColor);
    }

    // Update lights
    if (this.mainLight) {
      this.mainLight.color.set(...params.mainLightColor);
      this.mainLight.intensity = params.mainLightIntensity;
    }
    if (this.ambientLight) {
      this.ambientLight.color.set(...params.ambientLightColor);
      this.ambientLight.intensity = params.ambientLightIntensity;
    }

    // Update particle shader uniforms (disabled)
    // if (this.particleMaterial) {
    //   const u = this.particleMaterial.uniforms;
    //   u.uParticleColor!.value.set(...params.particleColor);
    //   u.uParticleShape!.value = params.particleShape;
    //   u.uParticleSpeed!.value = params.particleSpeed;
    //   u.uParticleDirection!.value = params.particleDirection;
    //   u.uParticleSpawnRate!.value = params.particleSpawnRate;
    //   u.uParticleSize!.value = params.particleSize;
    //   u.uWindStrength!.value = params.windStrength;
    //   u.uWindFrequency!.value = params.windFrequency;
    //   u.uWindScale!.value = params.windScale;
    //   if (this.mainLight) {
    //     u.uLightDir!.value.copy(this.mainLight.position).normalize();
    //   }
    // }
  }

  // --- Private: Animation loop ---

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    if (!this.container || this.container.offsetParent === null || this.contextLost) return;

    const now = performance.now() / 1000;
    const dt = this.lastFrameTime === 0 ? 0.016 : Math.min(now - this.lastFrameTime, 0.1);
    this.lastFrameTime = now;
    this.elapsedTime += dt;

    // Theme transition
    const transitionParams = this.themeTransition.update(performance.now());
    if (transitionParams) {
      this.applyStyleParams(transitionParams);
    }

    // Wind sway + time update for custom leaf shader
    if (this.ezTree?.leavesMesh.material instanceof THREE.ShaderMaterial) {
      const u = this.ezTree.leavesMesh.material.uniforms;
      u.uTime!.value = this.elapsedTime;
      if (this.mainLight) {
        u.uLightDir!.value.copy(this.mainLight.position).normalize();
      }
    }

    // Sink/rise animations
    if (this.isSinking && this.treeGroup) {
      this.sinkAnimProgress += dt / 0.3;
      if (this.sinkAnimProgress >= 1) {
        this.sinkAnimProgress = 1;
        this.isSinking = false;
      }
      const eased = 1 - Math.pow(1 - this.sinkAnimProgress, 3);
      this.treeGroup.position.y = this.sinkTargetY * eased;
    }

    if (this.isRising && this.treeGroup) {
      this.riseAnimProgress += dt / 0.4;
      if (this.riseAnimProgress >= 1) {
        this.riseAnimProgress = 1;
        this.isRising = false;
        this.callbacks.onResizeEnd();
      }
      const eased = 1 - Math.pow(1 - this.riseAnimProgress, 3);
      this.treeGroup.position.y = this.sinkTargetY * (1 - eased);
    }

    // Update ground time uniform (disabled)
    // if (this.groundMaterial) {
    //   this.groundMaterial.uniforms.uTime!.value = this.elapsedTime;
    // }

    // Update particle time uniform (disabled)
    // if (this.particleMaterial) {
    //   this.particleMaterial.uniforms.uTime!.value = this.elapsedTime;
    // }

    this.renderer.render(this.scene, this.camera);
  };

  // --- Private: Event handlers ---

  private onCanvasClick = (_event: MouseEvent) => {};

  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
  };

  private onContextRestored = () => {
    this.contextLost = false;
    if (this.skeleton) {
      this.rebuildScene();
    }
  };

  private async onResizeDebounced() {
    if (!this.skeleton) {
      this.callbacks.onResizeEnd();
      return;
    }

    // Compute bounds at rest position (y=0) to avoid offset from sink animation
    this.treeGroup.position.y = 0;
    this.treeGroup.updateMatrixWorld(true);
    this.treeBounds = new THREE.Box3().setFromObject(this.treeGroup);
    this.treeBounds.getCenter(this.treeCenter);

    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w > 0 && h > 0) {
      const frustum = this.computeOrthoFrustum(w, h);
      this.camera.left = frustum.left;
      this.camera.right = frustum.right;
      this.camera.top = frustum.top;
      this.camera.bottom = frustum.bottom;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(
        this.treeCenter.x,
        this.treeCenter.y,
        this.treeCenter.z + 10,
      );
      this.camera.lookAt(this.treeCenter);
    }

    // this.updateGroundLineY();
    // this.updateParticleSpawnArea();

    // Set sunk position for rise animation
    this.treeGroup.position.y = this.sinkTargetY;
    this.isRising = true;
    this.riseAnimProgress = 0;
  }

  private stopAnimation() {
    cancelAnimationFrame(this.animationFrameId);
  }

  private disposeScene() {
    this.stopAnimation();

    if (this.resizeDebounceTimer !== null) {
      window.clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = null;
    }

    if (this.renderer) {
      this.renderer.domElement.removeEventListener('click', this.onCanvasClick);
      this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
      this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    }

    // Dispose leaf shader material (we own it)
    if (this.ezTree?.leavesMesh.material instanceof THREE.ShaderMaterial) {
      this.ezTree.leavesMesh.material.dispose();
    }

    // Dispose outline materials
    if (this.outlineGroup) {
      for (const child of this.outlineGroup.children) {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
      this.outlineGroup.clear();
    }

    // Dispose ez-tree (it owns the mesh geometries)
    this.ezTree = null;

    // Clear group children references (meshes were owned by ez-tree)
    if (this.trunkGroup) this.trunkGroup.clear();
    if (this.leavesGroup) this.leavesGroup.clear();

    // Dispose ground (disabled)
    // if (this.groundMesh) {
    //   this.groundMesh.geometry.dispose();
    //   if (this.groundMaterial) {
    //     this.groundMaterial.dispose();
    //     this.groundMaterial = null;
    //   }
    //   this.groundMesh = null;
    // }

    // Dispose particle system (disabled)
    // if (this.particleMesh) {
    //   this.particleMesh.geometry.dispose();
    //   if (this.particleMaterial) {
    //     this.particleMaterial.dispose();
    //     this.particleMaterial = null;
    //   }
    //   this.scene.remove(this.particleMesh);
    //   this.particleMesh = null;
    // }

    // Dispose sky
    if (this.skyMesh) {
      this.skyMesh.geometry.dispose();
      if (this.skyMaterial) {
        this.skyMaterial.dispose();
        this.skyMaterial = null;
      }
      this.skyMesh = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode === this.container) {
        this.container.removeChild(this.renderer.domElement);
      }
    }

    this.contextLost = false;
  }
}
