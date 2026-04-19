import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../api/supabase';
import { config } from '../config';
import { UI } from '../constants/uiStrings';
import {
  assertSiblingNameUnique,
  buildPath,
  buildTree,
  bySortOrder,
  cloneNode,
  collectDescendantIds,
  nextSortOrder,
} from '../utils/treeUtils';
import type { DataAdapter, NodeContext, NodeRecord, StyleResult, TreeNode } from '../types/node';
import type { SkeletonData } from '../types/tree';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function extractContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.markdown === 'string') {
      return record.markdown;
    }
    return JSON.stringify(value, null, 2);
  }
  return '';
}

function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(UI.errors.supabaseNotConfigured);
  }
  return supabase;
}

type RpcNodeRow = {
  id: string;
  name: string;
  content: unknown;
  parent_id: string | null;
  sort_order: number;
};

function mapRpcRow(row: RpcNodeRow): NodeRecord {
  return {
    id: row.id,
    name: row.name,
    content: extractContent(row.content),
    parentId: row.parent_id ?? null,
    sortOrder: Number(row.sort_order) || 0,
  };
}

// ---------------------------------------------------------------------------
// Backend HTTP helpers (not Supabase SDK)
// ---------------------------------------------------------------------------

async function fetchTreeSkeletonHttp(userId: string): Promise<SkeletonData> {
  const res = await fetch(`${config.backendUrl}/generate-tree-skeleton/${userId}`, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch skeleton: ${text}`);
  }
  return res.json();
}

async function tagNodesHttp(userId: string): Promise<void> {
  await fetch(`${config.backendUrl}/tag-nodes/${userId}`, { method: 'POST' });
}

async function fetchStyleHttp(userId: string): Promise<StyleResult> {
  const res = await fetch(`${config.backendUrl}/style/${userId}`);
  if (!res.ok) throw new Error('Failed to fetch style');
  return res.json();
}

async function testSakuraTagImpl(userId: string): Promise<void> {
  const sb = requireSupabase();
  const { data } = await sb
    .from('nodes')
    .select('id')
    .eq('owner_id', userId)
    .eq('is_deleted', false);
  if (data) {
    for (const row of data) {
      await sb.from('nodes').update({ domain_tag: UI.tree.sakuraDomainTag }).eq('id', row.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Direct-query implementation (fallback)
// ---------------------------------------------------------------------------

type NodeRow = { id: string; name: string; content: unknown; is_deleted?: boolean };
type EdgeRow = { parent_id: string | null; child_id: string; sort_order: number | null };

function normalizeEdges(edges: EdgeRow[]): Map<string, EdgeRow> {
  const map = new Map<string, EdgeRow>();
  edges.forEach((edge, index) => {
    if (!edge.child_id) return;
    const prev = map.get(edge.child_id);
    const currentScore = Number(edge.sort_order ?? index);
    const prevScore = Number(prev?.sort_order ?? Number.MAX_SAFE_INTEGER);
    if (!prev || currentScore < prevScore) {
      map.set(edge.child_id, edge);
    }
  });
  return map;
}

async function fetchAllNodes(): Promise<NodeRecord[]> {
  const sb = requireSupabase();

  const [{ data: nodeRows, error: nodeError }, { data: edgeRows, error: edgeError }] =
    await Promise.all([
      sb.from('nodes').select('id,name,content,is_deleted').eq('is_deleted', false),
      sb.from('edges').select('parent_id,child_id,sort_order'),
    ]);

  if (nodeError) throw new Error(nodeError.message);
  if (edgeError) throw new Error(edgeError.message);

  const edgeMap = normalizeEdges((edgeRows ?? []) as EdgeRow[]);

  return ((nodeRows ?? []) as NodeRow[]).map((row, index) => {
    const edge = edgeMap.get(row.id);
    return {
      id: row.id,
      name: row.name,
      content: extractContent(row.content),
      parentId: edge?.parent_id ?? null,
      sortOrder: Number(edge?.sort_order ?? index) || 0,
    };
  });
}

const directQueryImpl: DataAdapter = {
  async getNodeContext(nodeId: string | null): Promise<NodeContext> {
    const nodes = await fetchAllNodes();
    if (!nodeId) {
      return {
        nodeInfo: null,
        pathNodes: [],
        children: nodes.filter((n) => n.parentId === null).sort(bySortOrder).map(cloneNode),
      };
    }

    const current = nodes.find((n) => n.id === nodeId) ?? null;
    if (!current) {
      return {
        nodeInfo: null,
        pathNodes: [],
        children: nodes.filter((n) => n.parentId === null).sort(bySortOrder).map(cloneNode),
      };
    }

    return {
      nodeInfo: cloneNode(current),
      pathNodes: buildPath(nodes, current.id),
      children: nodes
        .filter((n) => n.parentId === current.id)
        .sort(bySortOrder)
        .map(cloneNode),
    };
  },

  async createNode(parentId: string | null, name: string): Promise<NodeRecord> {
    const sb = requireSupabase();
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error(UI.errors.nodeNameEmpty);

    const nodes = await fetchAllNodes();
    assertSiblingNameUnique(nodes, parentId, trimmedName);
    const insertSort = nextSortOrder(nodes, parentId);

    const { data: nodeData, error: nodeError } = await sb
      .from('nodes')
      .insert({ name: trimmedName, content: { markdown: '' }, is_deleted: false })
      .select('id,name,content')
      .single();

    if (nodeError || !nodeData) {
      throw new Error(nodeError?.message ?? UI.errors.createNodeFailed);
    }

    const { error: edgeError } = await sb.from('edges').insert({
      parent_id: parentId,
      child_id: nodeData.id,
      sort_order: insertSort,
      relationship_type: 'hierarchy',
    });

    if (edgeError) {
      await sb.from('nodes').update({ is_deleted: true }).eq('id', nodeData.id);
      throw new Error(edgeError.message);
    }

    return {
      id: nodeData.id,
      name: nodeData.name,
      content: extractContent(nodeData.content),
      parentId,
      sortOrder: insertSort,
    };
  },

  async updateNodeContent(nodeId: string, content: string): Promise<void> {
    const sb = requireSupabase();
    const { error } = await sb
      .from('nodes')
      .update({ content: { markdown: content }, updated_at: new Date().toISOString() })
      .eq('id', nodeId);

    if (error) throw new Error(error.message);
  },

  async deleteNode(nodeId: string, deleteChildren: boolean): Promise<void> {
    const sb = requireSupabase();
    const nodes = await fetchAllNodes();
    const target = nodes.find((n) => n.id === nodeId);
    if (!target) throw new Error(UI.errors.nodeNotFound);

    if (deleteChildren) {
      const removeIds = new Set<string>([nodeId]);
      collectDescendantIds(nodes, nodeId, removeIds);
      const idList = Array.from(removeIds);

      const { error: nodeErr } = await sb
        .from('nodes')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .in('id', idList);
      if (nodeErr) throw new Error(nodeErr.message);

      const { error: childEdgeErr } = await sb.from('edges').delete().in('child_id', idList);
      if (childEdgeErr) throw new Error(childEdgeErr.message);

      const { error: parentEdgeErr } = await sb.from('edges').delete().in('parent_id', idList);
      if (parentEdgeErr) throw new Error(parentEdgeErr.message);
      return;
    }

    const parentId = target.parentId;
    const directChildren = nodes.filter((n) => n.parentId === nodeId).sort(bySortOrder);
    let nextOrder = nextSortOrder(nodes, parentId, nodeId);

    for (const child of directChildren) {
      const { error: moveErr } = await sb
        .from('edges')
        .update({ parent_id: parentId, sort_order: nextOrder++ })
        .eq('child_id', child.id);
      if (moveErr) throw new Error(moveErr.message);
    }

    const { error: deleteEdgeErr } = await sb.from('edges').delete().eq('child_id', nodeId);
    if (deleteEdgeErr) throw new Error(deleteEdgeErr.message);

    const { error: softDeleteErr } = await sb
      .from('nodes')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', nodeId);
    if (softDeleteErr) throw new Error(softDeleteErr.message);
  },

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    const sb = requireSupabase();
    const nodes = await fetchAllNodes();
    const target = nodes.find((n) => n.id === nodeId);
    if (!target) throw new Error(UI.errors.nodeNotFound);

    if (target.parentId === newParentId) return;

    if (newParentId) {
      const parentExists = nodes.some((n) => n.id === newParentId);
      if (!parentExists) throw new Error(UI.errors.parentNotFound);
      const blocked = new Set<string>([nodeId]);
      collectDescendantIds(nodes, nodeId, blocked);
      if (blocked.has(newParentId)) throw new Error(UI.errors.cannotMoveToChild);
    }

    assertSiblingNameUnique(nodes, newParentId, target.name, target.id);
    const newSort = nextSortOrder(nodes, newParentId, target.id);

    const { data: edgeHit, error: edgeReadErr } = await sb
      .from('edges')
      .select('child_id')
      .eq('child_id', nodeId)
      .maybeSingle();

    if (edgeReadErr) throw new Error(edgeReadErr.message);

    if (edgeHit) {
      const { error: moveErr } = await sb
        .from('edges')
        .update({ parent_id: newParentId, sort_order: newSort })
        .eq('child_id', nodeId);
      if (moveErr) throw new Error(moveErr.message);
      return;
    }

    const { error: insertErr } = await sb.from('edges').insert({
      parent_id: newParentId,
      child_id: nodeId,
      sort_order: newSort,
      relationship_type: 'hierarchy',
    });
    if (insertErr) throw new Error(insertErr.message);
  },

  async getTree(): Promise<TreeNode[]> {
    const nodes = await fetchAllNodes();
    return buildTree(nodes, null);
  },

  fetchTreeSkeleton: fetchTreeSkeletonHttp,
  tagNodes: tagNodesHttp,
  fetchStyle: fetchStyleHttp,
  testSakuraTag: testSakuraTagImpl,
};

// ---------------------------------------------------------------------------
// RPC implementation (preferred)
// ---------------------------------------------------------------------------

const rpcImpl: DataAdapter = {
  async getNodeContext(nodeId: string | null): Promise<NodeContext> {
    const { data, error } = await requireSupabase().rpc('get_node_context', {
      target_id: nodeId ?? null,
    });

    if (error) throw new Error(error.message);

    const result = data as {
      node_info: RpcNodeRow | null;
      path_nodes: RpcNodeRow[];
      children: RpcNodeRow[];
    };

    return {
      nodeInfo: result.node_info ? mapRpcRow(result.node_info) : null,
      pathNodes: (result.path_nodes ?? []).map(mapRpcRow),
      children: (result.children ?? []).map(mapRpcRow),
    };
  },

  async createNode(parentId: string | null, name: string): Promise<NodeRecord> {
    const { data, error } = await requireSupabase().rpc('create_node', {
      input_parent_id: parentId,
      input_name: name.trim(),
    });

    if (error) throw new Error(error.message);

    const rows = data as RpcNodeRow[];
    const row = rows?.[0];
    if (!row) throw new Error(UI.errors.createNodeFailed);
    return mapRpcRow(row);
  },

  async updateNodeContent(nodeId: string, content: string): Promise<void> {
    const { error } = await requireSupabase().rpc('update_node_content', {
      input_node_id: nodeId,
      input_content: { markdown: content },
    });
    if (error) throw new Error(error.message);
  },

  async deleteNode(nodeId: string, deleteChildren: boolean): Promise<void> {
    const { error } = await requireSupabase().rpc('delete_node', {
      target_id: nodeId,
      delete_children: deleteChildren,
    });
    if (error) throw new Error(error.message);
  },

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    const { error } = await requireSupabase().rpc('move_node', {
      target_id: nodeId,
      new_parent_id: newParentId,
    });
    if (error) throw new Error(error.message);
  },

  async getTree(): Promise<TreeNode[]> {
    const { data, error } = await requireSupabase().rpc('get_tree');
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as RpcNodeRow[];
    const nodes: NodeRecord[] = rows.map(mapRpcRow);
    return buildTree(nodes, null);
  },

  fetchTreeSkeleton: fetchTreeSkeletonHttp,
  tagNodes: tagNodesHttp,
  fetchStyle: fetchStyleHttp,
  testSakuraTag: testSakuraTagImpl,
};

// ---------------------------------------------------------------------------
// Per-method RPC availability tracking
// ---------------------------------------------------------------------------

type AdapterMethod = (...a: unknown[]) => unknown;
type AdapterRecord = Record<string, AdapterMethod>;

function callMethod(
  impl: DataAdapter,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const fn = (impl as unknown as AdapterRecord)[method];
  if (!fn) throw new Error(`Unknown adapter method: ${method}`);
  return Promise.resolve(fn.apply(impl, args));
}

const rpcMethodAvailable: Record<string, boolean> = {};

export const supabaseAdapter: DataAdapter = new Proxy({} as DataAdapter, {
  get(_target, method: string) {
    return async (...args: unknown[]) => {
      // If this specific method was confirmed unavailable, skip RPC
      if (rpcMethodAvailable[method] === false) {
        return callMethod(directQueryImpl, method, args);
      }

      // Try RPC first, fall back on failure
      try {
        const result = await callMethod(rpcImpl, method, args);
        rpcMethodAvailable[method] = true;
        return result;
      } catch {
        if (rpcMethodAvailable[method] === undefined) {
          console.warn(
            `SeeWhat: RPC '${method}' not available, falling back to direct query.`,
          );
        }
        rpcMethodAvailable[method] = false;
        return callMethod(directQueryImpl, method, args);
      }
    };
  },
});
