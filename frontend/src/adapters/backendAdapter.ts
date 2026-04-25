import { config } from '../config';
import type { DataAdapter, NodeContext, NodeRecord, StyleResult, TreeNode } from '../types/node';
import type { SkeletonData } from '../types/tree';

const TOKEN_KEY = 'acacia_backend_token';

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(`${config.backendUrl}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

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
    return apiFetch<SkeletonData>('/local/generate-tree-skeleton', {
      method: 'POST',
      headers: Object.keys(body).length ? { 'Content-Type': 'application/json' } : undefined,
      body: Object.keys(body).length ? JSON.stringify(body) : undefined,
    });
  },

  async tagNodes(_userId: string): Promise<void> {
    await apiFetch('/local/tag-nodes', { method: 'POST' });
  },

  async fetchStyle(_userId: string): Promise<StyleResult> {
    return apiFetch<StyleResult>('/local/style');
  },

  async testSakuraTag(): Promise<void> {
    // no-op in backend mode
  },
};
