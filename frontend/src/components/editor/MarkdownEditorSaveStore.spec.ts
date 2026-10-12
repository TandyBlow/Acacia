// @vitest-environment jsdom
// Cross-module conflict handling: the editor save composable running on the
// REAL pinia store (mock adapter). Pins the round-10 contract — another
// node's save settling must not retire this node's pending conflict, so a
// conflicted node can still re-read and adopt the server copy afterwards.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import type { NodeContext, NodeRecord, CoreDataAdapter } from '../types/node';

// migrateMathStrings walks editor.state/view, which the mock editor lacks.
vi.mock('@tiptap/extension-mathematics', () => ({ migrateMathStrings: vi.fn() }));

const mockAdapter: CoreDataAdapter = {
  getNodeContext: vi.fn<(nodeId: string | null) => Promise<NodeContext>>(),
  createNode: vi.fn<(parentId: string | null, name: string) => Promise<NodeRecord>>(),
  updateNodeContent: vi.fn<(nodeId: string, content: string) => Promise<never>>(),
  deleteNode: vi.fn<(nodeId: string, deleteChildren: boolean) => Promise<void>>(),
  moveNode: vi.fn<(nodeId: string, newParentId: string | null) => Promise<void>>(),
  getTree: vi.fn<() => Promise<never[]>>(),
  clearCache: vi.fn(),
};

import { getCached, getCachedRevision } from '../../services/nodeCache';
import { useNodeStore, setDataAdapter } from '../../stores/nodeStore';
import { useMarkdownEditorSave } from './MarkdownEditorSave';
import type { MarkdownEditorContext } from './MarkdownEditorContext';

const NODE_A = 'node-a';
const NODE_B = 'node-b';

function contextOf(nodeId: string, content: string, revision: number): NodeContext {
  const nodeInfo: NodeRecord = { id: nodeId, name: nodeId, content, parentId: null, sortOrder: 0, revision };
  return { nodeInfo, pathNodes: [], children: [] };
}

function makeEchoEditor() {
  const echoDoc = (md: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: md }] }],
  });
  return {
    commands: { setContent: vi.fn() },
    setEditable: vi.fn(),
    getMarkdown: vi.fn(() => ''),
    getJSON: vi.fn(() => echoDoc('')),
    state: { doc: { v: 0 } },
    markdown: { parse: vi.fn((md: string) => echoDoc(md)) },
    schema: { nodes: { doc: {}, paragraph: {}, text: {} }, nodeFromJSON: () => ({ check: vi.fn() }) },
  };
}

function makeCtx(store: ReturnType<typeof useNodeStore>) {
  return {
    activeNode: ref<{ id: string; content: string } | null>({ id: NODE_A, content: 'A saved' }),
    lastSavedContent: ref('A saved'),
    draft: ref(''),
    isParseDegraded: ref(false),
    integrityIssueText: ref(''),
    saveConflict: ref(null),
    t: (key: string) => key,
    isApplyingExternalContent: ref(false),
    editor: ref(makeEchoEditor()),
    store,
  };
}

async function loadSave(ctx: ReturnType<typeof makeCtx>) {
  const mod = await import('./MarkdownEditorSave');
  return mod.useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
}

describe('save composable on the real store (per-node pending conflicts)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setDataAdapter(mockAdapter);
    vi.clearAllMocks();
  });

  it('node B settling keeps node A\'s conflict alive: A re-reads and adopts the server copy', async () => {
    const store = useNodeStore();
    const ctx = makeCtx(store);
    const save = await loadSave(ctx);

    // Node A's save hangs, then fails 412 with a failed capture GET —
    // an unverified conflict.
    let releaseA: (() => void) | null = null;
    mockAdapter.updateNodeContent!.mockImplementationOnce(
      () => new Promise<never>((_resolve, reject) => { releaseA = () => reject(Object.assign(new Error('stale'), { status: 412 })); }),
    );
    mockAdapter.getNodeContext!.mockRejectedValueOnce(new Error('read failed'));

    const saveA = save.enqueueSave(NODE_A, 'A draft', { force: true, revision: 0 });
    // Node B queues behind A and then saves successfully.
    save.enqueueSave(NODE_B, 'B content', { force: true });

    // The stale-412 response must reject, not resolve.
    releaseA!();
    await saveA;
    // By the time saveA settles, node B's queued save has already run on
    // the microtask queue and retired the global pointer. A's conflict
    // survives in the per-node map — B's settle must not touch it.
    await vi.waitFor(() => expect(mockAdapter.updateNodeContent).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.lastSaveConflict).toBeNull());
    expect(store.pendingSaveConflicts.get(NODE_A)?.nodeId).toBe(NODE_A);
    expect(store.pendingSaveConflicts.get(NODE_A)?.serverVerified).toBe(false);
    expect(store.pendingSaveConflicts.has(NODE_B)).toBe(false);

    // A's banner survives B's success; the capture read failed, so the
    // conflict is unverified.
    expect(ctx.saveConflict.value?.nodeId).toBe(NODE_A);
    expect(ctx.saveConflict.value?.serverVerified).toBe(false);

    // The network is back: re-reading A reaches the server and returns the
    // fresh copy.
    mockAdapter.getNodeContext!.mockResolvedValueOnce(contextOf(NODE_A, 'A server truth', 5));
    const taken = await save.resolveConflictTakeServer();

    expect(taken).toBe(true);
    expect(ctx.draft.value).toBe('A server truth');
    expect(ctx.lastSavedContent.value).toBe('A server truth');
    expect(ctx.saveConflict.value).toBeNull();
    // The re-read landed A's server copy in the cache.
    expect(getCached(NODE_A)?.nodeInfo?.content).toBe('A server truth');
  });

  it('a re-read landing after node A\'s own keep-mine wins returns nothing and spares the newer cache', async () => {
    const store = useNodeStore();
    const ctx = makeCtx(store);
    const save = await loadSave(ctx);

    // A hits 412; the capture reads revision 1 and opens a verified conflict.
    mockAdapter.updateNodeContent!.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 412 }));
    mockAdapter.getNodeContext!.mockResolvedValueOnce(contextOf(NODE_A, 'A server v1', 1));
    ctx.draft.value = 'A draft';
    await save.enqueueSave(NODE_A, 'A draft', { force: true, revision: 0 });
    expect(ctx.saveConflict.value?.serverVerified).toBe(true);

    // A re-read starts; its GET hangs.
    let release: (() => void) | null = null;
    mockAdapter.getNodeContext!.mockImplementationOnce(
      () => new Promise<NodeContext>((resolve) => { release = () => resolve(contextOf(NODE_A, 'stale v1', 1)); }),
    );
    const reRead = store.refreshConflictCopy(NODE_A);

    // Keep-mine lands while the GET is in flight: revision 2, conflict gone.
    mockAdapter.updateNodeContent!.mockResolvedValueOnce({ revision: 2 } as never);
    const keepMine = await save.resolveConflictKeepMine();
    expect(keepMine).toBe(true);
    expect(store.lastSaveConflict).toBeNull();
    expect(getCachedRevision(NODE_A)).toBe(2);

    // The stale response arrives last: no copy, cache untouched.
    release!();
    const fresh = await reRead;
    expect(fresh).toBeNull();
    expect(getCachedRevision(NODE_A)).toBe(2);
    expect(getCached(NODE_A)?.nodeInfo?.content).toBe('A draft');
  });

  it('a failed keep-mine on an unverified conflict keeps the re-read channel alive', async () => {
    const store = useNodeStore();
    const ctx = makeCtx(store);
    const save = await loadSave(ctx);
    ctx.draft.value = 'A draft';

    // A hits 412; the capture GET fails — an unverified conflict.
    mockAdapter.updateNodeContent!.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 412 }));
    mockAdapter.getNodeContext!.mockRejectedValueOnce(new Error('read failed'));
    await save.enqueueSave(NODE_A, 'A draft', { force: true, revision: 0 });
    expect(ctx.saveConflict.value?.serverVerified).toBe(false);

    // Keep-mine fails with a plain network error (no conflict information).
    mockAdapter.updateNodeContent!.mockRejectedValueOnce(new Error('network down'));
    const kept = await save.resolveConflictKeepMine();
    expect(kept).toBe(false);

    // The banner and the pending record survive, flagged unverified — the
    // write may have committed, so nothing claims to know the server state.
    expect(ctx.saveConflict.value?.nodeId).toBe(NODE_A);
    expect(ctx.saveConflict.value?.serverVerified).toBe(false);
    expect(store.pendingSaveConflicts.get(NODE_A)?.serverVerified).toBe(false);

    // The network is back: take-server re-reads (a real GET goes out) and
    // adopts the server copy.
    mockAdapter.getNodeContext!.mockResolvedValueOnce(contextOf(NODE_A, 'A server truth', 5));
    const taken = await save.resolveConflictTakeServer();
    expect(taken).toBe(true);
    expect(mockAdapter.getNodeContext).toHaveBeenCalledTimes(2);
    expect(ctx.draft.value).toBe('A server truth');
    expect(getCached(NODE_A)?.nodeInfo?.content).toBe('A server truth');
  });

  it('a keep-mine that committed but lost its response re-reads rev 2 instead of adopting rev 1', async () => {
    const store = useNodeStore();
    const ctx = makeCtx(store);
    const save = await loadSave(ctx);
    ctx.draft.value = 'A draft';

    // A hits 412; the capture GET succeeds — a verified conflict at rev 1.
    mockAdapter.updateNodeContent!.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 412 }));
    mockAdapter.getNodeContext!.mockResolvedValueOnce(contextOf(NODE_A, 'A server v1', 1));
    await save.enqueueSave(NODE_A, 'A draft', { force: true, revision: 0 });
    expect(ctx.saveConflict.value?.serverVerified).toBe(true);

    // Keep-mine commits on the server (which moves to revision 2), but the
    // success response is lost — the client sees a network error.
    mockAdapter.updateNodeContent!.mockRejectedValueOnce(new Error('response lost'));
    const kept = await save.resolveConflictKeepMine();
    expect(kept).toBe(false);

    // The once-verified flag is invalidated on both the editor view and the
    // store record: the old read predates a write that landed.
    expect(ctx.saveConflict.value?.serverVerified).toBe(false);
    expect(store.pendingSaveConflicts.get(NODE_A)?.serverVerified).toBe(false);

    // Take-server therefore re-reads and adopts revision 2, never the
    // stale revision 1 copy the conflict was captured with.
    mockAdapter.getNodeContext!.mockResolvedValueOnce(contextOf(NODE_A, 'A server v2', 2));
    const taken = await save.resolveConflictTakeServer();
    expect(taken).toBe(true);
    expect(ctx.draft.value).toBe('A server v2');
    expect(ctx.lastSavedContent.value).toBe('A server v2');
    expect(getCachedRevision(NODE_A)).toBe(2);
  });

  it('node A adopting its copy does not erase node B\'s conflict or trigger a B retry', async () => {
    vi.useFakeTimers();
    const store = useNodeStore();
    const ctx = makeCtx(store);
    const save = await loadSave(ctx);

    // A saves first and hits 412 with a failed capture: an unverified
    // conflict, later resolved through the re-read.
    mockAdapter.updateNodeContent!.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 412 }));
    mockAdapter.getNodeContext!.mockRejectedValueOnce(new Error('read failed'));
    await save.enqueueSave(NODE_A, 'A draft', { force: true, revision: 0 });
    expect(ctx.saveConflict.value?.nodeId).toBe(NODE_A);

    // B then saves, hits 412, and its capture succeeds: the global pointer
    // now points at B's conflict (A's banner is still up underneath).
    mockAdapter.updateNodeContent!.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 412 }));
    mockAdapter.getNodeContext!.mockResolvedValueOnce(contextOf(NODE_B, 'B server v1', 1));
    await save.enqueueSave(NODE_B, 'B draft', { force: true, revision: 0 });
    expect(store.lastSaveConflict?.nodeId).toBe(NODE_B);

    // A adopts its server copy through the re-read.
    mockAdapter.getNodeContext!.mockResolvedValueOnce(contextOf(NODE_A, 'A server v6', 6));
    const taken = await save.resolveConflictTakeServer();
    expect(taken).toBe(true);
    expect(store.pendingSaveConflicts.has(NODE_A)).toBe(false);

    // The per-node cleanup left B's conflict exactly as captured — in the
    // map AND as the global pointer. (The old unconditional clear emptied
    // the pointer here, downgrading B's later failure into a blind retry.)
    expect(store.pendingSaveConflicts.get(NODE_B)?.nodeId).toBe(NODE_B);
    expect(store.lastSaveConflict?.nodeId).toBe(NODE_B);

    // A later save attempt for B therefore lands in its conflict — not
    // downgraded to a retry, so nothing overwrites the server with a
    // stale draft against the captured revision.
    await save.enqueueSave(NODE_B, 'B draft retry', { force: true, revision: 1 });
    await vi.runAllTimersAsync();
    expect(mockAdapter.updateNodeContent).toHaveBeenCalledTimes(3);
  });
});
