<template>
  <div ref="containerRef" class="tree-canvas">
    <div v-if="isDev" class="dev-buttons">
      <button class="dev-btn" :disabled="busy" @click="onTagNodes">打标签</button>
      <button class="dev-btn" :disabled="busy" @click="onTestSakura">测试樱花</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import * as THREE from 'three';
import { useAuthStore } from '../../stores/authStore';
import { useStyleStore } from '../../stores/styleStore';
import { supabase } from '../../api/supabase';
import { createCelMaterial, createOutlineMaterial, createLeafClusterTexture, createLeafBillboard, type TreeTheme } from './treeMaterials';

interface Branch {
  start: [number, number];
  end: [number, number];
  control1: [number, number];
  control2: [number, number];
  thickness: number;
  node_id: string;
  depth: number;
  descendants?: number;
}

interface SkeletonData {
  branches: Branch[];
  canvas_size: [number, number];
  trunk: Branch[] | null;
  ground: [number, number][] | null;
  roots: Branch[] | null;
}

const BARK_COLORS: Record<TreeTheme, number> = {
  default: 0xA0522D,
  sakura: 0x4a3728,
};
const GROUND_COLOR = 0x5c3a1e;
const DIRT_COLOR = 0x3b2413;
const LEAF_SIZE_MULT: Record<TreeTheme, number> = {
  default: 1.0,
  sakura: 1.25,
};

const containerRef = ref<HTMLDivElement>();
const authStore = useAuthStore();
const styleStore = useStyleStore();
const isDev = import.meta.env.DEV;
const busy = ref(false);

let lastSkeleton: SkeletonData | null = null;
let currentTheme: TreeTheme = 'default';

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let raycaster: THREE.Raycaster;
let branchMeshes: THREE.Mesh[] = [];
let outlineMeshes: THREE.Mesh[] = [];
let leafMeshes: THREE.Mesh[] = [];
let animationFrameId = 0;

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:7860';

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
  scene.background = new THREE.Color(0xf5f0eb);

  // 灯光 — 卡通着色需要光源
  const mainLight = new THREE.DirectionalLight(0xffffff, 3.0);
  mainLight.position.set(10, 10, 10);
  scene.add(mainLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
  fillLight.position.set(-3, 2, 5);
  scene.add(fillLight);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
  scene.add(ambientLight);

  const group = new THREE.Group();
  branchMeshes = [];
  outlineMeshes = [];
  leafMeshes = [];

  // Render ground fill (below wavy line)
  if (skeleton.ground) {
    const groundMesh = createGroundMesh(skeleton.ground, canvasW, canvasH);
    group.add(groundMesh);

    // Ground line on top
    const linePoints = skeleton.ground.map(pt => to3D(pt[0], pt[1], canvasW, canvasH));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineMat = new THREE.LineBasicMaterial({ color: GROUND_COLOR, linewidth: 2 });
    group.add(new THREE.Line(lineGeo, lineMat));
  }

  // Render roots (not clickable)
  if (skeleton.roots) {
    for (const root of skeleton.roots) {
      const mesh = createBranchMesh(root, canvasW, canvasH, GROUND_COLOR);
      group.add(mesh);
      const outline = createOutlineMesh(root, canvasW, canvasH);
      group.add(outline);
      outlineMeshes.push(outline);
    }
  }

  // Render trunk (not clickable)
  if (skeleton.trunk) {
    for (const seg of skeleton.trunk) {
      const mesh = createBranchMesh(seg, canvasW, canvasH);
      group.add(mesh);
      const outline = createOutlineMesh(seg, canvasW, canvasH);
      group.add(outline);
      outlineMeshes.push(outline);
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

    const outline = createOutlineMesh(branch, canvasW, canvasH);
    group.add(outline);
    outlineMeshes.push(outline);
  }

  // 渲染叶片 — 所有枝干末端生成 billboard 叶团
  const leafTextures = [0, 1, 2].map(i => createLeafClusterTexture(i, 128, theme));
  const leafSizeMult = LEAF_SIZE_MULT[theme];
  for (const branch of skeleton.branches) {
    const dx = branch.end[0] - branch.start[0];
    const dy = branch.end[1] - branch.start[1];
    if (Math.hypot(dx, dy) < 5) continue;

    const leaves = createLeavesForBranch(branch, canvasW, canvasH, leafTextures, leafSizeMult);
    for (const leaf of leaves) {
      group.add(leaf);
      leafMeshes.push(leaf);
    }
  }

  scene.add(group);

  // Camera: positioned to see full tree from front
  const aspect = containerRef.value!.clientWidth / containerRef.value!.clientHeight;
  camera = new THREE.PerspectiveCamera(60, aspect, 1, 2000);

  const halfHeight = canvasH / 2;
  const dist = halfHeight / Math.tan(THREE.MathUtils.degToRad(30)) + halfHeight * 0.3;
  camera.position.set(0, 0, dist);
  camera.lookAt(0, 0, 0);
  camera.layers.enable(1); // 渲染描边图层

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(containerRef.value!.clientWidth, containerRef.value!.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  containerRef.value!.appendChild(renderer.domElement);

  raycaster = new THREE.Raycaster();

  renderer.domElement.addEventListener('click', onCanvasClick);
  window.addEventListener('resize', onResize);

  animate();
}

function animate() {
  animationFrameId = requestAnimationFrame(animate);

  // billboard: 叶片始终朝向相机
  if (camera) {
    for (const leaf of leafMeshes) {
      leaf.quaternion.copy(camera.quaternion);
    }
  }

  renderer.render(scene, camera);
}

function onCanvasClick(event: MouseEvent) {
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
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

async function onTagNodes(): Promise<void> {
  const userId = authStore.user?.id;
  if (!userId) return;
  busy.value = true;
  try {
    await styleStore.fetchStyle(userId);
    console.log('[dev] tag result:', styleStore.style, styleStore.distribution);
  } finally {
    busy.value = false;
  }
}

async function onTestSakura(): Promise<void> {
  const userId = authStore.user?.id;
  if (!userId || !supabase) return;
  busy.value = true;
  try {
    const { data } = await supabase
      .from('nodes')
      .select('id')
      .eq('owner_id', userId)
      .eq('is_deleted', false);
    if (data) {
      for (const row of data) {
        await supabase.from('nodes').update({ domain_tag: '日本文化' }).eq('id', row.id);
      }
    }
    const res = await fetch(`${BACKEND_URL}/style/${userId}`);
    if (res.ok) {
      const result = await res.json();
      styleStore.forceStyle('sakura', result.distribution);
      console.log('[dev] force sakura:', result.distribution);
    }
  } finally {
    busy.value = false;
  }
}

async function fetchSkeleton(): Promise<SkeletonData> {
  const userId = authStore.user?.id;
  if (!userId) throw new Error('Not authenticated');

  const res = await fetch(`${BACKEND_URL}/generate-tree-skeleton/${userId}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch skeleton: ${text}`);
  }
  return res.json();
}

const allDisposable: THREE.Object3D[] = [];

function cleanup() {
  cancelAnimationFrame(animationFrameId);
  window.removeEventListener('resize', onResize);

  if (renderer) {
    renderer.domElement.removeEventListener('click', onCanvasClick);
    renderer.dispose();
    if (containerRef.value && renderer.domElement.parentNode === containerRef.value) {
      containerRef.value.removeChild(renderer.domElement);
    }
  }

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
}

onMounted(async () => {
  if (!containerRef.value) return;

  try {
    const skeleton = await fetchSkeleton();
    lastSkeleton = skeleton;
    const theme: TreeTheme = styleStore.style === 'sakura' ? 'sakura' : 'default';
    setupScene(skeleton, theme);
  } catch (err) {
    console.error('Failed to load tree skeleton:', err);
  }
});

watch(() => styleStore.style, (newStyle) => {
  if (!lastSkeleton || !containerRef.value) return;
  const theme: TreeTheme = newStyle === 'sakura' ? 'sakura' : 'default';
  if (theme === currentTheme) return;
  cleanup();
  setupScene(lastSkeleton, theme);
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
