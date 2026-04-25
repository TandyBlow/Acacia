/*
proctree.js
Copyright (c) 2012, Paul Brunt
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of tree.js nor the
      names of its contributors may be used to endorse or promote products
      derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL PAUL BRUNT BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

TypeScript port from the original proctree.js by Paul Brunt.
Source: https://github.com/supereggbert/proctree.js
*/

export interface TreeParams {
  clumpMax?: number;
  clumpMin?: number;
  lengthFalloffFactor?: number;
  lengthFalloffPower?: number;
  branchFactor?: number;
  radiusFalloffRate?: number;
  climbRate?: number;
  trunkKink?: number;
  maxRadius?: number;
  treeSteps?: number;
  taperRate?: number;
  twistRate?: number;
  segments?: number;
  levels?: number;
  sweepAmount?: number;
  initialBranchLength?: number;
  trunkLength?: number;
  dropAmount?: number;
  growAmount?: number;
  vMultiplier?: number;
  twigScale?: number;
  seed?: number;
  trunkForks?: number;
}

export interface TreeOutput {
  verts: Vec3[];
  faces: number[][];
  normals: Vec3[];
  UV: number[][];
  vertsTwig: Vec3[];
  normalsTwig: Vec3[];
  facesTwig: number[][];
  uvsTwig: number[][];
}

export interface TerminalBranch {
  head: Vec3;
  radius: number;
  length: number;
}

// --- Vector math helpers ---

export type Vec3 = [number, number, number];

function dot(v1: Vec3, v2: Vec3): number {
  return v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
}

function cross(v1: Vec3, v2: Vec3): Vec3 {
  return [
    v1[1] * v2[2] - v1[2] * v2[1],
    v1[2] * v2[0] - v1[0] * v2[2],
    v1[0] * v2[1] - v1[1] * v2[0],
  ];
}

function vecLength(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function normalize(v: Vec3): Vec3 {
  const l = vecLength(v);
  return scaleVec(v, 1 / l);
}

function scaleVec(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function subVec(v1: Vec3, v2: Vec3): Vec3 {
  return [v1[0] - v2[0], v1[1] - v2[1], v1[2] - v2[2]];
}

function addVec(v1: Vec3, v2: Vec3): Vec3 {
  return [v1[0] + v2[0], v1[1] + v2[1], v1[2] + v2[2]];
}

function vecAxisAngle(vec: Vec3, axis: Vec3, angle: number): Vec3 {
  const cosr = Math.cos(angle);
  const sinr = Math.sin(angle);
  return addVec(
    addVec(scaleVec(vec, cosr), scaleVec(cross(axis, vec), sinr)),
    scaleVec(axis, dot(axis, vec) * (1 - cosr)),
  );
}

function scaleInDirection(vector: Vec3, direction: Vec3, scale: number): Vec3 {
  const currentMag = dot(vector, direction);
  const change = scaleVec(direction, currentMag * scale - currentMag);
  return addVec(vector, change);
}

// --- Branch class ---

class Branch {
  head: Vec3;
  parent: Branch | null;
  child0: Branch | null = null;
  child1: Branch | null = null;
  length = 1;
  type: string | null = null;
  radius = 0;
  tangent: Vec3 | null = null;
  root: number[] | null = null;
  ring0: number[] | null = null;
  ring1: number[] | null = null;
  ring2: number[] | null = null;
  end: number | null = null;

  constructor(head: Vec3, parent: Branch | null = null) {
    this.head = head;
    this.parent = parent;
  }

  mirrorBranch(vec: Vec3, norm: Vec3, properties: TreeProperties): Vec3 {
    const v = cross(norm, cross(vec, norm));
    const s = properties.branchFactor * dot(v, vec);
    return [vec[0] - v[0] * s, vec[1] - v[1] * s, vec[2] - v[2] * s];
  }

  split(
    level: number | undefined,
    steps: number | undefined,
    properties: TreeProperties,
    l1 = 1,
    l2 = 1,
  ): void {
    if (level === undefined) level = properties.levels;
    if (steps === undefined) steps = properties.treeSteps;
    const rLevel = properties.levels - level;

    let po: Vec3;
    if (this.parent) {
      po = this.parent.head;
    } else {
      po = [0, 0, 0];
      this.type = 'trunk';
    }

    const so = this.head;
    const dir = normalize(subVec(so, po));

    const normal = cross(dir, [dir[2]!, dir[0]!, dir[1]!]);
    const tangent = cross(dir, normal);
    const r = properties.random(rLevel * 10 + l1 * 5 + l2 + properties.seed);
    const clumpmax = properties.clumpMax;
    const clumpmin = properties.clumpMin;

    let adj = addVec(scaleVec(normal, r), scaleVec(tangent, 1 - r));
    if (r > 0.5) adj = scaleVec(adj, -1);

    const clump = (clumpmax - clumpmin) * r + clumpmin;
    let newdir = normalize(addVec(scaleVec(adj, 1 - clump), scaleVec(dir, clump)));

    let newdir2 = this.mirrorBranch(newdir, dir, properties);
    if (r > 0.5) {
      const tmp = newdir;
      newdir = newdir2;
      newdir2 = tmp;
    }
    if (steps > 0) {
      const angle = (steps / properties.treeSteps) * 2 * Math.PI * properties.twistRate;
      newdir2 = normalize([Math.sin(angle), r, Math.cos(angle)]);
    }

    const growAmount =
      (level * level / (properties.levels * properties.levels)) * properties.growAmount;
    const dropAmount = rLevel * properties.dropAmount;
    const sweepAmount = rLevel * properties.sweepAmount;
    newdir = normalize(addVec(newdir, [sweepAmount, dropAmount + growAmount, 0]));
    newdir2 = normalize(addVec(newdir2, [sweepAmount, dropAmount + growAmount, 0]));

    const head0 = addVec(so, scaleVec(newdir, this.length));
    const head1 = addVec(so, scaleVec(newdir2, this.length));
    this.child0 = new Branch(head0, this);
    this.child1 = new Branch(head1, this);
    this.child0.length =
      Math.pow(this.length, properties.lengthFalloffPower) * properties.lengthFalloffFactor;
    this.child1.length =
      Math.pow(this.length, properties.lengthFalloffPower) * properties.lengthFalloffFactor;

    if (level > 0) {
      if (steps > 0) {
        this.child0.head = addVec(this.head, [
          (r - 0.5) * 2 * properties.trunkKink,
          properties.climbRate,
          (r - 0.5) * 2 * properties.trunkKink,
        ]);
        this.child0.type = 'trunk';
        this.child0.length = this.length * properties.taperRate;
        this.child0.split(level, steps - 1, properties, l1 + 1, l2);
      } else {
        this.child0.split(level - 1, 0, properties, l1 + 1, l2);
      }
      this.child1.split(level - 1, 0, properties, l1, l2 + 1);
    }
  }
}

// --- Tree properties (defaults) ---

interface TreeProperties {
  clumpMax: number;
  clumpMin: number;
  lengthFalloffFactor: number;
  lengthFalloffPower: number;
  branchFactor: number;
  radiusFalloffRate: number;
  climbRate: number;
  trunkKink: number;
  maxRadius: number;
  treeSteps: number;
  taperRate: number;
  twistRate: number;
  segments: number;
  levels: number;
  sweepAmount: number;
  initialBranchLength: number;
  trunkLength: number;
  dropAmount: number;
  growAmount: number;
  vMultiplier: number;
  twigScale: number;
  seed: number;
  rseed: number;
  trunkForks: number;
  random: (a?: number) => number;
}

const DEFAULT_PROPERTIES: TreeProperties = {
  clumpMax: 0.8,
  clumpMin: 0.5,
  lengthFalloffFactor: 0.85,
  lengthFalloffPower: 1,
  branchFactor: 2.0,
  radiusFalloffRate: 0.6,
  climbRate: 1.5,
  trunkKink: 0.0,
  maxRadius: 0.25,
  treeSteps: 2,
  taperRate: 0.95,
  twistRate: 13,
  segments: 6,
  levels: 3,
  sweepAmount: 0,
  initialBranchLength: 0.85,
  trunkLength: 2.5,
  dropAmount: 0.0,
  growAmount: 0.0,
  vMultiplier: 0.2,
  twigScale: 2.0,
  seed: 10,
  rseed: 10,
  trunkForks: 0,
  random(a?: number): number {
    if (!a) a = this.rseed++;
    return Math.abs(Math.cos(a + a * a));
  },
};

// --- Tree class ---

export class Tree implements TreeOutput {
  verts: Vec3[] = [];
  faces: number[][] = [];
  normals: Vec3[] = [];
  UV: number[][] = [];
  vertsTwig: Vec3[] = [];
  normalsTwig: Vec3[] = [];
  facesTwig: number[][] = [];
  uvsTwig: number[][] = [];

  private properties: TreeProperties;
  private rootBranch: Branch;

  constructor(data: TreeParams = {}) {
    this.properties = {
      ...DEFAULT_PROPERTIES,
      ...Object.fromEntries(
        Object.entries(data).filter(([k]) => k in DEFAULT_PROPERTIES),
      ),
    };

    this.properties.rseed = this.properties.seed;

    this.rootBranch = new Branch([0, this.properties.trunkLength, 0]);
    this.rootBranch.length = this.properties.initialBranchLength;

    this.rootBranch.split(undefined, undefined, this.properties);
    this.createForks(this.rootBranch, undefined);
    this.createTwigs(this.rootBranch);
    this.doFaces(this.rootBranch);
    this.calcNormals();
  }

  getTerminalBranches(): TerminalBranch[] {
    const result: TerminalBranch[] = [];
    this.collectTerminalBranches(this.rootBranch, result);
    return result;
  }

  private collectTerminalBranches(branch: Branch, result: TerminalBranch[]): void {
    if (!branch.child0) {
      result.push({
        head: branch.head,
        radius: branch.radius,
        length: branch.length,
      });
    } else {
      this.collectTerminalBranches(branch.child0, result);
      if (branch.child1) {
        this.collectTerminalBranches(branch.child1, result);
      }
    }
  }

  private calcNormals(): void {
    const { normals, faces, verts } = this;
    const allNormals: Vec3[][] = [];
    for (let i = 0; i < verts.length; i++) {
      allNormals[i] = [];
    }
    for (let i = 0; i < faces.length; i++) {
      const face = faces[i]!;
      const norm = normalize(
        cross(
          subVec(verts[face[1]!]!, verts[face[2]!]!),
          subVec(verts[face[1]!]!, verts[face[0]!]!),
        ),
      );
      allNormals[face[0]!]!.push(norm);
      allNormals[face[1]!]!.push(norm);
      allNormals[face[2]!]!.push(norm);
    }
    for (let i = 0; i < allNormals.length; i++) {
      let total: Vec3 = [0, 0, 0];
      const l = allNormals[i]!.length;
      for (let j = 0; j < l; j++) {
        total = addVec(total, scaleVec(allNormals[i]![j]!, 1 / l));
      }
      normals[i] = total;
    }
  }

  private doFaces(branch: Branch): void {
    const segments = this.properties.segments;
    const { faces, verts, UV } = this;

    if (!branch.parent) {
      for (let i = 0; i < verts.length; i++) {
        UV[i] = [0, 0];
      }
      const tangent = normalize(
        cross(
          subVec(branch.child0!.head, branch.head),
          subVec(branch.child1!.head, branch.head),
        ),
      );
      const normal = normalize(branch.head);
      let angle = Math.acos(dot(tangent, [-1, 0, 0]));
      if (dot(cross([-1, 0, 0], tangent), normal) > 0) angle = 2 * Math.PI - angle;
      const segOffset = Math.round((angle / Math.PI / 2) * segments);

      for (let i = 0; i < segments; i++) {
        const v1 = branch.ring0![i]!;
        const v2 = branch.root![(i + segOffset + 1) % segments]!;
        const v3 = branch.root![(i + segOffset) % segments]!;
        const v4 = branch.ring0![(i + 1) % segments]!;

        faces.push([v1, v4, v3]);
        faces.push([v4, v2, v3]);
        UV[(i + segOffset) % segments] = [Math.abs(i / segments - 0.5) * 2, 0];
        const len =
          vecLength(subVec(verts[branch.ring0![i]!]!, verts[branch.root![(i + segOffset) % segments]!]!)) *
          this.properties.vMultiplier;
        UV[branch.ring0![i]!] = [Math.abs(i / segments - 0.5) * 2, len];
        UV[branch.ring2![i]!] = [Math.abs(i / segments - 0.5) * 2, len];
      }
    }

    if (branch.child0 && branch.child0.ring0) {
      let segOffset0: number | undefined;
      let segOffset1: number | undefined;
      let match0: number | undefined;
      let match1: number | undefined;

      let v1 = normalize(subVec(verts[branch.ring1![0]!]!, branch.head));
      let v2 = normalize(subVec(verts[branch.ring2![0]!]!, branch.head));

      v1 = scaleInDirection(v1, normalize(subVec(branch.child0.head, branch.head)), 0);
      v2 = scaleInDirection(v2, normalize(subVec(branch.child1!.head, branch.head)), 0);

      for (let i = 0; i < segments; i++) {
        let d = normalize(subVec(verts[branch.child0.ring0[i]!]!, branch.child0.head));
        let l = dot(d, v1);
        if (segOffset0 === undefined || l > match0!) {
          match0 = l;
          segOffset0 = segments - i;
        }
        d = normalize(subVec(verts[branch.child1!.ring0![i]!]!, branch.child1!.head));
        l = dot(d, v2);
        if (segOffset1 === undefined || l > match1!) {
          match1 = l;
          segOffset1 = segments - i;
        }
      }

      const UVScale = this.properties.maxRadius / branch.radius;

      for (let i = 0; i < segments; i++) {
        const i1 = branch.child0.ring0[i]!;
        const i2 = branch.ring1![(i + segOffset0! + 1) % segments]!;
        const i3 = branch.ring1![(i + segOffset0!) % segments]!;
        const i4 = branch.child0.ring0[(i + 1) % segments]!;
        faces.push([i1, i4, i3]);
        faces.push([i4, i2, i3]);

        const i5 = branch.child1!.ring0![i]!;
        const i6 = branch.ring2![(i + segOffset1! + 1) % segments]!;
        const i7 = branch.ring2![(i + segOffset1!) % segments]!;
        const i8 = branch.child1!.ring0![(i + 1) % segments]!;
        faces.push([i5, i6, i7]);
        faces.push([i5, i8, i6]);

        const len1 =
          vecLength(
            subVec(verts[branch.child0.ring0[i]!]!, verts[branch.ring1![(i + segOffset0!) % segments]!]!),
          ) * UVScale;
        const uv1 = UV[branch.ring1![(i + segOffset0! - 1) % segments]!];

        UV[branch.child0.ring0[i]!] = [
          uv1![0]!,
          uv1![1]! + len1 * this.properties.vMultiplier,
        ];
        UV[branch.child0.ring2![i]!] = [
          uv1![0]!,
          uv1![1]! + len1 * this.properties.vMultiplier,
        ];

        const len2 =
          vecLength(
            subVec(
              verts[branch.child1!.ring0![i]!]!,
              verts[branch.ring2![(i + segOffset1!) % segments]!]!,
            ),
          ) * UVScale;
        const uv2 = UV[branch.ring2![(i + segOffset1! - 1) % segments]!];

        UV[branch.child1!.ring0![i]!] = [
          uv2![0]!,
          uv2![1]! + len2 * this.properties.vMultiplier,
        ];
        UV[branch.child1!.ring2![i]!] = [
          uv2![0]!,
          uv2![1]! + len2 * this.properties.vMultiplier,
        ];
      }

      this.doFaces(branch.child0);
      this.doFaces(branch.child1!);
    } else if (branch.child0) {
      for (let i = 0; i < segments; i++) {
        faces.push([
          branch.child0.end!,
          branch.ring1![(i + 1) % segments]!,
          branch.ring1![i]!,
        ]);
        faces.push([
          branch.child1!.end!,
          branch.ring2![(i + 1) % segments]!,
          branch.ring2![i]!,
        ]);

        const len1 = vecLength(
          subVec(verts[branch.child0.end!]!, verts[branch.ring1![i]!]!),
        );
        UV[branch.child0.end!] = [
          Math.abs(i / segments - 1 - 0.5) * 2,
          len1 * this.properties.vMultiplier,
        ];
        const len2 = vecLength(
          subVec(verts[branch.child1!.end!]!, verts[branch.ring2![i]!]!),
        );
        UV[branch.child1!.end!] = [
          Math.abs(i / segments - 0.5) * 2,
          len2 * this.properties.vMultiplier,
        ];
      }
    }
  }

  private createTwigs(branch: Branch): void {
    const { vertsTwig, normalsTwig, facesTwig, uvsTwig, properties } = this;

    if (!branch.child0) {
      const tangent = normalize(
        cross(
          subVec(branch.parent!.child0!.head, branch.parent!.head),
          subVec(branch.parent!.child1!.head, branch.parent!.head),
        ),
      );
      const binormal = normalize(subVec(branch.head, branch.parent!.head));

      const vert1 = vertsTwig.length;
      vertsTwig.push(
        addVec(
          addVec(branch.head, scaleVec(tangent, properties.twigScale)),
          scaleVec(binormal, properties.twigScale * 2 - branch.length),
        ),
      );
      const vert2 = vertsTwig.length;
      vertsTwig.push(
        addVec(
          addVec(branch.head, scaleVec(tangent, -properties.twigScale)),
          scaleVec(binormal, properties.twigScale * 2 - branch.length),
        ),
      );
      const vert3 = vertsTwig.length;
      vertsTwig.push(
        addVec(
          addVec(branch.head, scaleVec(tangent, -properties.twigScale)),
          scaleVec(binormal, -branch.length),
        ),
      );
      const vert4 = vertsTwig.length;
      vertsTwig.push(
        addVec(
          addVec(branch.head, scaleVec(tangent, properties.twigScale)),
          scaleVec(binormal, -branch.length),
        ),
      );

      const vert8 = vertsTwig.length;
      vertsTwig.push(
        addVec(
          addVec(branch.head, scaleVec(tangent, properties.twigScale)),
          scaleVec(binormal, properties.twigScale * 2 - branch.length),
        ),
      );
      const vert7 = vertsTwig.length;
      vertsTwig.push(
        addVec(
          addVec(branch.head, scaleVec(tangent, -properties.twigScale)),
          scaleVec(binormal, properties.twigScale * 2 - branch.length),
        ),
      );
      const vert6 = vertsTwig.length;
      vertsTwig.push(
        addVec(
          addVec(branch.head, scaleVec(tangent, -properties.twigScale)),
          scaleVec(binormal, -branch.length),
        ),
      );
      const vert5 = vertsTwig.length;
      vertsTwig.push(
        addVec(
          addVec(branch.head, scaleVec(tangent, properties.twigScale)),
          scaleVec(binormal, -branch.length),
        ),
      );

      facesTwig.push([vert1, vert2, vert3]);
      facesTwig.push([vert4, vert1, vert3]);

      facesTwig.push([vert6, vert7, vert8]);
      facesTwig.push([vert6, vert8, vert5]);

      const n1 = normalize(
        cross(
          subVec(vertsTwig[vert1]!, vertsTwig[vert3]!),
          subVec(vertsTwig[vert2]!, vertsTwig[vert3]!),
        ),
      );
      const n2 = normalize(
        cross(
          subVec(vertsTwig[vert7]!, vertsTwig[vert6]!),
          subVec(vertsTwig[vert8]!, vertsTwig[vert6]!),
        ),
      );

      normalsTwig.push(n1, n1, n1, n1);
      normalsTwig.push(n2, n2, n2, n2);

      uvsTwig.push([0, 1], [1, 1], [1, 0], [0, 0]);
      uvsTwig.push([0, 1], [1, 1], [1, 0], [0, 0]);
    } else {
      this.createTwigs(branch.child0);
      this.createTwigs(branch.child1!);
    }
  }

  private createForks(branch: Branch, radius: number | undefined): void {
    if (radius === undefined) radius = this.properties.maxRadius;

    branch.radius = radius;
    if (radius > branch.length) radius = branch.length;

    const { verts, properties } = this;
    const segments = properties.segments;
    const segmentAngle = (Math.PI * 2) / segments;

    if (!branch.parent) {
      branch.root = [];
      const axis: Vec3 = [0, 1, 0];
      for (let i = 0; i < segments; i++) {
        const vec = vecAxisAngle([-1, 0, 0], axis, -segmentAngle * i);
        branch.root.push(verts.length);
        verts.push(scaleVec(vec, radius / properties.radiusFalloffRate));
      }
    }

    if (branch.child0) {
      let axis: Vec3;
      if (branch.parent) {
        axis = normalize(subVec(branch.head, branch.parent.head));
      } else {
        axis = normalize(branch.head);
      }

      const axis1 = normalize(subVec(branch.head, branch.child0.head));
      const axis2 = normalize(subVec(branch.head, branch.child1!.head));
      const tangent = normalize(cross(axis1, axis2));
      branch.tangent = tangent;

      const axis3 = normalize(
        cross(tangent, normalize(addVec(scaleVec(axis1, -1), scaleVec(axis2, -1)))),
      );
      const dir: Vec3 = [axis2[0]!, 0, axis2[2]!];
      const centerloc = addVec(branch.head, scaleVec(dir, -properties.maxRadius / 2));

      const ring0: number[] = (branch.ring0 = []);
      const ring1: number[] = (branch.ring1 = []);
      const ring2: number[] = (branch.ring2 = []);

      let scale = properties.radiusFalloffRate;
      if (branch.child0.type === 'trunk' || branch.type === 'trunk') {
        scale = 1 / properties.taperRate;
      }

      // main segment ring
      const linch0 = verts.length;
      ring0.push(linch0);
      ring2.push(linch0);
      verts.push(addVec(centerloc, scaleVec(tangent, radius * scale)));

      const start = verts.length - 1;
      const d1 = vecAxisAngle(tangent, axis2, 1.57);
      const d2 = normalize(cross(tangent, axis));
      const s = 1 / dot(d1, d2);
      for (let i = 1; i < segments / 2; i++) {
        let vec = vecAxisAngle(tangent, axis2, segmentAngle * i);
        ring0.push(start + i);
        ring2.push(start + i);
        vec = scaleInDirection(vec, d2, s);
        verts.push(addVec(centerloc, scaleVec(vec, radius * scale)));
      }

      const linch1 = verts.length;
      ring0.push(linch1);
      ring1.push(linch1);
      verts.push(addVec(centerloc, scaleVec(tangent, -radius * scale)));

      for (let i = segments / 2 + 1; i < segments; i++) {
        const vec = vecAxisAngle(tangent, axis1, segmentAngle * i);
        ring0.push(verts.length);
        ring1.push(verts.length);
        verts.push(addVec(centerloc, scaleVec(vec, radius * scale)));
      }

      ring1.push(linch0);
      ring2.push(linch1);

      const start2 = verts.length - 1;
      for (let i = 1; i < segments / 2; i++) {
        const vec = vecAxisAngle(tangent, axis3, segmentAngle * i);
        ring1.push(start2 + i);
        ring2.push(start2 + (segments / 2 - i));
        const v = scaleVec(vec, radius * scale);
        verts.push(addVec(centerloc, v));
      }

      let radius0 = radius * properties.radiusFalloffRate;
      const radius1 = radius * properties.radiusFalloffRate;
      if (branch.child0.type === 'trunk') radius0 = radius * properties.taperRate;
      this.createForks(branch.child0, radius0);
      this.createForks(branch.child1!, radius1);
    } else {
      branch.end = verts.length;
      verts.push(branch.head);
    }
  }
}
