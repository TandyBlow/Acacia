export interface Branch {
  start: [number, number];
  end: [number, number];
  control1: [number, number];
  control2: [number, number];
  thickness: number;
  node_id: string;
  depth: number;
  descendants?: number;

  // v2: tapered tube geometry
  start_thickness?: number;
  end_thickness?: number;
  is_terminal?: boolean;
}

export interface ForkPoint {
  position: [number, number];
  radius: number;
  is_primary: boolean;
  root_id: string;
}

export interface CrownOutline {
  center: [number, number];
  semi_axis_x: number;
  semi_axis_y: number;
  eccentricity_x: number;
  superellipse_n: number;
  points: [number, number][];
}

export interface RootBulge {
  position: [number, number];
  radius: number;
}

export interface SkeletonData {
  branches: Branch[];
  canvas_size: [number, number];
  trunk: Branch[] | null;
  ground: [number, number][] | null;
  roots: Branch[] | null;

  // v2 additions
  version?: 2;
  fork_points?: ForkPoint[];
  crown_outline?: CrownOutline;
  root_bulges?: RootBulge[];
}
