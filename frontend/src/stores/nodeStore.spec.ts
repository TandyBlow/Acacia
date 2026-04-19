import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { NodeContext, NodeRecord, TreeNode, CoreDataAdapter } from '../types/node';

const mockAdapter: CoreDataAdapter = {
  getNodeContext: vi.fn<(nodeId: string | null) => Promise<NodeContext>>(),
  createNode: vi.fn<(parentId: string | null, name: string) => Promise<NodeRecord>>(),
  updateNodeContent: vi.fn<(nodeId: string, content: string) => Promise<void>>(),
  deleteNode: vi.fn<(nodeId: string, deleteChildren: boolean) => Promise<void>>(),
  moveNode: vi.fn<(nodeId: string, newParentId: string | null) => Promise<void>>(),
  getTree: vi.fn<() => Promise<TreeNode[]>>(),
  clearCache: vi.fn(),
};

vi.mock('../services/nodeCache', () => ({
  getCached: () => null,
  setCache: () => {},
  invalidate: () => {},
  invalidateAll: () => {},
}));

import { useNodeStore, setDataAdapter } from './nodeStore';

describe('useNodeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setDataAdapter(mockAdapter);
    vi.clearAllMocks();
  });

  it('loads node context and resets to display mode', async () => {
    const store = useNodeStore();
    const rootContext: NodeContext = {
      nodeInfo: null,
      pathNodes: [],
      children: [{ id: 'c1', name: 'Child', content: '', parentId: null, sortOrder: 0 }],
    };
    mockAdapter.getNodeContext!.mockResolvedValueOnce(rootContext);

    await store.loadNode(null);

    expect(mockAdapter.getNodeContext).toHaveBeenCalledWith(null);
    expect(store.viewState).toBe('display');
    expect(store.childNodes).toEqual(rootContext.children);
    expect(store.errorMessage).toBeNull();
  });

  it('builds blocked parent ids when starting move', async () => {
    const store = useNodeStore();
    const movingNode: NodeRecord = {
      id: 'a',
      name: 'A',
      content: '',
      parentId: null,
      sortOrder: 0,
    };
    mockAdapter.getTree!.mockResolvedValueOnce([
      {
        id: 'a',
        name: 'A',
        parentId: null,
        children: [
          { id: 'b', name: 'B', parentId: 'a', children: [] },
          {
            id: 'c',
            name: 'C',
            parentId: 'a',
            children: [{ id: 'd', name: 'D', parentId: 'c', children: [] }],
          },
        ],
      },
    ]);

    await store.startMove(movingNode);

    expect(store.viewState).toBe('move');
    expect(new Set(store.blockedParentIds)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('creates a node with trimmed name when confirming add operation', async () => {
    const store = useNodeStore();
    const createdNode: NodeRecord = {
      id: 'new-1',
      name: 'New Node',
      content: '',
      parentId: 'parent-1',
      sortOrder: 0,
    };

    mockAdapter.getNodeContext!.mockResolvedValueOnce({
      nodeInfo: { id: 'parent-1', name: 'Parent', content: '', parentId: null, sortOrder: 0 },
      pathNodes: [],
      children: [],
    }).mockResolvedValueOnce({
      nodeInfo: createdNode,
      pathNodes: [{ id: 'parent-1', name: 'Parent', content: '', parentId: null, sortOrder: 0 }],
      children: [],
    });
    mockAdapter.createNode!.mockResolvedValueOnce(createdNode);

    await store.loadNode('parent-1');
    store.startAdd();
    store.pendingNodeName = '  New Node  ';

    await store.confirmOperation();

    expect(mockAdapter.createNode).toHaveBeenCalledWith('parent-1', 'New Node');
    expect(mockAdapter.getNodeContext).toHaveBeenLastCalledWith('new-1');
    expect(store.viewState).toBe('display');
  });
});
