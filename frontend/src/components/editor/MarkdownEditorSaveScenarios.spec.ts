// @vitest-environment jsdom
// Acceptance scenarios for the save-flow regroup. Every scenario drives the
// REAL stack — mounted component with production wiring, real Tiptap editor,
// real pinia store, real save session, real node cache — and controls
// failures and response order at the network adapter. Evidence is read from
// the adapter calls (server content and version), the cache, the draft, the
// derived conflict banner, and the request counts — never from a function's
// return value alone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import type { NodeContext, NodeRecord, CoreDataAdapter } from '../../types/node';

vi.mock('@tiptap/extension-mathematics', async (importOriginal) => {
  return await importOriginal<typeof import('@tiptap/extension-mathematics')>();
});

const mockAdapter: CoreDataAdapter = {
  getNodeContext: vi.fn<(nodeId: string | null) => Promise<NodeContext>>(),
  createNode: vi.fn<(parentId: string | null, name: string) => Promise<NodeRecord>>(),
  updateNodeContent: vi.fn<(nodeId: string, content: string) => Promise<never>>(),
  deleteNode: vi.fn<(nodeId: string, deleteChildren: boolean) => Promise<void>>(),
  moveNode: vi.fn<(nodeId: string, newParentId: string | null) => Promise<void>>(),
  getTree: vi.fn<() => Promise<never[]>>(),
  clearCache: vi.fn(),
};

import { getCached, getCachedRevision, setCache, invalidateAll } from '../../services/nodeCache';
import { enqueueNodeSave, getNodeConflict, getNodeRecord, resetSaveSessionForTests } from '../../services/saveSession';
import { useNodeStore, setDataAdapter } from '../../stores/nodeStore';
import { mountEditorHarness } from './editorTestHarness';
import type { EditorHarness } from './editorTestHarness';

const NODE_A = 'node-a';
const NODE_B = 'node-b';
const AUTO_SAVE_DELAY_MS = 1000;

function contextOf(nodeId: string, content: string, revision: number): NodeContext {
  const nodeInfo: NodeRecord = { id: nodeId, name: nodeId, content, parentId: null, sortOrder: 0, revision };
  return { nodeInfo, pathNodes: [], children: [] };
}

function callsFor(nodeId: string) {
  return mockAdapter.updateNodeContent.mock.calls.filter((call) => call[0] === nodeId);
}

describe('save-flow acceptance scenarios', () => {
  let harness: EditorHarness | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    setDataAdapter(mockAdapter);
    resetSaveSessionForTests();
    invalidateAll();
    vi.clearAllMocks();
    mockAdapter.getTree.mockResolvedValue([]);
  });

  afterEach(() => {
    harness?.wrapper.unmount();
    harness = null;
  });

  async function mountNode(node: { id: string; content: string }): Promise<EditorHarness> {
    const store = useNodeStore();
    store.activeNode = { ...node, name: node.id, parentId: null, sortOrder: 0, revision: 1 };
    setCache(node.id, contextOf(node.id, node.content, 1));
    harness = mountEditorHarness(store, { id: node.id, content: node.content });
    await nextTick();
    return harness;
  }

  it('1. switching to B while A is saving: A completes in the background, B is untouched', async () => {
    const h = await mountNode({ id: NODE_A, content: 'A saved' });

    // A's autosave goes out and hangs.
    let release: (() => void) | null = null;
    mockAdapter.updateNodeContent.mockImplementationOnce(
      () => new Promise<never>((resolve) => { release = () => resolve({ revision: 2 } as never); }),
    );
    h.ctx.draft.value = 'A edited';
    await nextTick();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    expect(callsFor(NODE_A)).toHaveLength(1);

    // The user switches to B while A's request is still out.
    h.ctx.activeNode.value = { id: NODE_B, name: NODE_B, content: 'B saved', parentId: null, sortOrder: 0, revision: 1 };
    setCache(NODE_B, contextOf(NODE_B, 'B saved', 1));
    await nextTick();
    expect(h.ctx.draft.value).toBe('B saved');
    expect(h.ctx.saveConflict.value).toBeNull();

    // A's response lands: the write confirms in the background.
    release!();
    await vi.advanceTimersByTimeAsync(0);

    // Server: A received the edited content against version 1.
    expect(callsFor(NODE_A)[0][1]).toBe('A edited');
    expect(callsFor(NODE_A)[0][2]).toMatchObject({ revision: 1 });
    // Cache: A holds the confirmed content and version.
    expect(getCached(NODE_A)?.nodeInfo?.content).toBe('A edited');
    expect(getCachedRevision(NODE_A)).toBe(2);
    // B: no request, no cache change.
    expect(callsFor(NODE_B)).toHaveLength(0);
    expect(getCached(NODE_B)?.nodeInfo?.content).toBe('B saved');
    // Requests in total: exactly one write.
    expect(mockAdapter.updateNodeContent).toHaveBeenCalledTimes(1);
  });

  it('2. B saves successfully while A has an open conflict: the banner and the record survive', async () => {
    const h = await mountNode({ id: NODE_A, content: 'A saved' });

    // A's autosave hits a moved server; the capture reads revision 2.
    mockAdapter.updateNodeContent.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 412 }));
    mockAdapter.getNodeContext.mockResolvedValueOnce(contextOf(NODE_A, 'A server truth', 2));
    h.ctx.draft.value = 'A conflicting draft';
    await nextTick();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);

    expect(h.ctx.saveConflict.value?.nodeId).toBe(NODE_A);
    expect(callsFor(NODE_A)).toHaveLength(1);

    // B saves successfully in the same session.
    h.ctx.activeNode.value = { id: NODE_B, name: NODE_B, content: 'B saved', parentId: null, sortOrder: 0, revision: 1 };
    setCache(NODE_B, contextOf(NODE_B, 'B saved', 1));
    await nextTick();
    expect(h.ctx.saveConflict.value).toBeNull();
    h.ctx.draft.value = 'B edited';
    await nextTick();
    mockAdapter.updateNodeContent.mockResolvedValueOnce({ revision: 5 } as never);
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);

    // Server and cache: B confirmed its content.
    expect(callsFor(NODE_B)[0][1]).toBe('B edited');
    expect(getCached(NODE_B)?.nodeInfo?.content).toBe('B edited');
    expect(getCachedRevision(NODE_B)).toBe(5);

    // A's conflict was not retired by B's success: the record and the
    // banner (back on A) are intact, and nothing else was sent to A.
    expect(getNodeConflict(NODE_A)?.serverContent).toBe('A server truth');
    expect(getNodeConflict(NODE_A)?.serverRevision).toBe(2);
    h.ctx.activeNode.value = { id: NODE_A, name: NODE_A, content: 'A saved', parentId: null, sortOrder: 0, revision: 2 };
    await nextTick();
    expect(h.ctx.saveConflict.value?.nodeId).toBe(NODE_A);
    expect(mockAdapter.updateNodeContent).toHaveBeenCalledTimes(2);
  });

  it('3. A→B→A restores the draft and the conflict; B kept saving meanwhile', async () => {
    const h = await mountNode({ id: NODE_A, content: 'A saved' });

    mockAdapter.updateNodeContent.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 412 }));
    mockAdapter.getNodeContext.mockResolvedValueOnce(contextOf(NODE_A, 'A server truth', 2));
    h.ctx.draft.value = 'A pending draft';
    await nextTick();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    expect(h.ctx.saveConflict.value?.nodeId).toBe(NODE_A);

    h.ctx.activeNode.value = { id: NODE_B, name: NODE_B, content: 'B saved', parentId: null, sortOrder: 0, revision: 1 };
    setCache(NODE_B, contextOf(NODE_B, 'B saved', 1));
    await nextTick();
    h.ctx.draft.value = 'B edited draft';
    await nextTick();
    mockAdapter.updateNodeContent.mockResolvedValueOnce({ revision: 4 } as never);
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    expect(getCached(NODE_B)?.nodeInfo?.content).toBe('B edited draft');

    h.ctx.activeNode.value = { id: NODE_A, name: NODE_A, content: 'A saved', parentId: null, sortOrder: 0, revision: 2 };
    await nextTick();

    // Draft and banner restored exactly as they were left.
    expect(h.ctx.draft.value).toBe('A pending draft');
    expect(h.ctx.saveConflict.value?.nodeId).toBe(NODE_A);
    expect(h.ctx.saveConflict.value?.serverContent).toBe('A server truth');
    // The open conflict still pauses A's autosave — no further A writes.
    h.ctx.draft.value = 'A pending draft v2';
    await nextTick();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    expect(callsFor(NODE_A)).toHaveLength(1);
    // Requests: one failed write for A, one success for B.
    expect(mockAdapter.updateNodeContent).toHaveBeenCalledTimes(2);
  });

  it('4. reverting during a save: the server ends on the reverted content', async () => {
    const h = await mountNode({ id: NODE_A, content: 'A saved' });

    // The draft moved to B-content and its autosave is in flight.
    let release: (() => void) | null = null;
    mockAdapter.updateNodeContent.mockImplementationOnce(
      () => new Promise<never>((resolve) => { release = () => resolve({ revision: 2 } as never); }),
    );
    h.ctx.draft.value = 'B content typed';
    await nextTick();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    expect(callsFor(NODE_A)).toHaveLength(1);

    // The user reverts to the saved content before the response lands.
    h.ctx.draft.value = 'A saved';
    await nextTick();
    release!();
    await vi.advanceTimersByTimeAsync(0);

    // The revert is reconciled with a second write after the in-flight one.
    mockAdapter.updateNodeContent.mockResolvedValueOnce({ revision: 3 } as never);
    await vi.advanceTimersByTimeAsync(2500);

    const contents = callsFor(NODE_A).map((call) => call[1]);
    expect(contents).toEqual(['B content typed', 'A saved']);
    // Server and cache end on the reverted content.
    expect(getCached(NODE_A)?.nodeInfo?.content).toBe('A saved');
    expect(getCachedRevision(NODE_A)).toBe(3);
    expect(h.ctx.draft.value).toBe('A saved');
    expect(h.ctx.lastSavedContent.value).toBe('A saved');
    expect(h.ctx.saveConflict.value).toBeNull();
  });

  it('5. the server committed but the response was lost: the resent draft carries the original version', async () => {
    const h = await mountNode({ id: NODE_A, content: 'A saved' });

    // First attempt "fails": the server actually committed (it moves to
    // revision 2) but the client sees a network error.
    mockAdapter.updateNodeContent.mockRejectedValueOnce(new Error('response lost'));
    h.ctx.draft.value = 'A edited';
    await nextTick();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    expect(callsFor(NODE_A)).toHaveLength(1);
    // The outcome is unknown: the same content must not be deduped away.
    expect(getNodeRecord(NODE_A)?.outcomeUncertain).toBe(true);

    // The retry carries the SAME content and the SAME expected version —
    // picking up a newer cache version here would defeat the server's
    // version check and overwrite a moved server silently.
    mockAdapter.updateNodeContent.mockResolvedValueOnce({ revision: 2 } as never);
    await vi.advanceTimersByTimeAsync(2500);

    expect(callsFor(NODE_A)).toHaveLength(2);
    expect(callsFor(NODE_A)[1][1]).toBe('A edited');
    expect(callsFor(NODE_A)[1][2]).toMatchObject({ revision: 1 });

    // Server and cache confirmed; uncertainty cleared, dedup re-enabled.
    expect(getCached(NODE_A)?.nodeInfo?.content).toBe('A edited');
    expect(getCachedRevision(NODE_A)).toBe(2);
    expect(getNodeRecord(NODE_A)?.outcomeUncertain).toBe(false);
    const { done } = enqueueNodeSave(NODE_A, 'A edited', { validated: true });
    expect(await done).toEqual({ status: 'saved', revision: 2 });
    expect(callsFor(NODE_A)).toHaveLength(2);
    expect(h.ctx.saveConflict.value).toBeNull();
  });

  it('6. keep-mine queued behind another save: nothing claimed, nothing cleared, server untouched', async () => {
    const h = await mountNode({ id: NODE_A, content: 'A saved' });

    // A hits a version conflict; the capture reads revision 2.
    mockAdapter.updateNodeContent.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 412 }));
    mockAdapter.getNodeContext.mockResolvedValueOnce(contextOf(NODE_A, 'A server truth', 2));
    h.ctx.draft.value = 'A local draft';
    await nextTick();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    expect(h.ctx.saveConflict.value?.serverRevision).toBe(2);

    // Another node's write occupies the single send slot and hangs.
    let releaseB: (() => void) | null = null;
    mockAdapter.updateNodeContent.mockImplementationOnce(
      () => new Promise<never>((resolve) => { releaseB = () => resolve({ revision: 2 } as never); }),
    );
    const queuedB = enqueueNodeSave(NODE_B, 'B content', { validated: true, revision: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(callsFor(NODE_B)).toHaveLength(1);

    // Keep-mine is clicked: the write queues behind B.
    const keeping = h.save.resolveConflictKeepMine();
    await vi.advanceTimersByTimeAsync(0);

    // Queueing claimed nothing: the banner is still up, the confirmed
    // content is unchanged, and the server has NOT received a second write
    // for A. (The cache holds the capture's live read — rev 2 — which the
    // queued keep-mine must not change either.)
    expect(callsFor(NODE_A)).toHaveLength(1);
    expect(h.ctx.saveConflict.value?.nodeId).toBe(NODE_A);
    expect(h.ctx.lastSavedContent.value).toBe('A saved');
    expect(getCached(NODE_A)?.nodeInfo?.content).toBe('A server truth');
    expect(getCachedRevision(NODE_A)).toBe(2);

    // B finishes; the keep-mine write goes out against the captured
    // revision 2 and lands. (Register the response BEFORE releasing B: the
    // kick dispatches A's write synchronously once B settles.)
    mockAdapter.updateNodeContent.mockResolvedValueOnce({ revision: 3 } as never);
    releaseB!();
    await queuedB.done;
    await vi.advanceTimersByTimeAsync(0);
    expect(await keeping).toBe(true);

    // Server: the keep-mine write carried the pinned expected revision.
    const keepMineCall = callsFor(NODE_A)[1];
    expect(keepMineCall[1]).toBe('A local draft');
    expect(keepMineCall[2]).toMatchObject({ revision: 2 });
    // The conflict is resolved: banner gone, cache and confirmed updated.
    expect(h.ctx.saveConflict.value).toBeNull();
    expect(h.ctx.lastSavedContent.value).toBe('A local draft');
    expect(getCached(NODE_A)?.nodeInfo?.content).toBe('A local draft');
    expect(getCachedRevision(NODE_A)).toBe(3);
    expect(h.ctx.draft.value).toBe('A local draft');
  });

  it('7. a stale re-read landing after a newer write returns nothing and spares the cache', async () => {
    const h = await mountNode({ id: NODE_A, content: 'A saved' });

    // A conflicts; the capture reads revision 2 (verified).
    mockAdapter.updateNodeContent.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 412 }));
    mockAdapter.getNodeContext.mockResolvedValueOnce(contextOf(NODE_A, 'A server v2', 2));
    h.ctx.draft.value = 'A local draft';
    await nextTick();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    expect(h.ctx.saveConflict.value?.serverVerified).toBe(true);

    // A re-read starts and hangs.
    let releaseRead: (() => void) | null = null;
    mockAdapter.getNodeContext.mockImplementationOnce(
      () => new Promise<NodeContext>((resolve) => { releaseRead = () => resolve(contextOf(NODE_A, 'stale v2', 2)); }),
    );
    const store = useNodeStore();
    const reRead = store.refreshConflictCopy(NODE_A);

    // Keep-mine lands while the read is out: the server moves to revision 3.
    mockAdapter.updateNodeContent.mockResolvedValueOnce({ revision: 3 } as never);
    const kept = await h.save.resolveConflictKeepMine();
    expect(kept).toBe(true);
    expect(getCachedRevision(NODE_A)).toBe(3);

    // The stale read (revision 2) lands last: it belongs to a settled
    // state — no copy, and the cache keeps the newer revision and content.
    releaseRead!();
    expect(await reRead).toBeNull();
    expect(getCachedRevision(NODE_A)).toBe(3);
    expect(getCached(NODE_A)?.nodeInfo?.content).toBe('A local draft');
    expect(h.ctx.saveConflict.value).toBeNull();
    expect(h.ctx.draft.value).toBe('A local draft');
  });

  it('8. logging out mid-save: the late response writes nothing into the next session', async () => {
    const h = await mountNode({ id: NODE_A, content: 'A saved' });
    const store = useNodeStore();

    // A save is in flight when the user logs out.
    let release: (() => void) | null = null;
    mockAdapter.updateNodeContent.mockImplementationOnce(
      () => new Promise<never>((resolve) => { release = () => resolve({ revision: 2 } as never); }),
    );
    h.ctx.draft.value = 'A edited';
    await nextTick();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    expect(callsFor(NODE_A)).toHaveLength(1);

    store.resetAfterLogout();
    // The save session ended: the task's wait is over and the records are gone.
    expect(getNodeRecord(NODE_A)).toBeUndefined();

    // The next session loads the same node fresh.
    setCache(NODE_A, contextOf(NODE_A, 'fresh from server', 9));

    // The old request finally returns with success — it must touch nothing.
    release!();
    await vi.advanceTimersByTimeAsync(0);

    expect(getCached(NODE_A)?.nodeInfo?.content).toBe('fresh from server');
    expect(getCachedRevision(NODE_A)).toBe(9);
    expect(getNodeRecord(NODE_A)).toBeUndefined();
    expect(mockAdapter.updateNodeContent).toHaveBeenCalledTimes(1);
    expect(h.ctx.lastSavedContent.value).toBe('');
    expect(h.ctx.saveConflict.value).toBeNull();
  });
});
