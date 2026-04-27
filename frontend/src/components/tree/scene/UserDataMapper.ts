import type { StatsNode } from '../../../composables/useStats';
import type { Branch, GrowthMetrics } from '../../../types/tree';
import { Tree as EzTree } from '@dgreenheck/ez-tree';

type EzTreeOptions = EzTree['options'];

/**
 * Deep-merge `source` into `target`, ADDING keys that don't yet exist in
 * target (unlike ez-tree's built-in `copy()` which skips them).  Mutates and
 * returns `target`.
 */
export function deepMergeOptions(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  for (const key of Object.keys(source)) {
    const sv = source[key];
    if (sv !== null && typeof sv === 'object' && !Array.isArray(sv)) {
      if (!(key in target) || typeof target[key] !== 'object' || target[key] === null) {
        target[key] = {};
      }
      deepMergeOptions(target[key], sv);
    } else {
      target[key] = sv;
    }
  }
  return target;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * clamp(t, 0, 1);
}

function hashUUID(uuid: string): number {
  let h = 5381;
  for (let i = 0; i < uuid.length; i++) {
    h = ((h << 5) + h + uuid.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ---------------------------------------------------------------------------
// Pre-built branch parameter tables (synthesised from Oak Small/Medium/Large
// presets + extrapolation).  Each key is a level index.  Levels 0-3 match the
// Oak Medium preset roughly; levels 4-5 are conservative extrapolations.
// ---------------------------------------------------------------------------

/** Number of radial segments per level. Higher = rounder branch cross-section. */
const SEGMENTS: Record<number, number> = { 0: 8, 1: 6, 2: 5, 3: 4 };

/** Number of length-wise sections per level. */
const SECTIONS: Record<number, number> = { 0: 10, 1: 8, 2: 6, 3: 4 };

/** Branch taper per level (0 = no taper, 1 = tapers to point). */
const TAPER: Record<number, number> = { 0: 0.73, 1: 0.55, 2: 0.6, 3: 0.7 };

/** Gnarliness (random perturbation) per level. */
const GNARLINESS: Record<number, number> = { 0: 0.05, 1: 0.1, 2: 0.15, 3: 0.08 };

/** Twist per level. */
const TWIST: Record<number, number> = { 0: 0, 1: 0.05, 2: 0, 3: 0 };

/** Angle of child branches relative to parent (degrees). */
const ANGLE: Record<number, number> = { 1: 55, 2: 50, 3: 40 };

/** Where child branches start on the parent (0-1 along length). */
const START: Record<number, number> = { 1: 0.4, 2: 0.3, 3: 0.25 };

// ---------------------------------------------------------------------------
// Tier-based defaults (length, radius, children) — scaled by NodeCount
// ---------------------------------------------------------------------------

interface BranchTier {
  levels: number;
  /** Trunk length (level 0) at gm=1.0, scaled by nodeCount log interpolation. */
  trunkLenMin: number;
  trunkLenMax: number;
  /** Trunk radius at gm=1.0. */
  trunkRadius: number;
  /** Children per parent level. Keys 0..levels-1. */
  baseChildren: Record<number, number>;
}

const TIERS: BranchTier[] = [
  // Tier 0: seedling (nodeCount < 20) — compact, 2-level structure
  { levels: 2, trunkLenMin: 10, trunkLenMax: 20, trunkRadius: 0.6, baseChildren: { 0: 4, 1: 3 } },
  // Tier 1: sapling (20-80) — terminals=105, safe
  { levels: 3, trunkLenMin: 20, trunkLenMax: 32, trunkRadius: 0.9, baseChildren: { 0: 6, 1: 4, 2: 2 } },
  // Tier 2: mature (80-300) — terminals=144, safe
  { levels: 3, trunkLenMin: 28, trunkLenMax: 42, trunkRadius: 1.3, baseChildren: { 0: 7, 1: 5, 2: 2 } },
  // Tier 3: ancient (300+) — terminals=192, leafCount auto-capped at 27
  { levels: 3, trunkLenMin: 40, trunkLenMax: 60, trunkRadius: 1.8, baseChildren: { 0: 7, 1: 5, 2: 3 } },
];

function selectTier(nodeCount: number): BranchTier {
  if (nodeCount < 20) return TIERS[0]!;
  if (nodeCount < 80) return TIERS[1]!;
  if (nodeCount < 300) return TIERS[2]!;
  return TIERS[3]!;
}

/**
 * Build a complete `branch` options object for ez-tree that covers every
 * parameter for every level (0…levels).  This means the preset's branch
 * settings are fully replaced, avoiding any `undefined` key access.
 */
function buildCompleteBranch(
  nodeCount: number,
  gm: number,
): Record<string, unknown> {
  const tier = selectTier(nodeCount);
  const levels = tier.levels;

  // Log-interpolate between tier's min/max trunk length
  const t = clamp(Math.log(Math.max(nodeCount, 1)) / Math.log(1000), 0, 1);
  const trunkLen = lerp(tier.trunkLenMin, tier.trunkLenMax, t) * gm;

  // Length falloff: level 1 ≈ 55% of trunk, then ~60% per subsequent level
  const lengthFalloff = [1.0, 0.55, 0.33, 0.20];
  const length: Record<number, number> = {};
  for (let lv = 0; lv <= levels; lv++) {
    length[lv] = Math.max(1.5, trunkLen * lengthFalloff[lv]!);
  }

  // Radius: based on tier.trunkRadius with dampened gm (pow 0.4 so gm=2.5 → only 1.44×)
  const radiusGm = Math.pow(gm, 0.4);
  const radius: Record<number, number> = {};
  const radiusFalloff = [1.0, 0.65, 0.40, 0.25];
  for (let lv = 0; lv <= levels; lv++) {
    radius[lv] = Math.max(0.06, tier.trunkRadius * radiusGm * radiusFalloff[lv]!);
  }

  // Children: use tier defaults, fill missing levels
  const children: Record<number, number> = {};
  for (let lv = 0; lv < levels; lv++) {
    children[lv] = tier.baseChildren[lv] ?? Math.max(2, (tier.baseChildren[lv - 1] ?? 4) - 1);
  }

  // Build full branch spec
  const branch: Record<string, unknown> = { levels };
  const mkLevelObj = (table: Record<number, number>) => {
    const obj: Record<number, number> = {};
    for (let lv = 0; lv <= levels; lv++) obj[lv] = table[lv] ?? table[3] ?? 0;
    return obj;
  };
  const mkLevelObjFrom1 = (table: Record<number, number>) => {
    const obj: Record<number, number> = {};
    for (let lv = 1; lv <= levels; lv++) obj[lv] = table[lv] ?? table[3] ?? 30;
    return obj;
  };

  branch.length = length;
  branch.radius = radius;
  branch.children = children;
  branch.sections = mkLevelObj(SECTIONS);
  branch.segments = mkLevelObj(SEGMENTS);
  branch.taper = mkLevelObj(TAPER);
  branch.gnarliness = mkLevelObj(GNARLINESS);
  branch.twist = mkLevelObj(TWIST);
  branch.angle = mkLevelObjFrom1(ANGLE);
  branch.start = mkLevelObjFrom1(START);

  return branch;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class UserDataMapper {
  private masteryMap = new Map<string, number>();
  private creationDensityMap = new Map<string, number>();
  private globalActivity = 0;

  update(statsNodes: StatsNode[], branches: Branch[], distribution: Record<string, number>) {
    this.masteryMap.clear();
    this.creationDensityMap.clear();

    for (const stat of statsNodes) {
      this.masteryMap.set(stat.id, stat.mastery_score);
    }

    for (const branch of branches) {
      const dist = distribution[branch.node_id] ?? 0;
      this.creationDensityMap.set(branch.node_id, dist);
    }

    const activeCount = statsNodes.filter(n => n.mastery_score > 0).length;
    this.globalActivity = statsNodes.length > 0 ? activeCount / statsNodes.length : 0;
  }

  getMastery(nodeId: string): number {
    return this.masteryMap.get(nodeId) ?? 0;
  }

  getCreationDensity(nodeId: string): number {
    return this.creationDensityMap.get(nodeId) ?? 0;
  }

  getGlobalActivity(): number {
    return this.globalActivity;
  }
}

/**
 * Map user data to ez-tree parameter overrides.
 *
 * Provides a COMPLETE `branch` object (every param for every level), so the
 * preset's branch settings are fully replaced.  Levels is capped at 3
 * (ez-tree's internally-tested limit); the towering-tree effect comes from
 * scaling length / radius / leaf-size through the growth_multiplier
 * (range 0.3 → 2.5).
 *
 * Structure tiers based on nodeCount:
 *   < 20   → levels=2, few children (seedling)
 *   20-80  → levels=3, Oak Medium pattern (sapling)
 *   80-300 → levels=3, Oak Large pattern (mature)
 *   ≥ 300  → levels=3, Oak Large+ with max children (ancient)
 */
export function mapUserDataToEzTreeParams(
  nodeCount: number,
  _maxDepth: number,
  widthDepthRatio: number,
  userId: string,
  growth?: GrowthMetrics | null,
): Partial<EzTreeOptions> {
  const gm = Number.isFinite(growth?.growth_multiplier) ? growth!.growth_multiplier! : 0.5;

  const branch = buildCompleteBranch(nodeCount, gm);

  // Compute terminal count for leaf-index safety check
  const children = (branch as any).children as Record<number, number>;
  const branchLevels = (branch as any).levels as number;
  let terminals = 1;
  const perLevel: number[] = [1];
  for (let lv = 0; lv < branchLevels; lv++) {
    const c = children[lv] ?? 0;
    const next = perLevel[perLevel.length - 1]! * (1 + c);
    perLevel.push(next);
    terminals *= (1 + c);
  }

  // Leaves: count scales with nodeCount and gm, then hard-capped by Uint16Array safety
  const baseLeafCount = clamp(Math.round(nodeCount * 0.4), 4, 35);
  const desiredLeafCount = clamp(Math.round(baseLeafCount * gm), 3, 35);
  // Uint16Array ceiling: each terminal has (1+leafCount) leaves, each leaf = 12 indices (double billboard)
  const maxLeafCount = Math.floor(64900 / (terminals * 12)) - 1;
  const leafCount = Math.min(desiredLeafCount, Math.max(3, maxLeafCount));

  // Debug log
  const leafTotal = terminals * (1 + leafCount);
  const leafIndices = leafTotal * 12;
  console.log(
    `[TreeDebug] nodeCount=${nodeCount} gm=${gm.toFixed(2)} tier=lv${branchLevels} ` +
    `children=${JSON.stringify(children)} ` +
    `perLevel=${JSON.stringify(perLevel)} ` +
    `terminals=${terminals} ` +
    `leafCount=${leafCount}(max=${maxLeafCount}) leafTotal=${leafTotal} leafIndices=${leafIndices} ` +
    `(limit=65535 ${leafIndices > 65535 ? 'OVERFLOW' : 'OK'})`,
  );
  const baseLeafSize = lerp(2.0, 3.5, widthDepthRatio);
  const leafSize = Math.max(1.0, baseLeafSize * gm);

  const seed = hashUUID(userId) % 100000;

  return {
    seed,
    branch: branch as any,
    leaves: {
      count: leafCount,
      size: leafSize,
      sizeVariance: 0.7,
      billboard: 'double',
    } as any,
  };
}
