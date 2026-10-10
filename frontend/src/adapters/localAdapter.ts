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
import type { CoreDataAdapter, NodeContext, NodeRecord, TreeNode } from '../types/node';
import { LOCAL_NODES_KEY } from '../constants/app';
import { i18n } from '../i18n';
import { readLocalNodes, writeLocalNodes } from './localPersistence';

/** @deprecated Use adapter.clearCache() via the injected adapter instead. */
export function clearLocalNodeCache(): void {
  localStorage.removeItem(LOCAL_NODES_KEY);
}

export const localAdapter: CoreDataAdapter = {
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
      throw new Error(i18n.global.t('errors.nodeNameEmpty'));
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

  async updateNodeContent(
    nodeId: string,
    content: string,
    _options?: { keepalive?: boolean; revision?: number },
  ): Promise<{ revision?: number }> {
    const nodes = readLocalNodes();
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) {
      throw new Error(i18n.global.t('errors.nodeNotFound'));
    }
    node.content = content;
    writeLocalNodes(nodes);
    return {};
  },

  async deleteNode(nodeId: string, deleteChildren: boolean): Promise<void> {
    const nodes = readLocalNodes();
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) {
      throw new Error(i18n.global.t('errors.nodeNotFound'));
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
      throw new Error(i18n.global.t('errors.nodeNotFound'));
    }

    if (target.parentId === newParentId) {
      return;
    }

    if (newParentId) {
      const parentExists = nodes.some((node) => node.id === newParentId);
      if (!parentExists) {
        throw new Error(i18n.global.t('errors.parentNotFound'));
      }
      const blocked = new Set<string>([nodeId]);
      collectDescendantIds(nodes, nodeId, blocked);
      if (blocked.has(newParentId)) {
        throw new Error(i18n.global.t('errors.cannotMoveToChild'));
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

  clearCache(): void {
    clearLocalNodeCache();
  },
};
