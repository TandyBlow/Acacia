<template>
  <div ref="containerRef" class="tree-canvas">
    <div v-if="noTreeData" class="no-tree-msg">{{ UI.tree.noBackend }}</div>
    <div v-if="isDev && !noTreeData" class="dev-buttons">
      <button class="dev-btn" :disabled="busy" @click="onTagNodes">{{ UI.tree.devTagNodes }}</button>
      <button class="dev-btn" :disabled="busy" @click="onTestSakura">{{ UI.tree.devTestSakura }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, provide, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import * as THREE from 'three';
import { useAuthStore } from '../../stores/authStore';
import { useStyleStore } from '../../stores/styleStore';
import { useTreeSkeleton, invalidateSkeleton } from '../../composables/useTreeSkeleton';
import { createCelMaterial, createOutlineMaterial, createLeafClusterTexture, createLeafBillboard, createSkyGradient, createParticleTexture, sharedPlaneGeo, type TreeTheme } from './treeMaterials';
import type { Branch, SkeletonData } from '../../types/tree';
import { BARK_COLORS, GROUND_COLOR, DIRT_COLOR, LEAF_SIZE_MULT, SKY_COLORS } from '../../constants/theme';
import { UI } from '../../constants/uiStrings';

const containerRef = ref<HTMLDivElement>();
const props = defineProps<{ visible?: boolean }>();
const authStore = useAuthStore();
const { isAuthenticated } = storeToRefs(authStore);
const styleStore = useStyleStore();
const { busy, fetchSkeleton, onTagNodes, onTestSakura } = useTreeSkeleton();
const isDev = import.meta.env.DEV;
const noTreeData = ref(false);

let lastSkeleton: SkeletonData | null = null;
let currentTheme: TreeTheme = 'default';

const isResizing = ref(false);
let resizeDebounceTimer: number | null = null;

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let raycaster: THREE.Raycaster;
let branchMeshes: THREE.Mesh[] = [];
let outlineMeshes: THREE.Mesh[] = [];
let leafMeshes: THREE.Mesh[] = [];
let particles: THREE.Mesh[] = [];
let clock: THREE.Clock | null = null;
const PARTICLE_COUNT = 30;
let animationFrameId = 0;
let resizeObserver: ResizeObserver | null = null;
let refContainerW = 0;
let refContainerH = 0;
let refCameraDist = 0;
let contextLost = false;

function onContextLost(event: Event) {
  event.preventDefault();
  contextLost = true;
}

function onContextRestored() {
  contextLost = false;
  if (lastSkeleton && containerRef.value) {
    redrawTree();
  }
}

function to3D(x: number, y: number, canvasW: number, canvasH: number): THREE.Vector3 {
  return new THREE.Vector3(
    x - canvasW / 2,
    canvasH / 2 - y,
    0,
  );
}

function createBranchMesh(branch: Branch, canvasW: number, canvasH: number, color?: number): THREE.Mesh {
  const curve = new THREE.CubicBezierCurve3(
    to3D(branch.start[0], branch.start[1], canvasW, canvasH),
    to3D(branch.control1[0], branch.control1[1], canvasW, canvasH),
    to3D(branch.control2[0], branch.control2[1], canvasW, canvasH),
    to3D(branch.end[0], branch.end[1], canvasW, canvasH),
  );

  const radius = Math.max(0.3, branch.thickness * 0.3);
  const geometry = new THREE.TubeGeometry(curve, 20, radius, 8, false);
  const material = createCelMaterial(color ?? BARK_COLORS[currentTheme]);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.nodeId = branch.node_id;
  return mesh;
}

function createOutlineMesh(branch: Branch, canvasW: number, canvasH: number): THREE.Mesh {
  const curve = new THREE.CubicBezierCurve3(
    to3D(branch.start[0], branch.start[1], canvasW, canvasH),
    to3D(branch.control1[0], branch.control1[1], canvasW, canvasH),
    to3D(branch.control2[0], branch.control2[1], canvasW, canvasH),
    to3D(branch.end[0], branch.end[1], canvasW, canvasH),
  );

  const radius = Math.max(0.3, branch.thickness * 0.3);
  const geometry = new THREE.TubeGeometry(curve, 20, radius, 8, false);
  const outlineWidth = Math.max(0.16, radius * 0.5);
  const material = createOutlineMaterial(outlineWidth);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 999;
  mesh.layers.set(1);
  mesh.userData.isOutline = true;
  return mesh;
}

function createLeavesForBranch(
  branch: Branch,
  canvasW: number,
  canvasH: number,
  leafTextures: THREE.Texture[],
  sizeMult = 1.0,
): THREE.Mesh[] {
  const curve = new THREE.CubicBezierCurve3(
    to3D(branch.start[0], branch.start[1], canvasW, canvasH),
    to3D(branch.control1[0], branch.control1[1], canvasW, canvasH),
    to3D(branch.control2[0], branch.control2[1], canvasW, canvasH),
    to3D(branch.end[0], branch.end[1], canvasW, canvasH),
  );

  const descendants = branch.descendants ?? 0;

  // 叶团基础大小根据深度递减
  const baseSize = Math.max(15.0, (50.0 - branch.depth * 6.0) * sizeMult);
  // 子节点越多叶团越大
  const sizeMultiplier = 1.0 + descendants * 0.06;

  // 末端位置
  const endPos = curve.getPoint(1.0);

  // 枝干末端方向，用于将叶团中心往回偏移
  const tangent = curve.getTangent(1.0).normalize();

  // 叶团中心沿枝干方向往回偏移，让枝桠末端从叶团边缘探出
  const pullback = baseSize * sizeMultiplier * 0.25;
  const clusterCenter = endPos.clone().addScaledVector(tangent, -pullback);

  // 5~8 个 billboard 互相错开
  const count = 5 + Math.floor(Math.random() * 4);

  const meshes: THREE.Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const w = baseSize * sizeMultiplier * (0.7 + Math.random() * 0.8);
    const h = w * (0.7 + Math.random() * 0.5);
    // 更大随机偏移让轮廓参差不齐
    const scatter = baseSize * sizeMultiplier * 0.55;
    const offsetX = (Math.random() - 0.5) * scatter;
    // Y偏移只取上半部分（0~1），避免叶片出现在枝桠正下方
    const offsetY = Math.random() * scatter * 0.5;
    const offsetZ = (Math.random() - 0.5) * 2;
    const offset = new THREE.Vector3(offsetX, offsetY, offsetZ);
    const pos = clusterCenter.clone().add(offset);

    // 随机选一种绿色纹理
    const colorIdx = Math.floor(Math.random() * 3);
    meshes.push(createLeafBillboard(pos, w, h, leafTextures[colorIdx]!));
  }

  // 子节点多时在接近末端补 1~3 个额外 billboard
  const extra = Math.min(3, Math.floor(descendants / 3));
  for (let i = 0; i < extra; i++) {
    const t = 0.55 + Math.random() * 0.3;
    const pos = curve.getPoint(t);
    const w = baseSize * sizeMultiplier * (0.5 + Math.random() * 0.5);
    const h = w * (0.6 + Math.random() * 0.5);
    const scatter = baseSize * sizeMultiplier * 0.45;
    const offsetX = (Math.random() - 0.5) * scatter;
    const offsetY = Math.random() * scatter * 0.5;
    const offset = new THREE.Vector3(offsetX, offsetY, (Math.random() - 0.5) * 2);
    pos.add(offset);

    const colorIdx = Math.floor(Math.random() * 3);
    meshes.push(createLeafBillboard(pos, w, h, leafTextures[colorIdx]!));
  }

  return meshes;
}

function createGroundMesh(ground: [number, number][], canvasW: number, canvasH: number): THREE.Mesh {
  const shape = new THREE.Shape();

  // Top edge: wavy ground line
  const first = to3D(ground[0]![0], ground[0]![1], canvasW, canvasH);
  shape.moveTo(first.x, first.y);

  for (let i = 1; i < ground.length; i++) {
    const pt = to3D(ground[i]![0], ground[i]![1], canvasW, canvasH);
    shape.lineTo(pt.x, pt.y);
  }

  // Close: down to bottom-right, across to bottom-left, back up
  const last = to3D(ground[ground.length - 1]![0], ground[ground.length - 1]![1], canvasW, canvasH);
  const bottom = -(canvasH / 2) - 10;
  shape.lineTo(last.x, bottom);
  shape.lineTo(first.x, bottom);
  shape.lineTo(first.x, first.y);

  const geometry = new THREE.ShapeGeometry(shape);
  const material = new THREE.MeshBasicMaterial({ color: DIRT_COLOR, side: THREE.DoubleSide });
  return new THREE.Mesh(geometry, material);
}

function setupScene(skeleton: SkeletonData, theme: TreeTheme = 'default') {
  currentTheme = theme;
  const [canvasW, canvasH] = skeleton.canvas_size;

  scene = new THREE.Scene();
  const skyColors = SKY_COLORS[theme] ?? SKY_COLORS.default;
  scene.background = createSkyGradient(skyColors.top, skyColors.bottom);

  // 灯光 — 卡通着色需要光源
  const mainLight = new THREE.DirectionalLight(0xffffff, 3.0);
  mainLight.position.set(10, 10, 10);
  scene.add(mainLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
  fillLight.position.set(-3, 2, 5);
  scene.add(fillLight);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
  scene.add(ambientLight);

  clock = new THREE.Clock();

  const group = new THREE.Group();
  branchMeshes = [];
  outlineMeshes = [];
  leafMeshes = [];
  particles = [];

  // Render ground fill (below wavy line)
  if (skeleton.ground) {
    const groundMesh = createGroundMesh(skeleton.ground, canvasW, canvasH);
    group.add(groundMesh);
    allDisposable.push(groundMesh);

    // Ground line on top
    const linePoints = skeleton.ground.map(pt => to3D(pt[0], pt[1], canvasW, canvasH));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineMat = new THREE.LineBasicMaterial({ color: GROUND_COLOR, linewidth: 2 });
    const line = new THREE.Line(lineGeo, lineMat);
    group.add(line);
    allDisposable.push(line);
  }

  // Render roots (not clickable)
  if (skeleton.roots) {
    for (const root of skeleton.roots) {
      const mesh = createBranchMesh(root, canvasW, canvasH, GROUND_COLOR);
      group.add(mesh);
      allDisposable.push(mesh);
      const outline = createOutlineMesh(root, canvasW, canvasH);
      group.add(outline);
      outlineMeshes.push(outline);
      allDisposable.push(outline);
    }
  }

  // Render trunk (not clickable)
  if (skeleton.trunk) {
    for (const seg of skeleton.trunk) {
      const mesh = createBranchMesh(seg, canvasW, canvasH);
      group.add(mesh);
      allDisposable.push(mesh);
      const outline = createOutlineMesh(seg, canvasW, canvasH);
      group.add(outline);
      outlineMeshes.push(outline);
      allDisposable.push(outline);
    }
  }

  // Render real node branches (clickable)
  for (const branch of skeleton.branches) {
    const dx = branch.end[0] - branch.start[0];
    const dy = branch.end[1] - branch.start[1];
    const len = Math.hypot(dx, dy);

    console.log(
      `branch node_id=${branch.node_id.slice(0, 8)} depth=${branch.depth} ` +
      `start=(${branch.start[0].toFixed(1)}, ${branch.start[1].toFixed(1)}) ` +
      `end=(${branch.end[0].toFixed(1)}, ${branch.end[1].toFixed(1)}) ` +
      `len=${len.toFixed(2)} thickness=${branch.thickness}`
    );

    if (len < 5) {
      console.warn(`SKIPPED branch (len=${len.toFixed(2)} < 5): node_id=${branch.node_id}`);
      continue;
    }
    const mesh = createBranchMesh(branch, canvasW, canvasH);
    group.add(mesh);
    branchMeshes.push(mesh);
    allDisposable.push(mesh);

    const outline = createOutlineMesh(branch, canvasW, canvasH);
    group.add(outline);
    outlineMeshes.push(outline);
    allDisposable.push(outline);
  }

  // 渲染叶片 — 所有枝干末端生成 billboard 叶团
  const leafTextures = [0, 1, 2].map(i => createLeafClusterTexture(i, 128, theme));
  const leafSizeMult = LEAF_SIZE_MULT[theme];
  let leafIdx = 0;
  for (const branch of skeleton.branches) {
    const dx = branch.end[0] - branch.start[0];
    const dy = branch.end[1] - branch.start[1];
    if (Math.hypot(dx, dy) < 5) continue;

    const leaves = createLeavesForBranch(branch, canvasW, canvasH, leafTextures, leafSizeMult);
    for (const leaf of leaves) {
      group.add(leaf);
      leafMeshes.push(leaf);
      allDisposable.push(leaf);
      // Store initial position and phase for sway animation
      leaf.userData.initialPosition = leaf.position.clone();
      leaf.userData.phaseOffset = leafIdx * 2.399; // golden angle
      leafIdx++;
    }
  }

  // 飘落粒子
  const particleTexture = createParticleTexture(theme);
  const groundY = -(canvasH / 2);
  const resetY = canvasH * 0.5;
  const crownWidth = canvasW * 0.8;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const pSize = 2 + Math.random() * 4;
    const material = new THREE.MeshBasicMaterial({
      map: particleTexture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(sharedPlaneGeo, material);
    mesh.scale.set(pSize, pSize, 1);
    mesh.layers.set(1); // No raycast
    mesh.renderOrder = -2;
    mesh.position.set(
      (Math.random() - 0.5) * crownWidth,
      resetY + Math.random() * canvasH * 0.3,
      (Math.random() - 0.5) * 10,
    );
    mesh.userData = {
      fallSpeed: 15 + Math.random() * 25,
      swayAmplitude: 3 + Math.random() * 6,
      swayFrequency: 0.3 + Math.random() * 0.5,
      rotateSpeed: (Math.random() - 0.5) * 0.02,
      phaseOffset: Math.random() * Math.PI * 2,
      startX: mesh.position.x,
      resetY,
      groundY,
    };
    scene.add(mesh);
    particles.push(mesh);
    allDisposable.push(mesh);
  }

  scene.add(group);

  // Camera: positioned to see full tree from front, fitted to container
  const containerW = containerRef.value!.clientWidth;
  const containerH = containerRef.value!.clientHeight;
  refContainerW = containerW;
  refContainerH = containerH;

  const aspect = containerW / containerH;
  camera = new THREE.PerspectiveCamera(60, aspect, 1, 2000);

  const [skeletonW, skeletonH] = skeleton.canvas_size;
  const skeletonAspect = skeletonW / skeletonH;
  let fitHeight: number;
  if (aspect >= skeletonAspect) {
    fitHeight = skeletonH;
  } else {
    fitHeight = skeletonW / aspect;
  }
  refCameraDist = fitHeight / 2 / Math.tan(THREE.MathUtils.degToRad(30));
  camera.position.set(0, 0, refCameraDist);
  camera.lookAt(0, 0, 0);
  camera.layers.enable(1); // 渲染描边图层

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(containerRef.value!.clientWidth, containerRef.value!.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  containerRef.value!.appendChild(renderer.domElement);

  raycaster = new THREE.Raycaster();

  renderer.domElement.addEventListener('click', onCanvasClick);
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);
  resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(containerRef.value!);

  animate();
}

function animate() {
  animationFrameId = requestAnimationFrame(animate);

  if (!containerRef.value || containerRef.value.offsetParent === null || contextLost) return;

  const elapsed = clock ? clock.getElapsedTime() : 0;

  // billboard: 叶片始终朝向相机 + 微风摇摆
  if (camera) {
    for (const leaf of leafMeshes) {
      leaf.quaternion.copy(camera.quaternion);
      const ip = leaf.userData.initialPosition;
      const po = leaf.userData.phaseOffset;
      if (ip) {
        const scale = Math.max(leaf.scale.x, 1) * 0.02;
        leaf.position.x = ip.x + Math.sin(elapsed * 0.8 + po) * scale * 4;
        leaf.position.y = ip.y + Math.sin(elapsed * 0.6 + po * 1.3) * scale * 2;
      }
    }
  }

  // 飘落粒子更新
  if (camera && particles.length > 0) {
    for (const p of particles) {
      const ud = p.userData;
      p.position.y -= ud.fallSpeed * 0.016;
      p.position.x = ud.startX + Math.sin(elapsed * ud.swayFrequency + ud.phaseOffset) * ud.swayAmplitude;
      p.rotation.z += ud.rotateSpeed;
      p.quaternion.copy(camera.quaternion);
      if (p.position.y < ud.groundY) {
        p.position.y = ud.resetY;
        ud.startX = (Math.random() - 0.5) * (lastSkeleton ? lastSkeleton.canvas_size[0] * 0.8 : 100);
      }
    }
  }

  renderer.render(scene, camera);
}

function onCanvasClick(event: MouseEvent) {
  if (isResizing.value) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(branchMeshes, false);

  if (hits.length > 0) {
    const nodeId = hits[0]!.object.userData.nodeId;
    console.log('Clicked branch, node_id:', nodeId);
  }
}

function onResize() {
  if (!containerRef.value || !camera || !renderer) return;
  const w = containerRef.value.clientWidth;
  const h = containerRef.value.clientHeight;
  if (w === 0 || h === 0 || refContainerW === 0 || refContainerH === 0) return;
  // 尺寸与 setupScene 刚设置的一致则跳过（防止 ResizeObserver 初始回调触发无限重绘）
  if (w === refContainerW && h === refContainerH) return;

  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);

  const scaleX = w / refContainerW;
  const scaleY = h / refContainerH;
  const scale = Math.min(scaleX, scaleY);
  camera.position.z = refCameraDist / scale;
  camera.lookAt(0, 0, 0);

  isResizing.value = true;

  if (resizeDebounceTimer !== null) {
    window.clearTimeout(resizeDebounceTimer);
  }
  resizeDebounceTimer = window.setTimeout(() => {
    resizeDebounceTimer = null;
    redrawTree();
  }, 1000);
}

async function redrawTree() {
  if (!lastSkeleton || !containerRef.value) {
    isResizing.value = false;
    return;
  }
  // 窗口大小变化时用新尺寸重新生成骨架，让树匹配新的容器比例
  cleanup();
  invalidateSkeleton();
  treeLoaded = false;
  await loadTree();
  isResizing.value = false;
}

const allDisposable: THREE.Object3D[] = [];

function cleanup() {
  cancelAnimationFrame(animationFrameId);
  if (resizeDebounceTimer !== null) {
    window.clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = null;
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
  clock = null;

  if (renderer) {
    renderer.domElement.removeEventListener('click', onCanvasClick);
    renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
    renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
    renderer.dispose();
    if (containerRef.value && renderer.domElement.parentNode === containerRef.value) {
      containerRef.value.removeChild(renderer.domElement);
    }
  }
  contextLost = false;

  for (const obj of allDisposable) {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    });
  }
  allDisposable.length = 0;
  branchMeshes = [];
  outlineMeshes = [];
  leafMeshes = [];
  particles = [];
}

provide('isTreeResizing', isResizing);

let treeLoaded = false;

async function loadTree() {
  if (!containerRef.value || treeLoaded) return;

  try {
    const cw = containerRef.value.clientWidth;
    const ch = containerRef.value.clientHeight;
    const skeleton = await fetchSkeleton(cw || undefined, ch || undefined);
    if (!skeleton.branches || skeleton.branches.length === 0) {
      noTreeData.value = true;
      return;
    }
    lastSkeleton = skeleton;
    const theme: TreeTheme = styleStore.style === 'sakura' ? 'sakura' : 'default';
    setupScene(skeleton, theme);
    treeLoaded = true;
  } catch (err) {
    noTreeData.value = true;
    console.error('Failed to load tree skeleton:', err);
  }
}

watch(isAuthenticated, (authed) => {
  if (authed) {
    loadTree();
  } else {
    cleanup();
    treeLoaded = false;
    noTreeData.value = false;
  }
}, { immediate: true });

onMounted(() => {
  if (isAuthenticated.value && !treeLoaded) {
    loadTree();
  }
});

watch(() => styleStore.style, (newStyle) => {
  if (!lastSkeleton || !containerRef.value) return;
  const theme: TreeTheme = newStyle === 'sakura' ? 'sakura' : 'default';
  if (theme === currentTheme) return;
  cleanup();
  setupScene(lastSkeleton, theme);
});

function onBecameVisible() {
  if (!lastSkeleton || !containerRef.value) return;
  // 始终重建场景，确保 renderer/scene 尺寸与容器一致
  redrawTree();
}

watch(() => props.visible, async (nowVisible, wasVisible) => {
  if (!nowVisible || wasVisible) return;
  // 等 v-show 的 DOM 更新生效（容器从 display:none 恢复）
  await nextTick();
  // 再等一帧确保浏览器完成布局计算
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  onBecameVisible();
});

onBeforeUnmount(() => {
  cleanup();
});
</script>

<style scoped>
.tree-canvas {
  width: 100%;
  height: 100%;
  position: relative;
}

.no-tree-msg {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--color-primary);
  opacity: 0.6;
  font-size: 16px;
  font-weight: 600;
}

.dev-buttons {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  gap: 8px;
}

.dev-btn {
  padding: 6px 14px;
  border: 1px solid var(--color-glass-border);
  border-radius: 12px;
  background: var(--color-glass-bg);
  backdrop-filter: blur(10px);
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 160ms ease;
}

.dev-btn:disabled {
  opacity: 0.4;
  cursor: wait;
}

.dev-btn:hover:not(:disabled) {
  opacity: 0.8;
}
</style>
