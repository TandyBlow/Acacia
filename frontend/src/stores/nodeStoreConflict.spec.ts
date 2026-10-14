// @vitest-environment jsdom
// Conflict re-read semantics on the real store + the real save session
// registry (mock network adapter): refreshConflictCopy must return the
// fresh copy, and a response that lands after the conflict settled must
// not roll the node cache back.
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
import { getCachedRevision, getCached, setCache, invalidateAll } from '../services/nodeCache';
import { configureSaveSession, enqueueNodeSave, getNodeConflict, resetSaveSessionForTests } from '../services/saveSession';
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

describe('refreshConflictCopy (real store + real registry + real node cache)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setDataAdapter(mockAdapter);
    resetSaveSessionForTests();
    invalidateAll();
    vi.clearAllMocks();
  });

  it('re-reads an open conflict and returns the fresh verified copy', async () => {
    const store = useNodeStore();
    configureSaveSession({
      performWrite: (req) => store.saveNodeContent(req.nodeId, req.content, { keepalive: req.keepalive, expectedRevision: req.expectedRevision }),
      resolveRevision: (id) => store.resolveNodeRevision(id),
    });
    // First save hits 412; the capture GET fails, so the conflict carries
    // a stale-cache copy flagged unverified.
    mockAdapter.updateNodeContent!.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 412 }));
    mockAdapter.getNodeContext!.mockRejectedValueOnce(new Error('read failed'));
    await enqueueNodeSave(nodeId, 'draft B', { force: true, validated: true, revision: 0 }).done;
    expect(getNodeConflict(nodeId)?.nodeId).toBe(nodeId);
    expect(getNodeConflict(nodeId)?.serverVerified).toBe(false);

    // The next re-read succeeds and returns the fresh copy.
    mockAdapter.getNodeContext!.mockResolvedValueOnce(contextOf('server v2 fresh', 2));
    const fresh = await store.refreshConflictCopy(nodeId);

    expect(fresh).not.toBeNull();
    expect(fresh?.serverContent).toBe('server v2 fresh');
    expect(fresh?.serverRevision).toBe(2);
    expect(fresh?.serverVerified).toBe(true);
    expect(fresh?.draftContent).toBe('draft B');
    expect(getNodeConflict(nodeId)?.serverContent).toBe('server v2 fresh');
    // The cache now reflects the live read too.
    expect(getCachedRevision(nodeId)).toBe(2);
  });

  it('a re-read landing after the conflict settled returns nothing and leaves the cache at the newer revision', async () => {
    const store = useNodeStore();
    configureSaveSession({
      performWrite: (req) => store.saveNodeContent(req.nodeId, req.content, { keepalive: req.keepalive, expectedRevision: req.expectedRevision }),
      resolveRevision: (id) => store.resolveNodeRevision(id),
    });
    // First save hits 412; the capture GET reads revision 1 and opens the
    // conflict with the cache at revision 1.
    mockAdapter.updateNodeContent!.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 412 }));
    mockAdapter.getNodeContext!.mockResolvedValueOnce(contextOf('server v1', 1));
    await enqueueNodeSave(nodeId, 'draft B', { force: true, validated: true, revision: 0 }).done;

    // A re-read starts; its GET hangs.
    let release: (() => void) | null = null;
    mockAdapter.getNodeContext!.mockImplementationOnce(
      () => new Promise<NodeContext>((resolve) => { release = () => resolve(contextOf('stale v1', 1)); }),
    );
    const reRead = store.refreshConflictCopy(nodeId);

    // Keep-mine lands (licensed by the open conflict) while the GET is in
    // flight: server and cache reach revision 2, and the conflict is gone.
    mockAdapter.updateNodeContent!.mockResolvedValueOnce({ revision: 2 } as never);
    await enqueueNodeSave(nodeId, 'draft B wins', {
      force: true, validated: true, revision: 1, conflictLicense: getNodeConflict(nodeId)!.conflictId,
    }).done;
    expect(getCachedRevision(nodeId)).toBe(2);
    expect(getNodeConflict(nodeId)).toBeNull();

    // The stale response (revision 1) arrives last.
    release!();
    const fresh = await reRead;

    // It belongs to a settled state: no copy is returned and the cache
    // keeps the newer revision and content — a rollback here would serve
    // the old version on the next node load.
    expect(fresh).toBeNull();
    expect(getCachedRevision(nodeId)).toBe(2);
    expect(getCached(nodeId)?.nodeInfo?.content).toBe('draft B wins');
  });

  it('returns nothing when there is no open conflict for the node', async () => {
    const store = useNodeStore();
    const fresh = await store.refreshConflictCopy(nodeId);
    expect(fresh).toBeNull();
    expect(mockAdapter.getNodeContext).not.toHaveBeenCalled();
  });
});

describe('saveNodeContent (structured write, session-guarded)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setDataAdapter(mockAdapter);
    resetSaveSessionForTests();
    invalidateAll();
    vi.clearAllMocks();
  });

  it('a confirmed write returns the new revision and updates the cache and active node', async () => {
    const store = useNodeStore();
    store.activeNode = { id: nodeId, name: 'N', content: 'old', parentId: null, sortOrder: 0, revision: 1 };
    setCache(nodeId, contextOf('old', 1));
    mockAdapter.updateNodeContent!.mockResolvedValueOnce({ revision: 3 } as never);

    const result = await store.saveNodeContent(nodeId, 'new text', { expectedRevision: 1 });

    expect(result).toEqual({ ok: true, revision: 3 });
    expect(mockAdapter.updateNodeContent).toHaveBeenCalledWith(nodeId, 'new text', { keepalive: undefined, revision: 1 });
    expect(getCached(nodeId)?.nodeInfo?.content).toBe('new text');
    expect(getCachedRevision(nodeId)).toBe(3);
    expect(store.activeNode?.content).toBe('new text');
  });

  it('a version conflict returns the captured server copy, verified by the live read', async () => {
    const store = useNodeStore();
    mockAdapter.updateNodeContent!.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 412 }));
    mockAdapter.getNodeContext!.mockResolvedValueOnce(contextOf('server truth', 5));

    const result = await store.saveNodeContent(nodeId, 'draft', { expectedRevision: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'conflict') {
      expect(result.conflict.serverContent).toBe('server truth');
      expect(result.conflict.serverRevision).toBe(5);
      expect(result.conflict.serverVerified).toBe(true);
      expect(result.conflict.draftContent).toBe('draft');
      expect(result.conflict.nodeId).toBe(nodeId);
    } else {
      expect.unreachable('expected a conflict result');
    }
    // The live read landed the server copy in the cache.
    expect(getCached(nodeId)?.nodeInfo?.content).toBe('server truth');
  });

  it('a version conflict whose capture read fails falls back to the cache, unverified', async () => {
    const store = useNodeStore();
    setCache(nodeId, contextOf('cached copy', 1));
    mockAdapter.updateNodeContent!.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 428 }));
    mockAdapter.getNodeContext!.mockRejectedValueOnce(new Error('read failed'));

    const result = await store.saveNodeContent(nodeId, 'draft', { expectedRevision: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'conflict') {
      expect(result.conflict.serverContent).toBe('cached copy');
      expect(result.conflict.serverVerified).toBe(false);
    } else {
      expect.unreachable('expected a conflict result');
    }
  });

  it('a late response after logout is dropped and touches nothing', async () => {
    const store = useNodeStore();
    store.activeNode = { id: nodeId, name: 'N', content: 'old', parentId: null, sortOrder: 0, revision: 1 };
    let release: (() => void) | null = null;
    mockAdapter.updateNodeContent!.mockImplementationOnce(
      () => new Promise<never>((resolve) => { release = () => resolve({ revision: 2 } as never); }),
    );
    const saving = store.saveNodeContent(nodeId, 'draft', { expectedRevision: 1 });

    store.resetAfterLogout();
    // The next session loads the node fresh.
    setCache(nodeId, contextOf('fresh content', 9));

    release!();
    const result = await saving;

    expect(result).toEqual({ ok: false, kind: 'error' });
    expect(getCached(nodeId)?.nodeInfo?.content).toBe('fresh content');
    expect(getCachedRevision(nodeId)).toBe(9);
    expect(store.activeNode).toBeNull();
  });

  it('resolveNodeRevision reads the cache first and prefetches only when empty', async () => {
    const store = useNodeStore();
    mockAdapter.getNodeContext!.mockResolvedValueOnce(contextOf('content', 4));

    expect(await store.resolveNodeRevision(nodeId)).toEqual({ revision: 4, content: 'content' });
    expect(mockAdapter.getNodeContext).toHaveBeenCalledTimes(1);
    expect(getCachedRevision(nodeId)).toBe(4);

    expect(await store.resolveNodeRevision(nodeId)).toEqual({ revision: 4, content: 'content' });
    expect(mockAdapter.getNodeContext).toHaveBeenCalledTimes(1);

    // An unreadable node resolves to null: the server will answer 428 and
    // the conflict path preserves the draft.
    mockAdapter.getNodeContext!.mockRejectedValueOnce(new Error('down'));
    expect(await store.resolveNodeRevision('other-node')).toBeNull();
  });
});
