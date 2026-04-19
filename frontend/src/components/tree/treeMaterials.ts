import * as THREE from 'three';
import { outlineVertexShader, outlineFragmentShader, createCelGradientMap } from './treeShaders';

let sharedGradientMap: THREE.DataTexture | null = null;

function getGradientMap(): THREE.DataTexture {
  if (!sharedGradientMap) {
    sharedGradientMap = createCelGradientMap();
  }
  return sharedGradientMap;
}

// 卡通着色材质（替代 MeshBasicMaterial）
export function createCelMaterial(color: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: getGradientMap(),
  });
}

// 描边材质（反面渲染 + 法线膨胀）
export function createOutlineMaterial(width: number = 0.3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: outlineVertexShader,
    fragmentShader: outlineFragmentShader,
    uniforms: {
      uOutlineWidth: { value: width },
      uOutlineColor: { value: new THREE.Color(0x2C1A0E) },
    },
    side: THREE.BackSide,
    depthWrite: false,
  });
}

// 共享 billboard 几何体
const sharedPlaneGeo = new THREE.PlaneGeometry(1, 1);

const LEAF_COLORS = [
  { stops: ['rgba(50, 120, 30, 0.95)', 'rgba(60, 130, 35, 0.85)', 'rgba(45, 100, 25, 0.5)', 'rgba(30, 70, 15, 0)'] },   // 深绿
  { stops: ['rgba(80, 160, 45, 0.95)', 'rgba(90, 170, 50, 0.85)', 'rgba(70, 140, 35, 0.5)', 'rgba(50, 110, 20, 0)'] },   // 中绿
  { stops: ['rgba(130, 190, 50, 0.95)', 'rgba(140, 200, 55, 0.85)', 'rgba(110, 170, 40, 0.5)', 'rgba(80, 130, 25, 0)'] }, // 黄绿
];

const SAKURA_LEAF_COLORS = [
  { stops: ['rgba(255, 183, 197, 0.95)', 'rgba(255, 192, 203, 0.85)', 'rgba(255, 210, 220, 0.5)', 'rgba(255, 220, 230, 0)'] }, // 浅粉
  { stops: ['rgba(255, 255, 255, 0.95)', 'rgba(255, 245, 248, 0.85)', 'rgba(255, 230, 240, 0.5)', 'rgba(255, 220, 230, 0)'] }, // 白色
  { stops: ['rgba(255, 192, 203, 0.95)', 'rgba(255, 175, 190, 0.85)', 'rgba(255, 155, 175, 0.5)', 'rgba(255, 140, 160, 0)'] }, // 淡粉
];

export type TreeTheme = 'default' | 'sakura';

// Canvas 动态生成叶团纹理：径向渐变圆，中心深绿边缘透明
export function createLeafClusterTexture(colorIndex = 0, size = 128, theme: TreeTheme = 'default'): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.45;

  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  const palette = theme === 'sakura' ? SAKURA_LEAF_COLORS : LEAF_COLORS;
  const color = palette[colorIndex % palette.length]!;
  gradient.addColorStop(0, color.stops[0]!);
  gradient.addColorStop(0.5, color.stops[1]!);
  gradient.addColorStop(0.75, color.stops[2]!);
  gradient.addColorStop(1, color.stops[3]!);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// 创建单个叶团 billboard
export function createLeafBillboard(
  position: THREE.Vector3,
  width: number,
  height: number,
  texture: THREE.Texture,
): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(sharedPlaneGeo, material);
  mesh.position.copy(position);
  mesh.scale.set(width, height, 1);
  mesh.renderOrder = -1; // 叶片在枝干之后渲染
  mesh.userData.isLeaf = true;
  return mesh;
}
