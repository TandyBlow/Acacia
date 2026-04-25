import type { StatsNode } from '../../../composables/useStats';
import type { Branch } from '../../../types/tree';
import { Tree as EzTree } from '@dgreenheck/ez-tree';

type EzTreeOptions = EzTree['options'];

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

export function mapUserDataToEzTreeParams(
  nodeCount: number,
  maxDepth: number,
  widthDepthRatio: number,
  userId: string,
): Partial<EzTreeOptions> {
  // Branch levels: more nodes → deeper branching (2-5)
  const levels = clamp(Math.floor(Math.log2(Math.max(nodeCount, 1))), 2, 5);

  // Branch length: scale with node count
  const trunkLength = lerp(20, 40, Math.log(Math.max(nodeCount, 1)) / Math.log(500));
  const branchLength = trunkLength * 0.5;

  // Children per branch: more active → more branches
  const baseChildren = clamp(Math.round(widthDepthRatio * 4), 3, 8);

  // Leaf count scales with node count
  const leafCount = clamp(Math.round(nodeCount * 0.4), 5, 30);

  // Seed from UUID hash
  const seed = hashUUID(userId) % 100000;

  return {
    seed,
    branch: {
      levels,
      length: { 0: trunkLength, 1: branchLength, 2: branchLength * 0.6, 3: branchLength * 0.3 },
      children: { 0: baseChildren, 1: baseChildren - 1, 2: Math.max(baseChildren - 2, 2) },
    },
    leaves: {
      count: leafCount,
      size: lerp(2.0, 3.5, widthDepthRatio),
      sizeVariance: 0.7,
      billboard: 'double',
    },
  };
}
