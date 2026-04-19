import type { SkeletonData } from './tree';

export type ViewState = 'display' | 'add' | 'move' | 'delete' | 'tree';

export const ViewStates = {
  DISPLAY: 'display',
  ADD: 'add',
  MOVE: 'move',
  DELETE: 'delete',
  TREE: 'tree',
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
  fetchTreeSkeleton(userId: string): Promise<SkeletonData>;
  tagNodes(userId: string): Promise<void>;
  fetchStyle(userId: string): Promise<StyleResult>;
  testSakuraTag(userId: string): Promise<void>;
}

export type DataAdapter = CoreDataAdapter & Partial<TreeDataAdapter>;
