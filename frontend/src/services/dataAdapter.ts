import { supabase } from '../api/supabase';
import type { DataAdapter, NodeContext, NodeRecord, TreeNode } from '../types/node';

const STORAGE_KEY = 'seewhat_local_nodes_v1';

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

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `node-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneNode(node: NodeRecord): NodeRecord {
  return { ...node };
}

function bySortOrder(a: NodeRecord, b: NodeRecord): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

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

function normalizeSiblingOrder(nodes: NodeRecord[], parentId: string | null): void {
  const siblings = nodes.filter((node) => node.parentId === parentId).sort(bySortOrder);
  siblings.forEach((node, index) => {
    node.sortOrder = index;
  });
}

function assertSiblingNameUnique(
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
    throw new Error('同一父节点下已存在同名节点。');
  }
}

function collectDescendantIds(nodes: NodeRecord[], nodeId: string, result: Set<string>): void {
  const children = nodes.filter((node) => node.parentId === nodeId);
  children.forEach((child) => {
    result.add(child.id);
    collectDescendantIds(nodes, child.id, result);
  });
}

function nextSortOrder(nodes: NodeRecord[], parentId: string | null, ignoreId?: string): number {
  const siblings = nodes.filter(
    (node) => node.parentId === parentId && (ignoreId ? node.id !== ignoreId : true),
  );
  if (siblings.length === 0) {
    return 0;
  }
  return Math.max(...siblings.map((node) => node.sortOrder)) + 1;
}

function buildPath(nodes: NodeRecord[], nodeId: string): NodeRecord[] {
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

function buildTree(nodes: NodeRecord[], parentId: string | null): TreeNode[] {
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

const localAdapter: DataAdapter = {
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
};

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

type SupabaseNodeRow = {
  id: string;
  name: string;
  content: unknown;
  is_deleted?: boolean;
};

type SupabaseEdgeRow = {
  parent_id: string | null;
  child_id: string;
  sort_order: number | null;
  relationship_type?: string | null;
};

function normalizeEdgeByChild(edges: SupabaseEdgeRow[]): Map<string, SupabaseEdgeRow> {
  const edgeByChild = new Map<string, SupabaseEdgeRow>();
  edges.forEach((edge, index) => {
    if (!edge.child_id) {
      return;
    }
    const prev = edgeByChild.get(edge.child_id);
    const currentScore = Number(edge.sort_order ?? index);
    const prevScore = Number(prev?.sort_order ?? Number.MAX_SAFE_INTEGER);
    if (!prev || currentScore < prevScore) {
      edgeByChild.set(edge.child_id, edge);
    }
  });
  return edgeByChild;
}

async function readSupabaseNodes(): Promise<NodeRecord[]> {
  if (!supabase) {
    throw new Error('Supabase 未配置。请设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。');
  }

  const [{ data: nodeRows, error: nodeError }, { data: edgeRows, error: edgeError }] =
    await Promise.all([
      supabase.from('nodes').select('id,name,content,is_deleted').eq('is_deleted', false),
      supabase.from('edges').select('parent_id,child_id,sort_order,relationship_type'),
    ]);

  if (nodeError) {
    throw new Error(nodeError.message);
  }
  if (edgeError) {
    throw new Error(edgeError.message);
  }

  const nodes = (nodeRows ?? []) as SupabaseNodeRow[];
  const edges = (edgeRows ?? []) as SupabaseEdgeRow[];
  const edgeByChild = normalizeEdgeByChild(edges);

  return nodes.map((row, index) => {
    const edge = edgeByChild.get(row.id);
    return {
      id: row.id,
      name: row.name,
      content: extractContent(row.content),
      parentId: edge?.parent_id ?? null,
      sortOrder: Number(edge?.sort_order ?? index) || 0,
    };
  });
}

const supabaseAdapter: DataAdapter = {
  async getNodeContext(nodeId: string | null): Promise<NodeContext> {
    const nodes = await readSupabaseNodes();
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
    if (!supabase) {
      throw new Error('Supabase 未配置。请设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。');
    }

    const nodes = await readSupabaseNodes();
    assertSiblingNameUnique(nodes, parentId, trimmedName);
    const insertSort = nextSortOrder(nodes, parentId);

    const { data: nodeData, error: nodeError } = await supabase
      .from('nodes')
      .insert({ name: trimmedName, content: { markdown: '' }, is_deleted: false })
      .select('id,name,content')
      .single();

    if (nodeError || !nodeData) {
      throw new Error(nodeError?.message ?? '创建节点失败。');
    }

    const { error: edgeError } = await supabase.from('edges').insert({
      parent_id: parentId,
      child_id: nodeData.id,
      sort_order: insertSort,
      relationship_type: 'hierarchy',
    });

    if (edgeError) {
      // best effort rollback
      await supabase.from('nodes').update({ is_deleted: true }).eq('id', nodeData.id);
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
    if (!supabase) {
      throw new Error('Supabase 未配置。请设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。');
    }

    const { error } = await supabase
      .from('nodes')
      .update({ content: { markdown: content }, updated_at: new Date().toISOString() })
      .eq('id', nodeId);

    if (error) {
      throw new Error(error.message);
    }
  },

  async deleteNode(nodeId: string, deleteChildren: boolean): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase 未配置。请设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。');
    }

    const nodes = await readSupabaseNodes();
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) {
      throw new Error('未找到该节点。');
    }

    if (deleteChildren) {
      const removeIds = new Set<string>([nodeId]);
      collectDescendantIds(nodes, nodeId, removeIds);
      const idList = Array.from(removeIds);

      const { error: nodeErr } = await supabase
        .from('nodes')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .in('id', idList);
      if (nodeErr) {
        throw new Error(nodeErr.message);
      }

      const { error: childEdgeErr } = await supabase.from('edges').delete().in('child_id', idList);
      if (childEdgeErr) {
        throw new Error(childEdgeErr.message);
      }

      const { error: parentEdgeErr } = await supabase.from('edges').delete().in('parent_id', idList);
      if (parentEdgeErr) {
        throw new Error(parentEdgeErr.message);
      }
      return;
    }

    const parentId = target.parentId;
    const directChildren = nodes.filter((node) => node.parentId === nodeId).sort(bySortOrder);
    let nextOrder = nextSortOrder(nodes, parentId, nodeId);

    for (const child of directChildren) {
      const { error: moveErr } = await supabase
        .from('edges')
        .update({ parent_id: parentId, sort_order: nextOrder++ })
        .eq('child_id', child.id);
      if (moveErr) {
        throw new Error(moveErr.message);
      }
    }

    const { error: deleteEdgeErr } = await supabase.from('edges').delete().eq('child_id', nodeId);
    if (deleteEdgeErr) {
      throw new Error(deleteEdgeErr.message);
    }

    const { error: softDeleteErr } = await supabase
      .from('nodes')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', nodeId);
    if (softDeleteErr) {
      throw new Error(softDeleteErr.message);
    }
  },

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase 未配置。请设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。');
    }

    const nodes = await readSupabaseNodes();
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
    const newSort = nextSortOrder(nodes, newParentId, target.id);

    const { data: edgeHit, error: edgeReadErr } = await supabase
      .from('edges')
      .select('child_id')
      .eq('child_id', nodeId)
      .maybeSingle();

    if (edgeReadErr) {
      throw new Error(edgeReadErr.message);
    }

    if (edgeHit) {
      const { error: moveErr } = await supabase
        .from('edges')
        .update({ parent_id: newParentId, sort_order: newSort })
        .eq('child_id', nodeId);
      if (moveErr) {
        throw new Error(moveErr.message);
      }
      return;
    }

    const { error: insertErr } = await supabase.from('edges').insert({
      parent_id: newParentId,
      child_id: nodeId,
      sort_order: newSort,
      relationship_type: 'hierarchy',
    });
    if (insertErr) {
      throw new Error(insertErr.message);
    }
  },

  async getTree(): Promise<TreeNode[]> {
    const nodes = await readSupabaseNodes();
    return buildTree(nodes, null);
  },
};

export const localDataAdapter: DataAdapter = localAdapter;

const mode = String(import.meta.env.VITE_DATA_MODE ?? 'supabase').toLowerCase();

if (mode !== 'supabase') {
  throw new Error('This project requires VITE_DATA_MODE=supabase.');
}

export const dataAdapter: DataAdapter = supabaseAdapter;
