// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref, shallowRef } from 'vue';
import type { MarkdownEditorContext } from './MarkdownEditorContext';
import type { MarkdownEditorSave } from './MarkdownEditorSave';

// migrateMathStrings walks editor.state/view, which the mock editor lacks.
vi.mock('@tiptap/extension-mathematics', () => ({ migrateMathStrings: vi.fn() }));

// Lifecycle registration is a component concern; the draft-watcher behavior
// under test is not. Stub the hooks so the composable mounts standalone.
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
  return {
    store: {
      saveActiveNodeContent: vi.fn().mockResolvedValue(false),
      lastSaveConflict: null as { nodeId: string } | null,
      refreshTree: vi.fn().mockResolvedValue(undefined),
    },
    activeNode: ref(nodeId ? { id: nodeId, content: savedContent } : null),
    lastSavedContent: ref(savedContent),
    draft: ref(''),
    isParseDegraded: ref(false),
    integrityIssueText: ref(''),
    saveConflict: ref(null),
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
  vi.resetModules();
  const saveMod = await import('./MarkdownEditorSave');
  const watchersMod = await import('./MarkdownEditorWatchers');
  const save = saveMod.useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
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
  });

  it('reverting the draft to saved content cancels only this node\'s queued save', async () => {
    const ctx = makeCtx('nB', 'B saved');
    ctx.editor.value = makeEchoEditor();
    const save = await loadModules(ctx);

    // Node A's first attempt just failed; its retry is armed (timer + queue).
    await save.enqueueSave('nA', 'A content');

    // Node B types and then reverts to its saved content.
    ctx.draft.value = 'B edited';
    await nextTick();
    ctx.draft.value = 'B saved';
    await nextTick();

    await vi.runAllTimersAsync();

    const calls = ctx.store.saveActiveNodeContent.mock.calls;
    // A's retry still went out.
    expect(calls.filter((call) => call[0] === 'nA').length).toBeGreaterThanOrEqual(2);
    // B's reverted intermediate draft never left.
    expect(calls.filter((call) => call[0] === 'nB')).toHaveLength(0);
  });

  it('a draft change with no active node leaves other nodes\' timers alone', async () => {
    const ctx = makeCtx(null, '');
    ctx.editor.value = makeEchoEditor();
    const save = await loadModules(ctx);

    // Node A's retry is armed while nothing is active.
    await save.enqueueSave('nA', 'A content');

    // A stray draft change arrives with no active node.
    ctx.draft.value = 'stray change';
    await nextTick();

    await vi.runAllTimersAsync();

    const calls = ctx.store.saveActiveNodeContent.mock.calls.filter((call) => call[0] === 'nA');
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
});
