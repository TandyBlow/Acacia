import { apiFetch } from '../utils/api';
import type { DataAdapter, NodeContext, NodeRecord, StyleResult, TreeNode } from '../types/node';
import type { SkeletonData } from '../types/tree';

export const backendAdapter: DataAdapter = {
  async getNodeContext(nodeId: string | null): Promise<NodeContext> {
    const path = nodeId ? `/nodes/context/${nodeId}` : '/nodes/context/null';
    return apiFetch<NodeContext>(path);
  },

  async createNode(parentId: string | null, name: string): Promise<NodeRecord> {
    return apiFetch<NodeRecord>('/nodes', {
      method: 'POST',
      body: JSON.stringify({ name, parent_id: parentId }),
    });
  },

  async updateNodeContent(nodeId: string, content: string): Promise<void> {
    await apiFetch(`/nodes/${nodeId}/content`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
  },

  async deleteNode(nodeId: string, deleteChildren: boolean): Promise<void> {
    await apiFetch(`/nodes/${nodeId}?delete_children=${deleteChildren}`, {
      method: 'DELETE',
    });
  },

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    await apiFetch(`/nodes/${nodeId}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ new_parent_id: newParentId }),
    });
  },

  async getTree(): Promise<TreeNode[]> {
    return apiFetch<TreeNode[]>('/tree');
  },

  async fetchTreeSkeleton(_userId: string, canvasW?: number, canvasH?: number): Promise<SkeletonData> {
    const body: Record<string, number> = {};
    if (canvasW) body.canvas_w = canvasW;
    if (canvasH) body.canvas_h = canvasH;
    return apiFetch<SkeletonData>('/generate-tree-skeleton', {
      method: 'POST',
      body: Object.keys(body).length ? JSON.stringify(body) : undefined,
    });
  },

  async tagNodes(_userId: string): Promise<void> {
    await apiFetch('/tag-nodes', { method: 'POST' });
  },

  async fetchStyle(_userId: string): Promise<StyleResult> {
    return apiFetch<StyleResult>('/style');
  },

  async testSakuraTag(): Promise<void> {
    // no-op in backend mode
  },
};
