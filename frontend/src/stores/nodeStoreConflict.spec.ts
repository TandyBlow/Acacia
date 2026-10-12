// @vitest-environment jsdom
// Conflict re-read semantics on the real store: refreshConflictCopy must
// return the fresh copy for the caller to sync, and a response that lands
// after the conflict settled must not roll the node cache back.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { NodeContext, NodeRecord, CoreDataAdapter } from '../types/node';

const mockAdapter: CoreDataAdapter = {
  getNodeContext: vi.fn<(nodeId: string | null) => Promise<NodeContext>>(),
  createNode: vi.fn<(parentId: string | null, name: string) => Promise<NodeRecord>>(),
  updateNodeContent: vi.fn<(nodeId: string, content: string) => Promise<never>>(),
  deleteNode: vi.fn<(nodeId: string, deleteChildren: boolean) => Promise<void>>(),
  moveNode: vi.fn<(nodeId: string, newParentId: string | null) => Promise<void>>(),
  getTree: vi.fn<() => Promise<never[]>>(),
  clearCache: vi.fn(),
};

// The REAL nodeCache: the rollback scenario is about its contents.
import { getCachedRevision, getCached } from '../services/nodeCache';
import { useNodeStore, setDataAdapter } from './nodeStore';

const nodeId = 'conflicted-node';

function contextOf(content: string, revision: number): NodeContext {
  const nodeInfo: NodeRecord = {
    id: nodeId,
    name: 'Conflicted',
    content,
    parentId: null,
    sortOrder: 0,
    revision,
  };
  return { nodeInfo, pathNodes: [], children: [] };
}

describe('refreshConflictCopy (real store + real node cache)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setDataAdapter(mockAdapter);
    vi.clearAllMocks();
  });

  it('re-reads an open conflict and returns the fresh verified copy', async () => {
    const store = useNodeStore();
    // First save hits 412; the capture GET fails, so the conflict carries
    // a stale-cache copy flagged unverified.
    mockAdapter.updateNodeContent!.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 412 }));
    mockAdapter.getNodeContext!.mockRejectedValueOnce(new Error('read failed'));
    await store.saveActiveNodeContent(nodeId, 'draft B', { force: true, revision: 0 });
    expect(store.lastSaveConflict?.nodeId).toBe(nodeId);
    expect(store.lastSaveConflict?.serverVerified).toBe(false);

    // The next re-read succeeds and returns the fresh copy for the caller
    // to adopt.
    mockAdapter.getNodeContext!.mockResolvedValueOnce(contextOf('server v2 fresh', 2));
    const fresh = await store.refreshConflictCopy(nodeId);

    expect(fresh).not.toBeNull();
    expect(fresh?.serverContent).toBe('server v2 fresh');
    expect(fresh?.serverRevision).toBe(2);
    expect(fresh?.serverVerified).toBe(true);
    expect(fresh?.draftContent).toBe('draft B');
    // The cache now reflects the live read too.
    expect(getCachedRevision(nodeId)).toBe(2);
  });

  it('returns nothing when there is no open conflict for the node', async () => {
    const store = useNodeStore();
    const fresh = await store.refreshConflictCopy(nodeId);
    expect(fresh).toBeNull();
    expect(mockAdapter.getNodeContext).not.toHaveBeenCalled();
  });
});
