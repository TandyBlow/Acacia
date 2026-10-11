// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { MarkdownEditorContext } from './MarkdownEditorContext';
import { AUTO_SAVE_DELAY_MS } from '../../constants/app';

// migrateMathStrings walks editor.state/view, which the mock editor lacks.
vi.mock('@tiptap/extension-mathematics', () => ({ migrateMathStrings: vi.fn() }));

// MarkdownEditorSave keeps its pending save in module state, so each test
// needs a fresh module instance.
function makeCtx() {
  return {
    activeNode: ref<{ id: string; content: string } | null>({ id: 'n1', content: 'old' }),
    lastSavedContent: ref('old'),
    draft: ref(''),
    isParseDegraded: ref(false),
    integrityIssueText: ref(''),
    saveConflict: ref<{ nodeId: string; serverContent: string; serverRevision: number } | null>(null),
    t: (key: string) => key,
    isApplyingExternalContent: ref(false),
    editor: ref<{ commands: { setContent: ReturnType<typeof vi.fn> }; setEditable: ReturnType<typeof vi.fn> }>({
      commands: { setContent: vi.fn() },
      setEditable: vi.fn(),
    }),
    // Plain object mirrors the pinia store, whose setup-store refs arrive
    // unwrapped on the instance.
    store: {
      saveActiveNodeContent: vi.fn().mockResolvedValue(true),
      lastSaveConflict: null as { nodeId: string; serverContent: string; serverRevision: number } | null,
    },
  };
}

/** Mock editor without a markdown manager: every parse fails through this one. */
function makeEditor(overrides: Record<string, unknown> = {}) {
  return {
    commands: { setContent: vi.fn() },
    setEditable: vi.fn(),
    getMarkdown: vi.fn(() => ''),
    getJSON: vi.fn(() => ({ type: 'doc', content: [] })),
    // The validation memo keys on state.doc identity; tests bump this to
    // simulate the document changing.
    state: { doc: { v: 0 } },
    ...overrides,
  };
}

/**
 * Mock editor whose manager echoes the markdown back as a single plain
 * paragraph — the parse-integrity check passes for plain-paragraph content.
 * The editor document (getJSON) and its serialization (getMarkdown) are
 * driven separately, so tests can model serialization-stage loss.
 */
function makeEchoEditor() {
  const current = { docMd: '', outMd: '', docVersion: 0 };
  const echoDoc = (md: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: md }] }],
  });
  const editor = makeEditor({
    markdown: {
      parse: vi.fn((md: string) => echoDoc(md)),
    },
    schema: {
      nodes: { doc: {}, paragraph: {}, text: {} },
      nodeFromJSON: () => ({ check: vi.fn() }),
    },
    getMarkdown: vi.fn(() => current.outMd),
    getJSON: vi.fn(() => echoDoc(current.docMd)),
  });
  (editor as unknown as { setCurrent: (docMd: string, outMd?: string) => void }).setCurrent = (
    docMd: string,
    outMd: string = docMd,
  ) => {
    current.docMd = docMd;
    current.outMd = outMd;
  };
  (editor as unknown as { bumpDoc: () => void }).bumpDoc = () => {
    current.docVersion += 1;
    (editor as unknown as { state: { doc: { v: number } } }).state = { doc: { v: current.docVersion } };
  };
  return editor;
}

async function loadSave(ctx: ReturnType<typeof makeCtx>) {
  vi.resetModules();
  const mod = await import('./MarkdownEditorSave');
  return mod.useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
}

describe('MarkdownEditorSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('flushes content that is still inside the debounce window', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = await loadSave(ctx);

    save.scheduleAutoSave('n1', 'typed content');
    // Well short of AUTO_SAVE_DELAY_MS — the timer has not fired.
    await vi.advanceTimersByTimeAsync(50);
    expect(ctx.store.saveActiveNodeContent).not.toHaveBeenCalled();

    save.flushPendingSave();
    await vi.runAllTimersAsync();

    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledWith(
      'n1',
      'typed content',
      expect.objectContaining({ force: true }),
    );
    expect(ctx.lastSavedContent.value).toBe('typed content');
  });

  it('forwards keepalive so the flush can outlive the page', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = await loadSave(ctx);

    save.scheduleAutoSave('n1', 'typed content');
    save.flushPendingSave({ keepalive: true });
    await vi.runAllTimersAsync();

    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledWith(
      'n1',
      'typed content',
      expect.objectContaining({ force: true, keepalive: true }),
    );
  });

  it('does nothing when no save is pending', async () => {
    const ctx = makeCtx();
    const save = await loadSave(ctx);

    save.flushPendingSave();
    await vi.runAllTimersAsync();

    expect(ctx.store.saveActiveNodeContent).not.toHaveBeenCalled();
  });

  it('keeps the content pending when the write fails, and retries', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    ctx.store.saveActiveNodeContent.mockResolvedValue(false);
    const save = await loadSave(ctx);

    save.scheduleAutoSave('n1', 'typed content');
    save.flushPendingSave();
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledTimes(1);
    expect(ctx.lastSavedContent.value).toBe('old');

    // The retry timer must still carry the unsaved content.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ctx.store.saveActiveNodeContent.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not advance lastSavedContent when the store rejects the write', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    ctx.store.saveActiveNodeContent.mockResolvedValue(false);
    const save = await loadSave(ctx);

    await save.enqueueSave('n1', 'typed content');

    expect(ctx.lastSavedContent.value).toBe('old');
  });

  it('goes read-only and degraded when parsing fails', async () => {
    const ctx = makeCtx();
    const save = await loadSave(ctx);

    save.syncEditorContent('# Title\n\nSome **bold** text with $E=mc^2$.');

    expect(ctx.isParseDegraded.value).toBe(true);
    expect(ctx.integrityIssueText.value).not.toBe('');
    expect(ctx.editor.value.setEditable).toHaveBeenCalledWith(false);
    // The flat fallback is still shown so the user can see the content.
    expect(ctx.editor.value.commands.setContent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'doc' }),
      expect.objectContaining({ emitUpdate: false }),
    );
  });

  it('never persists a degraded doc through any save path', async () => {
    const ctx = makeCtx();
    const save = await loadSave(ctx);
    save.syncEditorContent('# Title');

    save.scheduleAutoSave('n1', 'flattened');
    await vi.runAllTimersAsync();
    save.flushPendingSave();
    await vi.runAllTimersAsync();
    const forced = await save.enqueueSave('n1', 'flattened', { force: true });

    expect(forced).toBe(false);
    expect(ctx.store.saveActiveNodeContent).not.toHaveBeenCalled();
    expect(ctx.lastSavedContent.value).toBe('old');
  });

  it('recovers saving when a later load parses successfully', async () => {
    const ctx = makeCtx();
    const save = await loadSave(ctx);
    ctx.editor.value = makeEchoEditor();

    // A manager-less editor first: parse fails, degraded read-only.
    save.syncEditorContent('plain paragraph text');
    ctx.editor.value = makeEditor();
    save.syncEditorContent('plain paragraph text');
    expect(ctx.isParseDegraded.value).toBe(true);
    expect(ctx.editor.value.setEditable).toHaveBeenLastCalledWith(false);

    // Then a healthy parse: editable again, saves resume.
    ctx.editor.value = makeEchoEditor();
    save.syncEditorContent('plain paragraph text');

    expect(ctx.isParseDegraded.value).toBe(false);
    expect(ctx.integrityIssueText.value).toBe('');
    expect(ctx.editor.value.setEditable).toHaveBeenLastCalledWith(true);
    expect(ctx.editor.value.commands.setContent).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'doc' }),
      expect.objectContaining({ emitUpdate: false }),
    );

    save.scheduleAutoSave('n1', 'parsed content');
    await vi.runAllTimersAsync();
    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledWith('n1', 'parsed content', expect.anything());
  });

  it('suppresses autosave and raises the banner when the draft fails integrity', async () => {
    const ctx = makeCtx();
    // Manager-less editor: every validation fails.
    const save = await loadSave(ctx);

    save.scheduleAutoSave('n1', 'typed content');
    await vi.runAllTimersAsync();

    expect(ctx.store.saveActiveNodeContent).not.toHaveBeenCalled();
    expect(ctx.integrityIssueText.value).not.toBe('');
  });

  it('on 412 keeps the draft, pauses autosave, and never retries blindly', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    ctx.store.saveActiveNodeContent.mockResolvedValue(false);
    ctx.store.lastSaveConflict = { nodeId: 'n1', draftContent: 'typed content', serverContent: 'server text', serverRevision: 5 };
    const save = await loadSave(ctx);

    ctx.draft.value = 'typed content';
    save.scheduleAutoSave('n1', 'typed content');
    await vi.runAllTimersAsync();

    // Exactly one attempt: no retry storm against a version conflict.
    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledTimes(1);
    // The local draft is preserved for the user to decide on.
    expect(ctx.draft.value).toBe('typed content');
    expect(ctx.saveConflict.value?.serverRevision).toBe(5);

    // Further edits stay unsent while the conflict is open.
    ctx.draft.value = 'typed content v2';
    save.scheduleAutoSave('n1', 'typed content v2');
    await vi.runAllTimersAsync();
    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledTimes(1);
  });

  it('keep-mine re-saves the draft against the server version and clears the conflict', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = await loadSave(ctx);
    ctx.saveConflict.value = { nodeId: 'n1', draftContent: 'my draft', serverContent: 'server text', serverRevision: 5, draftValidated: true };

    ctx.draft.value = 'my draft';
    await save.resolveConflictKeepMine();

    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledWith(
      'n1',
      'my draft',
      expect.objectContaining({ force: true, revision: 5 }),
    );
    expect(ctx.saveConflict.value).toBeNull();
    expect(ctx.lastSavedContent.value).toBe('my draft');
  });

  it('keep-mine saves the latest draft when typing continued during the failed request', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    // The first request fails with a version conflict — but only after the
    // user has already kept typing. The retried keep-mine save succeeds.
    let rejectWithConflict: (() => void) | null = null;
    let calls = 0;
    ctx.store.saveActiveNodeContent.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => { rejectWithConflict = resolve; });
        ctx.store.lastSaveConflict = { nodeId: 'n1', draftContent: 'typed content', serverContent: 'server text', serverRevision: 5 };
        return false;
      }
      return true;
    });
    const save = await loadSave(ctx);

    ctx.draft.value = 'older draft';
    const inFlight = save.enqueueSave('n1', 'older draft');
    ctx.draft.value = 'newer draft typed while request was in flight';
    rejectWithConflict!();
    await inFlight;
    expect(ctx.saveConflict.value).not.toBeNull();
    // The in-flight content and the newer typing both survive untouched.
    expect(ctx.draft.value).toBe('newer draft typed while request was in flight');

    await save.resolveConflictKeepMine();
    expect(ctx.store.saveActiveNodeContent).toHaveBeenLastCalledWith(
      'n1',
      'newer draft typed while request was in flight',
      expect.objectContaining({ force: true, revision: 5 }),
    );
    expect(ctx.saveConflict.value).toBeNull();
  });

  it('take-server adopts the server content and drops the local draft', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = await loadSave(ctx);
    ctx.saveConflict.value = { nodeId: 'n1', draftContent: 'my draft', serverContent: 'server text', serverRevision: 5, draftValidated: true };

    save.resolveConflictTakeServer();

    expect(ctx.draft.value).toBe('server text');
    expect(ctx.lastSavedContent.value).toBe('server text');
    expect(ctx.saveConflict.value).toBeNull();
    expect(ctx.editor.value.commands.setContent).toHaveBeenCalled();
  });

  it('a late conflict response after switching nodes does not banner the new node', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    ctx.store.saveActiveNodeContent.mockResolvedValue(false);
    const save = await loadSave(ctx);

    // Request for node A goes out; the user switches to node B; then the
    // conflict response for A arrives.
    ctx.activeNode.value = { id: 'n2', content: '' };
    ctx.store.lastSaveConflict = { nodeId: 'n1', draftContent: 'a draft', serverContent: 'a server', serverRevision: 5 };

    await save.enqueueSave('n1', 'a draft');

    // No banner on node B; the conflict stays in the store for bookkeeping.
    expect(ctx.saveConflict.value).toBeNull();
    expect(ctx.store.lastSaveConflict?.nodeId).toBe('n1');
    // No retry storm against a version conflict either.
    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledTimes(1);
  });

  it('keep-mine after switching nodes replays the captured snapshot, not the other node draft', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = await loadSave(ctx);
    // The conflict belongs to node A; the editor now shows node B with its
    // own unsaved draft.
    ctx.saveConflict.value = {
      nodeId: 'n1',
      draftContent: 'node A draft',
      serverContent: 'node A server',
      serverRevision: 5,
      draftValidated: true,
    };
    ctx.activeNode.value = { id: 'n2', content: '' };
    ctx.draft.value = 'node B draft';

    await save.resolveConflictKeepMine();

    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledWith(
      'n1',
      'node A draft',
      expect.objectContaining({ force: true, revision: 5 }),
    );
    // Node B's draft is untouched and its content never sent to node A.
    expect(ctx.draft.value).toBe('node B draft');
    expect(ctx.saveConflict.value).toBeNull();
  });

  it('keep-mine refuses to replay a snapshot that never passed validation', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = await loadSave(ctx);
    ctx.saveConflict.value = {
      nodeId: 'n1',
      draftContent: 'risky snapshot',
      serverContent: 'server text',
      serverRevision: 5,
      draftValidated: false,
    };
    ctx.activeNode.value = { id: 'n2', content: '' };

    const saved = await save.resolveConflictKeepMine();

    expect(saved).toBe(false);
    expect(ctx.store.saveActiveNodeContent).not.toHaveBeenCalled();
  });

  it('take-server after switching nodes leaves the other node editor untouched', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = await loadSave(ctx);
    ctx.saveConflict.value = {
      nodeId: 'n1',
      draftContent: 'node A draft',
      serverContent: 'node A server',
      serverRevision: 5,
      draftValidated: true,
    };
    ctx.activeNode.value = { id: 'n2', content: 'node B content' };
    ctx.draft.value = 'node B draft';

    save.resolveConflictTakeServer();

    expect(ctx.saveConflict.value).toBeNull();
    expect(ctx.draft.value).toBe('node B draft');
    expect(ctx.activeNode.value?.content).toBe('node B content');
    expect(ctx.editor.value.commands.setContent).not.toHaveBeenCalled();
  });

  // ── Round-2 acceptance fixes ───────────────────────────────────────────

  it('a conflict for node A leaves node B pending save and timer intact', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    // Node B autosave is scheduled and ticking; then the in-flight request
    // for node A comes back with a version conflict.
    ctx.activeNode.value = { id: 'n2', content: '' };
    const save = await loadSave(ctx);

    save.scheduleAutoSave('nB', 'node B content');
    ctx.store.saveActiveNodeContent.mockImplementation(async () => {
      ctx.store.lastSaveConflict = { nodeId: 'nA', draftContent: 'A draft', serverContent: 'A server', serverRevision: 9 };
      return false;
    });

    await save.enqueueSave('nA', 'A content');

    // The conflict response must not tear down node B's queued save.
    await vi.runAllTimersAsync();
    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledWith(
      'nB',
      'node B content',
      expect.anything(),
    );
    // No banner either: node B is on screen, the conflict belongs to nA.
    expect(ctx.saveConflict.value).toBeNull();
  });

  it('an open conflict pauses autosave only for its own node', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = await loadSave(ctx);
    ctx.saveConflict.value = {
      nodeId: 'nA',
      draftContent: 'A draft',
      serverContent: 'A server',
      serverRevision: 9,
      draftValidated: true,
    };

    save.scheduleAutoSave('nA', 'node A retry');
    await vi.runAllTimersAsync();
    expect(ctx.store.saveActiveNodeContent).not.toHaveBeenCalled();

    save.scheduleAutoSave('nB', 'node B content');
    await vi.runAllTimersAsync();
    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledWith(
      'nB',
      'node B content',
      expect.anything(),
    );
  });

  it('serialization loss between editor doc and draft blocks the save', async () => {
    const ctx = makeCtx();
    const editor = makeEchoEditor();
    // The document holds "a+b"; serializing it drops the plus.
    (editor as unknown as { setCurrent: (docMd: string, outMd?: string) => void }).setCurrent(
      'the sum is a+b here',
      'the sum is ab here',
    );
    ctx.editor.value = editor;
    const save = await loadSave(ctx);

    save.scheduleAutoSave('n1', 'the sum is ab here');
    await vi.runAllTimersAsync();

    // String roundtrip alone would pass (parse of the draft is self-consistent);
    // the doc-equivalence leg catches the lost "+" and refuses to persist.
    expect(ctx.store.saveActiveNodeContent).not.toHaveBeenCalled();
    expect(ctx.integrityIssueText.value).not.toBe('');
  });

  it('a faithful serialization passes the doc-equivalence leg and saves', async () => {
    const ctx = makeCtx();
    const editor = makeEchoEditor();
    (editor as unknown as { setCurrent: (docMd: string, outMd?: string) => void }).setCurrent('the sum is a+b here');
    ctx.editor.value = editor;
    const save = await loadSave(ctx);

    save.scheduleAutoSave('n1', 'the sum is a+b here');
    await vi.runAllTimersAsync();

    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledWith(
      'n1',
      'the sum is a+b here',
      expect.anything(),
    );
  });

  // ── Round-3 acceptance fixes ───────────────────────────────────────────

  it('a queued save for another node with identical content still goes out', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    // Node A's request hangs; node B's timer fires meanwhile and its save
    // queues behind the in-flight request. Both nodes carry the same text.
    let releaseA: (() => void) | null = null;
    ctx.store.saveActiveNodeContent.mockImplementation(async () => {
      await new Promise<void>((resolve) => { releaseA = resolve; });
      return true;
    });
    const save = await loadSave(ctx);

    const inFlight = save.enqueueSave('nA', 'same text');
    ctx.activeNode.value = { id: 'nB', content: '' };
    save.scheduleAutoSave('nB', 'same text');
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);

    releaseA!();
    await inFlight;
    await vi.runAllTimersAsync();

    // The finally kick previously compared content only, dropping node B's
    // identical queued save. It must compare the node too.
    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledWith(
      'nB',
      'same text',
      expect.anything(),
    );
  });

  it('the validation memo cannot bypass the doc-equivalence leg after the document changes', async () => {
    const ctx = makeCtx();
    const editor = makeEchoEditor();
    const hooks = editor as unknown as {
      setCurrent: (docMd: string, outMd?: string) => void;
      bumpDoc: () => void;
    };
    // First pass: document and output are both "ab" — validation passes and
    // is memoized.
    hooks.setCurrent('ab');
    ctx.editor.value = editor;
    const save = await loadSave(ctx);
    expect(await save.enqueueSave('n1', 'ab', { force: true })).toBe(true);
    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledTimes(1);

    // The document gains the "+" but the serialization still drops it. A
    // stale memo keyed on the output string would reuse the ok verdict
    // without re-reading the document.
    hooks.setCurrent('a+b', 'ab');
    hooks.bumpDoc();
    ctx.draft.value = 'ab';
    ctx.saveConflict.value = {
      nodeId: 'n1',
      draftContent: 'ab',
      serverContent: 'server',
      serverRevision: 5,
      draftValidated: true,
    };

    const saved = await save.resolveConflictKeepMine();

    expect(saved).toBe(false);
    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledTimes(1);
    expect(ctx.saveConflict.value).not.toBeNull();
  });

  // ── Round-4 acceptance fixes ───────────────────────────────────────────

  it('a failed stale save does not clobber a newer draft queued for the same node', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    // The first request hangs; the newer draft is queued behind it; then the
    // first request fails with a plain (non-conflict) error.
    let releaseFirst: (() => void) | null = null;
    let calls = 0;
    ctx.store.saveActiveNodeContent.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return false;
      }
      return true;
    });
    const save = await loadSave(ctx);

    const inFlight = save.enqueueSave('n1', 'old draft');
    save.scheduleAutoSave('n1', 'new draft typed while request was in flight');
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    releaseFirst!();
    await inFlight;
    await vi.runAllTimersAsync();

    // The stale content went out exactly once; the retry carries the newer draft.
    const savedContents = ctx.store.saveActiveNodeContent.mock.calls.map((call) => call[1]);
    expect(savedContents.filter((content) => content === 'old draft')).toHaveLength(1);
    expect(savedContents).toContain('new draft typed while request was in flight');
  });

  it('cancelling one node\'s queued save leaves another node\'s retry armed', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    ctx.store.saveActiveNodeContent.mockResolvedValue(false);
    const save = await loadSave(ctx);

    // Node A's first attempt just failed; its retry is armed (timer + queue).
    await save.enqueueSave('nA', 'A content');

    // Node B's draft reverted to its saved content: cancel B only.
    save.cancelQueuedSave('nB');

    await vi.runAllTimersAsync();
    const callsForA = ctx.store.saveActiveNodeContent.mock.calls.filter((call) => call[0] === 'nA');
    expect(callsForA.length).toBeGreaterThanOrEqual(2);
  });

  it('a retry schedules for node A while the editor is degraded on node B', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    let release: (() => void) | null = null;
    ctx.store.saveActiveNodeContent.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return false;
    });
    const save = await loadSave(ctx);

    const inFlight = save.enqueueSave('nA', 'A content');
    // While that request is in flight the user switches to node B, whose
    // content fails to parse (read-only degraded editor).
    ctx.activeNode.value = { id: 'nB', content: '' };
    ctx.isParseDegraded.value = true;
    release!();
    await inFlight;

    // The failed attempt schedules a retry for A: B's degradation must not
    // swallow it, and A's content must not be re-validated against B's editor.
    await vi.runAllTimersAsync();
    const callsForA = ctx.store.saveActiveNodeContent.mock.calls.filter((call) => call[0] === 'nA');
    expect(callsForA.length).toBeGreaterThanOrEqual(2);
  });

  it('keep-mine response landing after a node switch does not stamp the other node', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    let release: (() => void) | null = null;
    ctx.store.saveActiveNodeContent.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return true;
    });
    const save = await loadSave(ctx);
    ctx.saveConflict.value = { nodeId: 'n1', draftContent: 'A draft', serverContent: 'A server', serverRevision: 5, draftValidated: true };
    ctx.draft.value = 'A draft latest';

    const pending = save.resolveConflictKeepMine();
    // The user switches to node B while the keep-mine request is in flight.
    ctx.activeNode.value = { id: 'n2', content: 'B content' };
    ctx.lastSavedContent.value = 'B content';
    release!();
    await pending;

    // A's content was saved to node A — but node B's lastSavedContent is
    // untouched: stamping it would make a later matching B edit look "saved".
    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledWith(
      'n1',
      'A draft latest',
      expect.objectContaining({ force: true, revision: 5 }),
    );
    expect(ctx.lastSavedContent.value).toBe('B content');
  });

  // ── Round-5 acceptance fixes ───────────────────────────────────────────

  it('a revert while the node save is in flight re-saves the revert after the response', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    let calls = 0;
    let releaseFirst: (() => void) | null = null;
    ctx.store.saveActiveNodeContent.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      }
      return true;
    });
    const save = await loadSave(ctx);

    ctx.lastSavedContent.value = 'A';
    save.scheduleAutoSave('n1', 'B');
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    // Before B's response lands, the user reverts the draft to A.
    save.cancelQueuedSave('n1', 'A');
    releaseFirst!();
    await vi.runAllTimersAsync();

    // B went out once; the revert result A followed it, and the saved
    // pointer ended on A — the editor shows A and the server holds A.
    const savedContents = ctx.store.saveActiveNodeContent.mock.calls.map((call) => call[1]);
    expect(savedContents).toEqual(['B', 'A']);
    expect(ctx.lastSavedContent.value).toBe('A');
  });

  it('a failed in-flight save still sends the reverted content — the outcome is unknown', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    let calls = 0;
    let releaseFirst: (() => void) | null = null;
    ctx.store.saveActiveNodeContent.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        // Network error: the client cannot know whether the server committed.
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return false;
      }
      return true;
    });
    const save = await loadSave(ctx);

    ctx.lastSavedContent.value = 'A';
    save.scheduleAutoSave('n1', 'B');
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    save.cancelQueuedSave('n1', 'A');
    releaseFirst!();
    await vi.runAllTimersAsync();

    // The failed save leaves the server state unknown, so the revert result
    // A must go out even though it equals the stale lastSavedContent — a
    // true failure lands it again, a false failure reaches the conflict path.
    const savedContents = ctx.store.saveActiveNodeContent.mock.calls.map((call) => call[1]);
    expect(savedContents).toEqual(['B', 'A']);
    expect(ctx.lastSavedContent.value).toBe('A');
  });

  it('a failed save disables the lastSavedContent dedup for its node until a save succeeds', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    ctx.store.saveActiveNodeContent.mockResolvedValueOnce(false).mockResolvedValue(true);
    const save = await loadSave(ctx);

    // First write fails without a conflict — the server may or may not have it.
    await save.enqueueSave('n1', 'typed content');
    ctx.lastSavedContent.value = 'typed content';

    // The same content must not be skipped as "already saved".
    expect(await save.enqueueSave('n1', 'typed content')).toBe(true);
    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledTimes(2);

    // The confirming write clears the uncertainty: dedup applies again.
    await save.enqueueSave('n1', 'typed content');
    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledTimes(2);
  });

  it('a false failure surfaces the server truth through the conflict banner when the revert is written', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    let calls = 0;
    let releaseFirst: (() => void) | null = null;
    ctx.store.saveActiveNodeContent.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return false;
      }
      // The revert write carries the stale revision: 412, server has B.
      ctx.store.lastSaveConflict = { nodeId: 'n1', draftContent: 'A', serverContent: 'B', serverRevision: 6 };
      return false;
    });
    const save = await loadSave(ctx);

    ctx.lastSavedContent.value = 'A';
    save.scheduleAutoSave('n1', 'B');
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    save.cancelQueuedSave('n1', 'A');
    releaseFirst!();
    await vi.runAllTimersAsync();

    // The server committed B while the client saw a network error; the
    // resent revert hits 412 and the banner shows the server copy.
    expect(ctx.saveConflict.value?.serverContent).toBe('B');
    expect(ctx.saveConflict.value?.serverRevision).toBe(6);
    expect(ctx.saveConflict.value?.nodeId).toBe('n1');
  });

  it('a revert with no save in flight queues nothing', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = await loadSave(ctx);

    save.cancelQueuedSave('n1', 'A');
    await vi.runAllTimersAsync();

    expect(ctx.store.saveActiveNodeContent).not.toHaveBeenCalled();
  });
});
