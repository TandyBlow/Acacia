// @vitest-environment jsdom
// Watchers under a REAL mounted component: no lifecycle stubbing — the
// mount / node-switch / unmount behavior runs for real, with the real
// Tiptap editor, the real save session, and the real pinia store behind a
// mocked network adapter.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import type { NodeContext, NodeRecord, CoreDataAdapter } from '../../types/node';

vi.mock('@tiptap/extension-mathematics', async (importOriginal) => {
  // The real one: the harness editor has the production extension stack.
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

import { getCached, invalidateAll, setCache } from '../../services/nodeCache';
import { getNodeConflict, resetSaveSessionForTests } from '../../services/saveSession';
import { useNodeStore, setDataAdapter } from '../../stores/nodeStore';
import { mountEditorHarness } from './editorTestHarness';
import type { EditorHarness } from './editorTestHarness';

const NODE_A = 'node-a';
const NODE_B = 'node-b';

function contextOf(nodeId: string, content: string, revision: number): NodeContext {
  const nodeInfo: NodeRecord = { id: nodeId, name: nodeId, content, parentId: null, sortOrder: 0, revision };
  return { nodeInfo, pathNodes: [], children: [] };
}

describe('MarkdownEditorWatchers (mounted component)', () => {
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
    store.activeNode = { ...node, parentId: null, sortOrder: 0, revision: 1 };
    // The node was loaded: its context is cached, revisions included.
    setCache(node.id, contextOf(node.id, node.content, 1));
    harness = mountEditorHarness(store, { id: node.id, content: node.content });
    await nextTick();
    return harness;
  }

  it('mounting loads the content through the real parse pipeline and seeds the record', async () => {
    const h = await mountNode({ id: NODE_A, content: '# Title\n\nSome text.' });

    expect(h.ctx.draft.value).toBe('# Title\n\nSome text.');
    expect(h.ctx.lastSavedContent.value).toBe('# Title\n\nSome text.');
    expect(h.ctx.isParseDegraded.value).toBe(false);
    expect(h.ctx.integrityIssueText.value).toBe('');
    expect(h.ctx.editor.value!.getMarkdown()).toBe('# Title\n\nSome text.');
  });

  it('switching nodes preserves the outgoing draft and restores it on switch-back', async () => {
    const h = await mountNode({ id: NODE_A, content: 'A saved' });

    // The user types on node A (the draft watcher mirrors it into the record).
    h.ctx.draft.value = 'A pending unsaved';
    await nextTick();

    h.ctx.activeNode.value = { id: NODE_B, content: 'B saved', parentId: null, sortOrder: 0, revision: 1 };
    await nextTick();
    expect(h.ctx.draft.value).toBe('B saved');

    // Node A's queued autosave still goes out while the user is on B.
    await vi.advanceTimersByTimeAsync(1500);
    const callsForA = mockAdapter.updateNodeContent.mock.calls.filter((call) => call[0] === NODE_A);
    expect(callsForA).toHaveLength(1);
    expect(callsForA[0][1]).toBe('A pending unsaved');

    // Back to A through the real navigation path: the node context comes
    // from the cache, which the background save already updated.
    h.ctx.activeNode.value = { ...getCached(NODE_A)!.nodeInfo! };
    await nextTick();
    expect(h.ctx.draft.value).toBe('A pending unsaved');
    expect(h.ctx.lastSavedContent.value).toBe('A pending unsaved');
  });

  it('switching back to an unmodified node shows the re-read server content, not a stale record', async () => {
    const h = await mountNode({ id: NODE_A, content: 'A saved' });

    h.ctx.activeNode.value = { id: NODE_B, content: 'B saved', parentId: null, sortOrder: 0, revision: 1 };
    setCache(NODE_B, contextOf(NODE_B, 'B saved', 1));
    await nextTick();

    // While away, a re-read fetches a newer server draft for A (the cache
    // and the store's node context move together, as refreshCurrentNode does).
    setCache(NODE_A, contextOf(NODE_A, 'A server v2', 2));

    h.ctx.activeNode.value = { ...getCached(NODE_A)!.nodeInfo! };
    await nextTick();
    expect(h.ctx.draft.value).toBe('A server v2');
    expect(h.ctx.lastSavedContent.value).toBe('A server v2');
  });

  it('a conflict for the active node raises the banner, hides it on switch-away, restores it on switch-back', async () => {
    const h = await mountNode({ id: NODE_A, content: 'A saved' });

    // The autosave hits a moved server: 412, live capture reads revision 2.
    mockAdapter.updateNodeContent.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 412 }));
    mockAdapter.getNodeContext.mockResolvedValueOnce(contextOf(NODE_A, 'A server truth', 2));

    h.ctx.draft.value = 'A conflicting draft';
    await nextTick();
    await vi.advanceTimersByTimeAsync(1500);

    // The banner is up for the node on screen; autosave is paused for A.
    expect(h.ctx.saveConflict.value?.nodeId).toBe(NODE_A);
    expect(h.ctx.saveConflict.value?.serverRevision).toBe(2);
    const callsForA = mockAdapter.updateNodeContent.mock.calls.filter((call) => call[0] === NODE_A);
    expect(callsForA).toHaveLength(1);

    h.ctx.activeNode.value = { id: NODE_B, content: 'B saved', parentId: null, sortOrder: 0, revision: 1 };
    await nextTick();
    // No banner for node B — and B saves normally.
    expect(h.ctx.saveConflict.value).toBeNull();
    h.ctx.draft.value = 'B edited';
    await nextTick();
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockAdapter.updateNodeContent.mock.calls.filter((call) => call[0] === NODE_B)).toHaveLength(1);

    // Back to A: the conflict comes back with the preserved draft.
    h.ctx.activeNode.value = { id: NODE_A, content: 'A saved', parentId: null, sortOrder: 0, revision: 2 };
    await nextTick();
    expect(h.ctx.draft.value).toBe('A conflicting draft');
    expect(h.ctx.saveConflict.value?.nodeId).toBe(NODE_A);
    expect(getNodeConflict(NODE_A)?.serverContent).toBe('A server truth');
  });

  it('unmounting flushes queued saves and the save session outlives the component', async () => {
    const h = await mountNode({ id: NODE_A, content: 'A saved' });

    h.ctx.draft.value = 'A edited before teardown';
    await nextTick();
    // No debounce wait: unmounting flushes immediately.
    h.wrapper.unmount();
    harness = null;
    await vi.advanceTimersByTimeAsync(0);

    expect(mockAdapter.updateNodeContent).toHaveBeenCalledWith(
      NODE_A,
      'A edited before teardown',
      expect.anything(),
    );
  });

  it('a failed save keeps its retry armed across a node switch', async () => {
    const h = await mountNode({ id: NODE_A, content: 'A saved' });

    // The first write fails with a network error: outcome unknown, retry armed.
    mockAdapter.updateNodeContent.mockRejectedValueOnce(new Error('network down'));
    h.ctx.draft.value = 'A edited';
    await nextTick();
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockAdapter.updateNodeContent).toHaveBeenCalledTimes(1);

    // The user switches to B; A's retry must still fire.
    h.ctx.activeNode.value = { id: NODE_B, content: 'B saved', parentId: null, sortOrder: 0, revision: 1 };
    await nextTick();
    await vi.advanceTimersByTimeAsync(2500);

    const callsForA = mockAdapter.updateNodeContent.mock.calls.filter((call) => call[0] === NODE_A);
    expect(callsForA.length).toBeGreaterThanOrEqual(2);
  });
});
