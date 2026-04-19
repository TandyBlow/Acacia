import * as THREE from 'three';

// 描边顶点着色器 — 沿法线膨胀顶点
export const outlineVertexShader = /* glsl */ `
  uniform float uOutlineWidth;
  void main() {
    vec3 pos = position + normal * uOutlineWidth;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// 描边片段着色器 — 纯色输出
export const outlineFragmentShader = /* glsl */ `
  uniform vec3 uOutlineColor;
  void main() {
    gl_FragColor = vec4(uOutlineColor, 1.0);
  }
`;

// 创建三阶渐变贴图（卡通着色）
// NearestFilter 采样产生硬边界，不做插值
export function createCelGradientMap(): THREE.DataTexture {
  const data = new Uint8Array([0, 100, 255]);
  const texture = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}
