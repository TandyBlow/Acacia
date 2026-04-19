import {
  assertSiblingNameUnique,
  buildPath,
  buildTree,
  bySortOrder,
  cloneNode,
  collectDescendantIds,
  generateId,
  nextSortOrder,
  normalizeSiblingOrder,
} from '../utils/treeUtils';
import type { DataAdapter, NodeContext, NodeRecord, StyleResult, TreeNode } from '../types/node';
import type { SkeletonData } from '../types/tree';

const STORAGE_KEY = 'seewhat_local_nodes_v1';

export function clearLocalNodeCache(): void {
  localStorage.removeItem(STORAGE_KEY);
}

const seedNodes: NodeRecord[] = [
  {
    id: 'n-root-1',
    name: 'Programming',
    content: '# Programming\n\nStart here.',
    parentId: null,
    sortOrder: 0,
  },
  {
    id: 'n-root-2',
    name: 'Math',
    content: '# Math\n\nCore notes.',
    parentId: null,
    sortOrder: 1,
  },
  {
    id: 'n-c-1',
    name: 'C Language',
    content: '# C Language\n\nC fundamentals.',
    parentId: 'n-root-1',
    sortOrder: 0,
  },
  {
    id: 'n-c-2',
    name: 'Strings',
    content: '# Strings\n\nText handling in C.',
    parentId: 'n-c-1',
    sortOrder: 0,
  },
  {
    id: 'n-c-3',
    name: 'fgets()',
    content: '# fgets()\n\nRead one line from input stream.',
    parentId: 'n-c-2',
    sortOrder: 0,
  },
];

function readLocalNodes(): NodeRecord[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seedNodes));
    return seedNodes.map(cloneNode);
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
        .map((item, index) => ({
          id: String(item.id),
          name: String(item.name),
          content: typeof item.content === 'string' ? item.content : '',
          parentId: item.parentId ? String(item.parentId) : null,
          sortOrder: Number.isFinite(item.sortOrder) ? Number(item.sortOrder) : index,
        }));
    }
  } catch {
    // fallback to seed below
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(seedNodes));
  return seedNodes.map(cloneNode);
}

function writeLocalNodes(nodes: NodeRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
}

export const localAdapter: DataAdapter = {
  async getNodeContext(nodeId: string | null): Promise<NodeContext> {
    const nodes = readLocalNodes();
    if (!nodeId) {
      return {
        nodeInfo: null,
        pathNodes: [],
        children: nodes.filter((node) => node.parentId === null).sort(bySortOrder).map(cloneNode),
      };
    }

    const current = nodes.find((node) => node.id === nodeId) ?? null;
    if (!current) {
      return {
        nodeInfo: null,
        pathNodes: [],
        children: nodes.filter((node) => node.parentId === null).sort(bySortOrder).map(cloneNode),
      };
    }

    return {
      nodeInfo: cloneNode(current),
      pathNodes: buildPath(nodes, current.id),
      children: nodes.filter((node) => node.parentId === current.id).sort(bySortOrder).map(cloneNode),
    };
  },

  async createNode(parentId: string | null, name: string): Promise<NodeRecord> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('节点名称不能为空。');
    }

    const nodes = readLocalNodes();
    assertSiblingNameUnique(nodes, parentId, trimmedName);

    const newNode: NodeRecord = {
      id: generateId(),
      name: trimmedName,
      content: '',
      parentId,
      sortOrder: nextSortOrder(nodes, parentId),
    };

    nodes.push(newNode);
    normalizeSiblingOrder(nodes, parentId);
    writeLocalNodes(nodes);
    return cloneNode(newNode);
  },

  async updateNodeContent(nodeId: string, content: string): Promise<void> {
    const nodes = readLocalNodes();
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) {
      throw new Error('未找到该节点。');
    }
    node.content = content;
    writeLocalNodes(nodes);
  },

  async deleteNode(nodeId: string, deleteChildren: boolean): Promise<void> {
    const nodes = readLocalNodes();
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) {
      throw new Error('未找到该节点。');
    }

    if (deleteChildren) {
      const removeIds = new Set<string>([nodeId]);
      collectDescendantIds(nodes, nodeId, removeIds);
      const remaining = nodes.filter((node) => !removeIds.has(node.id));
      normalizeSiblingOrder(remaining, target.parentId);
      writeLocalNodes(remaining);
      return;
    }

    const parentId = target.parentId;
    const directChildren = nodes.filter((node) => node.parentId === nodeId).sort(bySortOrder);
    let nextOrder = nextSortOrder(nodes, parentId, nodeId);
    directChildren.forEach((child) => {
      child.parentId = parentId;
      child.sortOrder = nextOrder++;
    });

    const remaining = nodes.filter((node) => node.id !== nodeId);
    normalizeSiblingOrder(remaining, parentId);
    writeLocalNodes(remaining);
  },

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    const nodes = readLocalNodes();
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) {
      throw new Error('未找到该节点。');
    }

    if (target.parentId === newParentId) {
      return;
    }

    if (newParentId) {
      const parentExists = nodes.some((node) => node.id === newParentId);
      if (!parentExists) {
        throw new Error('目标父节点不存在。');
      }
      const blocked = new Set<string>([nodeId]);
      collectDescendantIds(nodes, nodeId, blocked);
      if (blocked.has(newParentId)) {
        throw new Error('不能将节点移动到自身或其子节点下。');
      }
    }

    assertSiblingNameUnique(nodes, newParentId, target.name, target.id);

    const oldParentId = target.parentId;
    target.parentId = newParentId;
    target.sortOrder = nextSortOrder(nodes, newParentId, target.id);

    normalizeSiblingOrder(nodes, oldParentId);
    normalizeSiblingOrder(nodes, newParentId);
    writeLocalNodes(nodes);
  },

  async getTree(): Promise<TreeNode[]> {
    const nodes = readLocalNodes();
    return buildTree(nodes, null);
  },

  async fetchTreeSkeleton(): Promise<SkeletonData> {
    throw new Error('Tree skeleton requires a backend connection.');
  },

  async tagNodes(): Promise<void> {
    // no-op in local mode
  },

  async fetchStyle(): Promise<StyleResult> {
    return { style: 'default', distribution: {} };
  },
};
