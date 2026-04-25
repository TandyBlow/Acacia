import * as THREE from 'three';
import type { TreeOutput, TerminalBranch } from '../../../vendor/proctree';

export function buildTrunkBufferGeometry(tree: TreeOutput): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();

  const posArray = new Float32Array(tree.verts.length * 3);
  for (let i = 0; i < tree.verts.length; i++) {
    const v = tree.verts[i]!;
    posArray[i * 3] = v[0];
    posArray[i * 3 + 1] = v[1];
    posArray[i * 3 + 2] = v[2];
  }

  const normArray = new Float32Array(tree.normals.length * 3);
  for (let i = 0; i < tree.normals.length; i++) {
    const n = tree.normals[i]!;
    normArray[i * 3] = n[0];
    normArray[i * 3 + 1] = n[1];
    normArray[i * 3 + 2] = n[2];
  }

  const uvArray = new Float32Array(tree.UV.length * 2);
  for (let i = 0; i < tree.UV.length; i++) {
    const uv = tree.UV[i]!;
    uvArray[i * 2] = uv[0]!;
    uvArray[i * 2 + 1] = uv[1]!;
  }

  const indexArray = new Uint32Array(tree.faces.length * 3);
  for (let i = 0; i < tree.faces.length; i++) {
    const f = tree.faces[i]!;
    indexArray[i * 3] = f[0]!;
    indexArray[i * 3 + 1] = f[1]!;
    indexArray[i * 3 + 2] = f[2]!;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normArray, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
  geo.setIndex(new THREE.BufferAttribute(indexArray, 1));

  return geo;
}

export interface CrownSphere {
  geometry: THREE.IcosahedronGeometry;
  position: THREE.Vector3;
  radius: number;
}

export function buildCrownSpheres(
  terminals: TerminalBranch[],
  radiusCoefficient = 10,
): CrownSphere[] {
  const spheres: CrownSphere[] = [];
  for (const t of terminals) {
    const sphereRadius = Math.max(0.05, t.radius * radiusCoefficient);
    const geo = new THREE.IcosahedronGeometry(sphereRadius, 2);
    spheres.push({
      geometry: geo,
      position: new THREE.Vector3(t.head[0], t.head[1], t.head[2]),
      radius: sphereRadius,
    });
  }
  return spheres;
}export function buildTwigBufferGeometry(tree: TreeOutput): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();

  const posArray = new Float32Array(tree.vertsTwig.length * 3);
  for (let i = 0; i < tree.vertsTwig.length; i++) {
    const v = tree.vertsTwig[i]!;
    posArray[i * 3] = v[0];
    posArray[i * 3 + 1] = v[1];
    posArray[i * 3 + 2] = v[2];
  }

  const normArray = new Float32Array(tree.normalsTwig.length * 3);
  for (let i = 0; i < tree.normalsTwig.length; i++) {
    const n = tree.normalsTwig[i]!;
    normArray[i * 3] = n[0];
    normArray[i * 3 + 1] = n[1];
    normArray[i * 3 + 2] = n[2];
  }

  const uvArray = new Float32Array(tree.uvsTwig.length * 2);
  for (let i = 0; i < tree.uvsTwig.length; i++) {
    const uv = tree.uvsTwig[i]!;
    uvArray[i * 2] = uv[0]!;
    uvArray[i * 2 + 1] = uv[1]!;
  }

  const indexArray = new Uint32Array(tree.facesTwig.length * 3);
  for (let i = 0; i < tree.facesTwig.length; i++) {
    const f = tree.facesTwig[i]!;
    indexArray[i * 3] = f[0]!;
    indexArray[i * 3 + 1] = f[1]!;
    indexArray[i * 3 + 2] = f[2]!;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normArray, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
  geo.setIndex(new THREE.BufferAttribute(indexArray, 1));

  return geo;
}
