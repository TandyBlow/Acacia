// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref, shallowRef } from 'vue';
import type { MarkdownEditorContext } from './MarkdownEditorContext';
import { createEditorSaveViews } from './MarkdownEditorContext';
import type { MarkdownEditorSave } from './MarkdownEditorSave';
import { resetSaveSessionForTests } from '../../services/saveSession';
import type { SaveWriteResult } from '../../services/saveSession';
import { useMarkdownEditorSave } from './MarkdownEditorSave';

// migrateMathStrings walks editor.state/view, which the mock editor lacks.
vi.mock('@tiptap/extension-mathematics', () => ({ migrateMathStrings: vi.fn() }));

// Lifecycle registration is a component concern; the draft-watcher behavior
// under test is not. (Real mount/unmount behavior is covered by the
// acceptance scenarios spec with a mounted harness component.)
vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>();
  return { ...actual, onMounted: () => undefined, onBeforeUnmount: () => undefined };
});

function makeEchoEditor() {
  const echoDoc = (md: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: md }] }],
  });
  return {
    commands: { setContent: vi.fn() },
    setEditable: vi.fn(),
    getMarkdown: vi.fn(() => ''),
    getJSON: vi.fn(() => ({ type: 'doc', content: [] })),
    state: { doc: { v: 0 } },
    markdown: { parse: vi.fn((md: string) => echoDoc(md)) },
    schema: {
      nodes: { doc: {}, paragraph: {}, text: {} },
      nodeFromJSON: () => ({ check: vi.fn() }),
    },
  };
}

function makeCtx(nodeId: string | null, savedContent: string) {
  const activeNode = ref(nodeId ? { id: nodeId, content: savedContent } : null);
  return {
    store: {
      saveNodeContent: vi.fn<(nodeId: string, content: string, options?: { expectedRevision?: number | null }) => Promise<SaveWriteResult>>(
        async () => ({ ok: false, kind: 'error' as const }),
      ),
      resolveNodeRevision: vi.fn<(nodeId: string) => Promise<number | null>>(async () => 1),
      refreshTree: vi.fn().mockResolvedValue(undefined),
    },
    activeNode,
    ...createEditorSaveViews(activeNode),
    draft: ref(''),
    isParseDegraded: ref(false),
    integrityIssueText: ref(''),
    hasUserEdited: ref(false),
    isChatSunk: ref(false),
    isFileSunk: ref(false),
    userInput: ref(''),
    pendingFile: ref(null),
    lastActiveNodeId: ref(null),
    editorRef: shallowRef(null),
    chatMode: ref('idle'),
    hasResumableSession: ref(false),
    setEditor: vi.fn(),
    exitChat: vi.fn(),
    resetForNewNode: vi.fn(),
    setNodeId: vi.fn(),
    registerRegion: vi.fn(),
    unregisterRegion: vi.fn(),
    editor: ref(makeEchoEditor()),
    t: (key: string) => key,
    isApplyingExternalContent: ref(false),
  };
}

async function loadModules(ctx: ReturnType<typeof makeCtx>) {
  const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
  const watchersMod = await import('./MarkdownEditorWatchers');
  watchersMod.useMarkdownEditorWatchers(ctx as unknown as MarkdownEditorContext, {
    save: save as unknown as MarkdownEditorSave,
    editor: ctx.editor,
    onCinemaChatMode: () => undefined,
  });
  return save;
}

describe('MarkdownEditorWatchers draft watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSaveSessionForTests();
  });

  it('reverting the draft to saved content cancels only this node\'s queued save', async () => {
    const ctx = makeCtx('nB', 'B saved');
    const save = await loadModules(ctx);

    // Node A's first attempt just failed; its retry is armed (timer + queue).
    await save.enqueueSave('nA', 'A content').done;

    // Node B types and then reverts to its saved content.
    ctx.draft.value = 'B edited';
    await nextTick();
    ctx.draft.value = 'B saved';
    await nextTick();

    await vi.runAllTimersAsync();

    const calls = ctx.store.saveNodeContent.mock.calls;
    // A's retry still went out.
    expect(calls.filter((call) => call[0] === 'nA').length).toBeGreaterThanOrEqual(2);
    // B's reverted intermediate draft never left.
    expect(calls.filter((call) => call[0] === 'nB')).toHaveLength(0);
  });

  it('a draft change with no active node leaves other nodes\' timers alone', async () => {
    const ctx = makeCtx(null, '');
    const save = await loadModules(ctx);

    // Node A's retry is armed while nothing is active.
    await save.enqueueSave('nA', 'A content').done;

    // A stray draft change arrives with no active node.
    ctx.draft.value = 'stray change';
    await nextTick();

    await vi.runAllTimersAsync();

    const calls = ctx.store.saveNodeContent.mock.calls.filter((call) => call[0] === 'nA');
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('switching to a node restores its preserved draft and conflict; other nodes keep saving', async () => {
    const ctx = makeCtx('nA', 'A saved');
    const save = await loadModules(ctx);

    // The user edits node A (queued for autosave), then switches to B.
    ctx.draft.value = 'A pending unsaved';
    await nextTick();
    ctx.activeNode.value = { id: 'nB', content: 'B saved' };
    await nextTick();
    // Node A's draft is preserved in its record; B's saved content shows.
    expect(ctx.draft.value).toBe('B saved');

    // Back to A: the preserved draft comes back, still queued.
    ctx.activeNode.value = { id: 'nA', content: 'A saved' };
    await nextTick();
    expect(ctx.draft.value).toBe('A pending unsaved');

    await vi.runAllTimersAsync();
    const callsForA = ctx.store.saveNodeContent.mock.calls.filter((call) => call[0] === 'nA');
    expect(callsForA.length).toBeGreaterThanOrEqual(1);
  });
});
