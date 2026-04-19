export interface Branch {
  start: [number, number];
  end: [number, number];
  control1: [number, number];
  control2: [number, number];
  thickness: number;
  node_id: string;
  depth: number;
  descendants?: number;
}

export interface SkeletonData {
  branches: Branch[];
  canvas_size: [number, number];
  trunk: Branch[] | null;
  ground: [number, number][] | null;
  roots: Branch[] | null;
}
