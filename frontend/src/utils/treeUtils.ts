import type { NodeRecord, TreeNode } from '../types/node';
import { UI } from '../constants/uiStrings';

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `node-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function cloneNode(node: NodeRecord): NodeRecord {
  return { ...node };
}

export function bySortOrder(a: NodeRecord, b: NodeRecord): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

export function buildParentIndex(nodes: NodeRecord[]): Map<string, NodeRecord[]> {
  const index = new Map<string, NodeRecord[]>();
  for (const node of nodes) {
    if (node.parentId !== null) {
      let children = index.get(node.parentId);
      if (!children) {
        children = [];
        index.set(node.parentId, children);
      }
      children.push(node);
    }
  }
  return index;
}

export function collectDescendantIds(
  nodes: NodeRecord[],
  nodeId: string,
  result: Set<string>,
): void {
  const index = buildParentIndex(nodes);
  function walk(id: string): void {
    const children = index.get(id);
    if (children) {
      for (const child of children) {
        result.add(child.id);
        walk(child.id);
      }
    }
  }
  walk(nodeId);
}

export function assertSiblingNameUnique(
  nodes: NodeRecord[],
  parentId: string | null,
  name: string,
  ignoreId?: string,
): void {
  const duplicate = nodes.some(
    (node) =>
      node.parentId === parentId &&
      node.name === name &&
      (ignoreId ? node.id !== ignoreId : true),
  );
  if (duplicate) {
    throw new Error(UI.errors.siblingNameConflict);
  }
}

export function normalizeSiblingOrder(nodes: NodeRecord[], parentId: string | null): void {
  const siblings = nodes.filter((node) => node.parentId === parentId).sort(bySortOrder);
  siblings.forEach((node, index) => {
    node.sortOrder = index;
  });
}

export function nextSortOrder(nodes: NodeRecord[], parentId: string | null, ignoreId?: string): number {
  const siblings = nodes.filter(
    (node) => node.parentId === parentId && (ignoreId ? node.id !== ignoreId : true),
  );
  if (siblings.length === 0) {
    return 0;
  }
  return Math.max(...siblings.map((node) => node.sortOrder)) + 1;
}

export function buildPath(nodes: NodeRecord[], nodeId: string): NodeRecord[] {
  const path: NodeRecord[] = [];
  let cursor = nodes.find((node) => node.id === nodeId) ?? null;

  while (cursor && cursor.parentId) {
    const parent = nodes.find((node) => node.id === cursor!.parentId) ?? null;
    if (!parent) {
      break;
    }
    path.unshift(cloneNode(parent));
    cursor = parent;
  }

  return path;
}

export function buildTree(nodes: NodeRecord[], parentId: string | null): TreeNode[] {
  return nodes
    .filter((node) => node.parentId === parentId)
    .sort(bySortOrder)
    .map((node) => ({
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      children: buildTree(nodes, node.id),
    }));
}

export function findTreeNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const childHit = findTreeNode(node.children, id);
    if (childHit) {
      return childHit;
    }
  }
  return null;
}

export function collectTreeDescendantIds(node: TreeNode | null, result: Set<string>): void {
  if (!node) {
    return;
  }
  for (const child of node.children) {
    result.add(child.id);
    collectTreeDescendantIds(child, result);
  }
}
