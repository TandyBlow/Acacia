import type { SkeletonData } from './tree';

export type ViewState = 'display' | 'add' | 'move' | 'delete' | 'tree' | 'daily_quiz' | 'welcome' | 'tree_overview';

export const ViewStates = {
  DISPLAY: 'display',
  ADD: 'add',
  MOVE: 'move',
  DELETE: 'delete',
  TREE: 'tree',
  DAILY_QUIZ: 'daily_quiz',
  WELCOME: 'welcome',
  TREE_OVERVIEW: 'tree_overview',
} as const;

export interface NodeRecord {
  id: string;
  name: string;
  content: string;
  parentId: string | null;
  sortOrder: number;
}

export interface NodeContext {
  nodeInfo: NodeRecord | null;
  pathNodes: NodeRecord[];
  children: NodeRecord[];
}

export interface TreeNode {
  id: string;
  name: string;
  parentId: string | null;
  children: TreeNode[];
}

export interface StyleResult {
  style: string;
  distribution: Record<string, number>;
  params?: Record<string, unknown>;
  backgroundPrompt?: string;
  backgroundUrl?: string | null;
  styleDescription?: string;
  /** True when backend has a generation in progress — client should poll. */
  generating?: boolean;
}

export interface CoreDataAdapter {
  getNodeContext(nodeId: string | null): Promise<NodeContext>;
  createNode(parentId: string | null, name: string): Promise<NodeRecord>;
  updateNodeContent(nodeId: string, content: string): Promise<void>;
  deleteNode(nodeId: string, deleteChildren: boolean): Promise<void>;
  moveNode(nodeId: string, newParentId: string | null): Promise<void>;
  getTree(): Promise<TreeNode[]>;
  clearCache?(): void;
}

export interface TreeDataAdapter {
  fetchTreeSkeleton(userId: string, canvasW?: number, canvasH?: number): Promise<SkeletonData>;
  tagNodes(userId: string): Promise<void>;
  fetchStyle(userId: string, force?: boolean): Promise<StyleResult>;
  testSakuraTag(userId: string): Promise<void>;
}

export type DataAdapter = CoreDataAdapter & Partial<TreeDataAdapter>;

export interface DueReviewItem {
  node_id: string;
  node_name: string;
  content: string;
  retrievability: number;
  stability: number;
  difficulty: number;
  review_count: number;
  review_state: 'new' | 'review' | 'relearning';
  next_review_at: string | null;
}

export interface KnowledgeNode {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  domainTag: string;
  masteryScore: number;
  stability: number;
  difficulty: number;
  reviewCount: number;
  reviewState: string;
}
