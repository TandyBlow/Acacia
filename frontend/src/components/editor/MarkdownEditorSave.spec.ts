// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { MarkdownEditorContext } from './MarkdownEditorContext';
import { createEditorSaveViews } from './MarkdownEditorContext';
import { AUTO_SAVE_DELAY_MS } from '../../constants/app';
import { enqueueNodeSave, resetSaveSessionForTests, getNodeConflict, getNodeRecord, replaceNodeConflictIf } from '../../services/saveSession';
import type { SaveWriteResult } from '../../services/saveSession';
import { useMarkdownEditorSave } from './MarkdownEditorSave';

// migrateMathStrings walks editor.state/view, which the mock editor lacks.
vi.mock('@tiptap/extension-mathematics', () => ({ migrateMathStrings: vi.fn() }));

/**
 * The save composable reads and writes the module-scope save session; the
 * registry is reset between tests and every conflict is produced through
 * the production path (a 412 flowing through a task settlement) — never by
 * assigning editor state directly.
 */
function makeCtx() {
  const activeNode = ref<{ id: string; content: string } | null>({ id: 'n1', content: 'old' });
  return {
    activeNode,
    ...createEditorSaveViews(activeNode),
    draft: ref(''),
    isParseDegraded: ref(false),
    integrityIssueText: ref(''),
    t: (key: string) => key,
    isApplyingExternalContent: ref(false),
    editor: ref<{ commands: { setContent: ReturnType<typeof vi.fn> }; setEditable: ReturnType<typeof vi.fn> }>({
      commands: { setContent: vi.fn() },
      setEditable: vi.fn(),
    }),
    // Plain object mirrors the pinia store, whose setup-store refs arrive
    // unwrapped on the instance.
    store: {
      saveNodeContent: vi.fn<(nodeId: string, content: string, options?: { expectedRevision?: number | null }) => Promise<SaveWriteResult>>(
        async () => ({ ok: true, revision: null }),
      ),
      resolveNodeRevision: vi.fn<(nodeId: string) => Promise<{ revision: number | null; content?: string } | null>>(async () => ({ revision: 1, content: 'ignored' })),
      refreshConflictCopy: vi.fn<(nodeId: string) => Promise<unknown>>(async () => null),
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
  const hooks = editor as unknown as {
    setCurrent: (docMd: string, outMd?: string) => void;
    bumpDoc: () => void;
    state: { doc: { v: number } };
  };
  hooks.setCurrent = (docMd: string, outMd: string = docMd) => {
    current.docMd = docMd;
    current.outMd = outMd;
  };
  hooks.bumpDoc = () => {
    current.docVersion += 1;
    hooks.state = { doc: { v: current.docVersion } };
  };
  return editor;
}

/** Seeds the node's record as if the editor had loaded it. */
function seedNode(save: ReturnType<typeof useMarkdownEditorSave>, nodeId: string, savedContent: string, savedRevision: number | null = 1): void {
  save.prepareNodeView(nodeId, savedContent, savedRevision);
}

/** Opens a conflict through the production path: a 412 settling a task. */
async function conflictVia412(
  ctx: ReturnType<typeof makeCtx>,
  save: ReturnType<typeof useMarkdownEditorSave>,
  nodeId: string,
  content: string,
  conflict: { serverContent: string; serverRevision: number; serverVerified: boolean },
): Promise<void> {
  ctx.store.saveNodeContent.mockResolvedValueOnce({
    ok: false,
    kind: 'conflict',
    conflict: { nodeId, draftContent: content, ...conflict },
  });
  const { done } = save.enqueueSave(nodeId, content, { force: true, validated: true });
  await done;
}

describe('MarkdownEditorSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSaveSessionForTests();
  });

  it('flushes content that is still inside the debounce window', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');

    save.scheduleAutoSave('n1', 'typed content');
    // Well short of AUTO_SAVE_DELAY_MS — the timer has not fired.
    await vi.advanceTimersByTimeAsync(50);
    expect(ctx.store.saveNodeContent).not.toHaveBeenCalled();

    save.flushPendingSave();
    await vi.runAllTimersAsync();

    expect(ctx.store.saveNodeContent).toHaveBeenCalledWith(
      'n1',
      'typed content',
      expect.objectContaining({ expectedRevision: 1 }),
    );
    expect(ctx.lastSavedContent.value).toBe('typed content');
  });

  it('forwards keepalive so the flush can outlive the page', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');

    save.scheduleAutoSave('n1', 'typed content');
    save.flushPendingSave({ keepalive: true });
    await vi.runAllTimersAsync();

    expect(ctx.store.saveNodeContent).toHaveBeenCalledWith(
      'n1',
      'typed content',
      expect.objectContaining({ keepalive: true }),
    );
  });

  it('does nothing when no save is pending', async () => {
    const ctx = makeCtx();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);

    save.flushPendingSave();
    await vi.runAllTimersAsync();

    expect(ctx.store.saveNodeContent).not.toHaveBeenCalled();
  });

  it('keeps the content pending when the write fails, and retries', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    ctx.store.saveNodeContent.mockResolvedValue({ ok: false, kind: 'error' });
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');

    save.scheduleAutoSave('n1', 'typed content');
    save.flushPendingSave();
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.store.saveNodeContent).toHaveBeenCalledTimes(1);
    expect(ctx.lastSavedContent.value).toBe('old');

    // The retry timer must still carry the unsaved content.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ctx.store.saveNodeContent.mock.calls.length).toBeGreaterThan(1);
  });

  it('reports the write outcome through the task handle', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');

    ctx.store.saveNodeContent.mockResolvedValueOnce({ ok: true, revision: 7 });
    const saved = save.enqueueSave('n1', 'typed content');
    expect(await saved.done).toEqual({ status: 'saved', revision: 7 });
    expect(ctx.lastSavedContent.value).toBe('typed content');

    // Queueing the same confirmed content resolves without a request.
    const deduped = save.enqueueSave('n1', 'typed content');
    expect(await deduped.done).toEqual({ status: 'saved', revision: 7 });
    expect(ctx.store.saveNodeContent).toHaveBeenCalledTimes(1);

    // Unvalidated content is refused as its own outcome.
    const refused = save.enqueueSave('n1', 'risky', { validated: false });
    expect(await refused.done).toEqual({ status: 'refused' });
  });

  it('does not advance confirmed content when the store rejects the write', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    ctx.store.saveNodeContent.mockResolvedValue({ ok: false, kind: 'error' });
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');

    const { done } = save.enqueueSave('n1', 'typed content');
    expect(await done).toEqual({ status: 'unknown' });

    expect(ctx.lastSavedContent.value).toBe('old');
  });

  it('goes read-only and degraded when parsing fails', async () => {
    const ctx = makeCtx();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);

    save.syncEditorContent('# Title\n\nSome **bold** text with $E=mc^2$.');

    expect(ctx.isParseDegraded.value).toBe(true);
    expect(ctx.integrityIssueText.value).not.toBe('');
    expect(ctx.editor.value!.setEditable).toHaveBeenCalledWith(false);
    // The flat fallback is still shown so the user can see the content.
    expect(ctx.editor.value!.commands.setContent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'doc' }),
      expect.objectContaining({ emitUpdate: false }),
    );
  });

  it('never persists a degraded doc through any save path', async () => {
    const ctx = makeCtx();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    save.syncEditorContent('# Title');

    save.scheduleAutoSave('n1', 'flattened');
    await vi.runAllTimersAsync();
    save.flushPendingSave();
    await vi.runAllTimersAsync();
    const forced = save.enqueueSave('n1', 'flattened', { force: true });
    expect(await forced.done).toEqual({ status: 'refused' });

    expect(ctx.store.saveNodeContent).not.toHaveBeenCalled();
  });

  it('recovers saving when a later load parses successfully', async () => {
    const ctx = makeCtx();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
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
    expect(ctx.store.saveNodeContent).toHaveBeenCalledWith('n1', 'parsed content', expect.anything());
  });

  it('suppresses autosave and raises the banner when the draft fails integrity', async () => {
    const ctx = makeCtx();
    // Manager-less editor: every validation fails.
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);

    save.scheduleAutoSave('n1', 'typed content');
    await vi.runAllTimersAsync();

    expect(ctx.store.saveNodeContent).not.toHaveBeenCalled();
    expect(ctx.integrityIssueText.value).not.toBe('');
  });

  it('on 412 keeps the draft, pauses autosave, and never retries blindly', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');

    await conflictVia412(ctx, save, 'n1', 'typed content', { serverContent: 'server text', serverRevision: 5, serverVerified: true });

    // Exactly one attempt: no retry storm against a version conflict.
    expect(ctx.store.saveNodeContent).toHaveBeenCalledTimes(1);
    // The conflict view is derived from the node's record.
    expect(ctx.saveConflict.value?.serverRevision).toBe(5);

    // Further edits stay unsent while the conflict is open.
    save.scheduleAutoSave('n1', 'typed content v2');
    await vi.runAllTimersAsync();
    expect(ctx.store.saveNodeContent).toHaveBeenCalledTimes(1);
  });

  it('keep-mine re-saves the draft against the server version and clears the conflict', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');
    ctx.draft.value = 'my draft';
    await conflictVia412(ctx, save, 'n1', 'my draft', { serverContent: 'server text', serverRevision: 5, serverVerified: true });

    const kept = await save.resolveConflictKeepMine();

    expect(kept).toBe(true);
    expect(ctx.store.saveNodeContent).toHaveBeenLastCalledWith(
      'n1',
      'my draft',
      expect.objectContaining({ expectedRevision: 5 }),
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
    ctx.store.saveNodeContent.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => { rejectWithConflict = resolve; });
        return {
          ok: false,
          kind: 'conflict',
          conflict: { nodeId: 'n1', draftContent: 'typed content', serverContent: 'server text', serverRevision: 5, serverVerified: true },
        };
      }
      return { ok: true, revision: 6 };
    });
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');

    ctx.draft.value = 'older draft';
    const inFlight = save.enqueueSave('n1', 'older draft');
    await vi.advanceTimersByTimeAsync(0); // the request is out
    ctx.draft.value = 'newer draft typed while request was in flight';
    rejectWithConflict!();
    expect(await inFlight.done).toEqual({ status: 'conflict' });
    expect(ctx.saveConflict.value).not.toBeNull();
    // The in-flight content and the newer typing both survive untouched.
    expect(ctx.draft.value).toBe('newer draft typed while request was in flight');

    await save.resolveConflictKeepMine();
    expect(ctx.store.saveNodeContent).toHaveBeenLastCalledWith(
      'n1',
      'newer draft typed while request was in flight',
      expect.objectContaining({ expectedRevision: 5 }),
    );
    expect(ctx.saveConflict.value).toBeNull();
  });

  it('take-server adopts the server content and drops the local draft', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');
    ctx.draft.value = 'my draft';
    await conflictVia412(ctx, save, 'n1', 'my draft', { serverContent: 'server text', serverRevision: 5, serverVerified: true });

    const taken = await save.resolveConflictTakeServer();

    expect(taken).toBe(true);
    expect(ctx.draft.value).toBe('server text');
    expect(ctx.lastSavedContent.value).toBe('server text');
    expect(ctx.saveConflict.value).toBeNull();
    expect(ctx.editor.value.commands.setContent).toHaveBeenCalled();
  });

  it('a late conflict response after switching nodes does not banner the new node', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');

    // Request for node A goes out; the user switches to node B; then the
    // conflict response for A arrives.
    ctx.activeNode.value = { id: 'n2', content: '' };
    await conflictVia412(ctx, save, 'n1', 'a draft', { serverContent: 'a server', serverRevision: 5, serverVerified: true });

    // No banner on node B; the conflict stays in the node's record.
    expect(ctx.saveConflict.value).toBeNull();
    expect(getNodeConflict('n1')?.nodeId).toBe('n1');
    // No retry storm against a version conflict either.
    expect(ctx.store.saveNodeContent).toHaveBeenCalledTimes(1);
  });

  it('take-server mid-flight keeps the switched-to node editor untouched', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');
    // The conflict's capture read failed: taking the server copy must
    // re-read first. The re-read hangs while the user switches away.
    await conflictVia412(ctx, save, 'n1', 'node A draft', { serverContent: 'stale cache', serverRevision: 0, serverVerified: false });
    let landRead: (() => void) | null = null;
    ctx.store.refreshConflictCopy.mockImplementation(async () => {
      await new Promise<void>((resolve) => { landRead = resolve; });
      const current = getNodeConflict('n1');
      if (!current) return null;
      const fresh = { nodeId: 'n1', draftContent: current.draftContent, serverContent: 'node A server', serverRevision: 6, serverVerified: true };
      return replaceNodeConflictIf('n1', current, fresh);
    });
    const taking = save.resolveConflictTakeServer();
    await vi.advanceTimersByTimeAsync(0); // the re-read is out
    ctx.activeNode.value = { id: 'n2', content: 'node B content' };
    save.prepareNodeView('n2', 'node B content');
    ctx.draft.value = 'node B draft';

    // The re-read lands the fresh copy after the switch: the adoption still
    // completes for node A, and node B's editor is untouched.
    landRead!();
    expect(await taking).toBe(true);

    expect(ctx.saveConflict.value).toBeNull();
    expect(ctx.draft.value).toBe('node B draft');
    expect(ctx.activeNode.value?.content).toBe('node B content');
    expect(ctx.editor.value.commands.setContent).not.toHaveBeenCalled();
    expect(ctx.lastSavedContent.value).toBe('node B content');
    expect(getNodeRecord('n1')!.confirmedContent).toBe('node A server');
    expect(getNodeConflict('n1')).toBeNull();
  });

  // ── Cross-node isolation ───────────────────────────────────────────────

  it('a conflict for node A leaves node B pending save and timer intact', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    // Node B autosave is scheduled and ticking; then the in-flight request
    // for node A comes back with a version conflict.
    ctx.activeNode.value = { id: 'n2', content: '' };
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);

    save.scheduleAutoSave('nB', 'node B content');
    await conflictVia412(ctx, save, 'nA', 'A content', { serverContent: 'A server', serverRevision: 9, serverVerified: true });

    // The conflict response must not tear down node B's queued save.
    await vi.runAllTimersAsync();
    expect(ctx.store.saveNodeContent).toHaveBeenCalledWith(
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
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'nA', 'old');
    await conflictVia412(ctx, save, 'nA', 'A draft', { serverContent: 'A server', serverRevision: 9, serverVerified: true });

    save.scheduleAutoSave('nA', 'node A retry');
    await vi.runAllTimersAsync();
    expect(ctx.store.saveNodeContent).toHaveBeenCalledTimes(1);

    save.scheduleAutoSave('nB', 'node B content');
    await vi.runAllTimersAsync();
    expect(ctx.store.saveNodeContent).toHaveBeenCalledWith(
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
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);

    save.scheduleAutoSave('n1', 'the sum is ab here');
    await vi.runAllTimersAsync();

    // String roundtrip alone would pass (parse of the draft is self-consistent);
    // the doc-equivalence leg catches the lost "+" and refuses to persist.
    expect(ctx.store.saveNodeContent).not.toHaveBeenCalled();
    expect(ctx.integrityIssueText.value).not.toBe('');
  });

  it('a faithful serialization passes the doc-equivalence leg and saves', async () => {
    const ctx = makeCtx();
    const editor = makeEchoEditor();
    (editor as unknown as { setCurrent: (docMd: string, outMd?: string) => void }).setCurrent('the sum is a+b here');
    ctx.editor.value = editor;
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);

    save.scheduleAutoSave('n1', 'the sum is a+b here');
    await vi.runAllTimersAsync();

    expect(ctx.store.saveNodeContent).toHaveBeenCalledWith(
      'n1',
      'the sum is a+b here',
      expect.anything(),
    );
  });

  it('a queued save for another node with identical content still goes out', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    // Node A's request hangs; node B's timer fires meanwhile and its save
    // queues behind the in-flight request. Both nodes carry the same text.
    let releaseA: (() => void) | null = null;
    ctx.store.saveNodeContent.mockImplementation(async () => {
      await new Promise<void>((resolve) => { releaseA = resolve; });
      return { ok: true, revision: null };
    });
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'nA', 'old');

    const inFlight = save.enqueueSave('nA', 'same text');
    ctx.activeNode.value = { id: 'nB', content: '' };
    save.scheduleAutoSave('nB', 'same text');
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);

    releaseA!();
    await inFlight.done;
    await vi.runAllTimersAsync();

    // The dedup is per node: node B's identical content is not "already saved".
    expect(ctx.store.saveNodeContent).toHaveBeenCalledWith(
      'nB',
      'same text',
      expect.anything(),
    );
  });

  it('the validation memo cannot bypass the doc-equivalence leg after the document changes', async () => {
    const ctx = makeCtx();
    const editor = makeEchoEditor();
    // First pass: document and output are both "ab" — validation passes and
    // is memoized.
    (editor as unknown as { setCurrent: (docMd: string, outMd?: string) => void }).setCurrent('ab');
    ctx.editor.value = editor;
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');
    expect(await save.enqueueSave('n1', 'ab', { force: true }).done).toEqual({ status: 'saved', revision: null });
    expect(ctx.store.saveNodeContent).toHaveBeenCalledTimes(1);

    // The document gains the "+" but the serialization still drops it. A
    // stale memo keyed on the output string would reuse the ok verdict
    // without re-reading the document.
    (editor as unknown as { setCurrent: (docMd: string, outMd?: string) => void }).setCurrent('a+b', 'ab');
    (editor as unknown as { bumpDoc: () => void }).bumpDoc();
    ctx.draft.value = 'ab';
    await conflictVia412(ctx, save, 'n1', 'ab', { serverContent: 'server', serverRevision: 5, serverVerified: true });

    const kept = await save.resolveConflictKeepMine();

    expect(kept).toBe(false);
    expect(ctx.store.saveNodeContent).toHaveBeenCalledTimes(2);
    expect(ctx.saveConflict.value).not.toBeNull();
  });

  it('a failed stale save does not clobber a newer draft queued for the same node', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    // The first request hangs; the newer draft is queued behind it; then the
    // first request fails with a plain (non-conflict) error.
    let releaseFirst: (() => void) | null = null;
    let calls = 0;
    ctx.store.saveNodeContent.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return { ok: false, kind: 'error' };
      }
      return { ok: true, revision: null };
    });
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');

    const inFlight = save.enqueueSave('n1', 'old draft');
    save.scheduleAutoSave('n1', 'new draft typed while request was in flight');
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    releaseFirst!();
    await inFlight.done;
    await vi.runAllTimersAsync();

    // The stale content went out exactly once; the retry carries the newer draft.
    const savedContents = ctx.store.saveNodeContent.mock.calls.map((call) => call[1]);
    expect(savedContents.filter((content) => content === 'old draft')).toHaveLength(1);
    expect(savedContents).toContain('new draft typed while request was in flight');
  });

  it('cancelling one node\'s queued save leaves another node\'s retry armed', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    ctx.store.saveNodeContent.mockResolvedValue({ ok: false, kind: 'error' });
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'nA', 'old');

    // Node A's first attempt just failed; its retry is armed (timer + queue).
    await save.enqueueSave('nA', 'A content').done;

    // Node B's draft reverted to its saved content: cancel B only.
    save.cancelQueuedSave('nB');

    await vi.runAllTimersAsync();
    const callsForA = ctx.store.saveNodeContent.mock.calls.filter((call) => call[0] === 'nA');
    expect(callsForA.length).toBeGreaterThanOrEqual(2);
  });

  it('a retry schedules for node A while the editor is degraded on node B', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    let release: (() => void) | null = null;
    ctx.store.saveNodeContent.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { ok: false, kind: 'error' };
    });
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'nA', 'old');

    const inFlight = save.enqueueSave('nA', 'A content');
    await vi.advanceTimersByTimeAsync(0); // the request is out
    // While that request is in flight the user switches to node B, whose
    // content fails to parse (read-only degraded editor).
    ctx.activeNode.value = { id: 'nB', content: '' };
    ctx.isParseDegraded.value = true;
    release!();
    await inFlight.done;

    // The failed attempt schedules a retry for A: B's degradation must not
    // swallow it, and A's content must not be re-validated against B's editor.
    await vi.runAllTimersAsync();
    const callsForA = ctx.store.saveNodeContent.mock.calls.filter((call) => call[0] === 'nA');
    expect(callsForA.length).toBeGreaterThanOrEqual(2);
  });

  it('a keep-mine response landing after a node switch confirms only that node', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    let release: (() => void) | null = null;
    ctx.store.saveNodeContent.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { ok: true, revision: 6 };
    });
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');
    ctx.draft.value = 'A draft latest';
    await conflictVia412(ctx, save, 'n1', 'A draft latest', { serverContent: 'A server', serverRevision: 5, serverVerified: true });

    const pending = save.resolveConflictKeepMine();
    await vi.advanceTimersByTimeAsync(0); // the keep-mine request is out
    // The user switches to node B while the keep-mine request is in flight.
    ctx.activeNode.value = { id: 'n2', content: 'B content' };
    save.prepareNodeView('n2', 'B content');
    release!();
    expect(await pending).toBe(true);

    // A's content was confirmed for node A — node B's view is untouched.
    expect(ctx.store.saveNodeContent).toHaveBeenLastCalledWith(
      'n1',
      'A draft latest',
      expect.objectContaining({ expectedRevision: 5 }),
    );
    expect(ctx.lastSavedContent.value).toBe('B content');
  });

  // ── Revert reconciliation ──────────────────────────────────────────────

  it('a revert while the node save is in flight re-saves the revert after the response', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    let calls = 0;
    let releaseFirst: (() => void) | null = null;
    ctx.store.saveNodeContent.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      }
      return { ok: true, revision: null };
    });
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'A');

    save.scheduleAutoSave('n1', 'B');
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    // Before B's response lands, the user reverts the draft to A.
    save.cancelQueuedSave('n1', 'A');
    releaseFirst!();
    await vi.runAllTimersAsync();

    // B went out once; the revert result A followed it, and the saved
    // pointer ended on A — the editor shows A and the server holds A.
    const savedContents = ctx.store.saveNodeContent.mock.calls.map((call) => call[1]);
    expect(savedContents).toEqual(['B', 'A']);
    expect(ctx.lastSavedContent.value).toBe('A');
  });

  it('a failed in-flight save still sends the reverted content — the outcome is unknown', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    let calls = 0;
    let releaseFirst: (() => void) | null = null;
    ctx.store.saveNodeContent.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        // Network error: the client cannot know whether the server committed.
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return { ok: false, kind: 'error' };
      }
      return { ok: true, revision: null };
    });
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'A');

    save.scheduleAutoSave('n1', 'B');
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    save.cancelQueuedSave('n1', 'A');
    releaseFirst!();
    await vi.runAllTimersAsync();

    // The failed save leaves the server state unknown, so the revert result
    // A must go out even though it equals the stale lastSavedContent — a
    // true failure lands it again, a false failure reaches the conflict path.
    const savedContents = ctx.store.saveNodeContent.mock.calls.map((call) => call[1]);
    expect(savedContents).toEqual(['B', 'A']);
    expect(ctx.lastSavedContent.value).toBe('A');
  });

  it('a failed save disables the confirmed-content dedup for its node until a save succeeds', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'typed content');

    // Same content is deduped while the server state is confirmed.
    expect(await save.enqueueSave('n1', 'typed content').done).toEqual({ status: 'saved', revision: 1 });
    expect(ctx.store.saveNodeContent).not.toHaveBeenCalled();

    // A failed write makes the outcome unknown: the dedup must not skip.
    ctx.store.saveNodeContent.mockResolvedValueOnce({ ok: false, kind: 'error' });
    await save.enqueueSave('n1', 'other content').done;
    expect(await save.enqueueSave('n1', 'typed content').done).toEqual({ status: 'saved', revision: null });
    expect(ctx.store.saveNodeContent).toHaveBeenCalledTimes(2);

    // The confirming write clears the uncertainty: dedup applies again.
    await save.enqueueSave('n1', 'typed content').done;
    expect(ctx.store.saveNodeContent).toHaveBeenCalledTimes(2);
  });

  it('a false failure surfaces the server truth through the conflict banner when the revert is written', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    let calls = 0;
    let releaseFirst: (() => void) | null = null;
    ctx.store.saveNodeContent.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return { ok: false, kind: 'error' };
      }
      // The revert write carries the stale revision: 412, server has B.
      return {
        ok: false,
        kind: 'conflict',
        conflict: { nodeId: 'n1', draftContent: 'A', serverContent: 'B', serverRevision: 6, serverVerified: true },
      };
    });
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'A');

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
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);

    save.cancelQueuedSave('n1', 'A');
    await vi.runAllTimersAsync();

    expect(ctx.store.saveNodeContent).not.toHaveBeenCalled();
  });

  it('a revert after the failed response re-saves the revert despite the queued retry', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    let calls = 0;
    ctx.store.saveNodeContent.mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? { ok: false, kind: 'error' } : { ok: true, revision: null };
    });
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'A');

    save.scheduleAutoSave('n1', 'B');
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
    // B's write failed with an unknown outcome and a retry is queued; the
    // user reverts to A only now. The revert must cancel the B retry and
    // schedule a reconciliation write of A.
    save.cancelQueuedSave('n1', 'A');
    await vi.runAllTimersAsync();

    const savedContents = ctx.store.saveNodeContent.mock.calls.map((call) => call[1]);
    expect(savedContents).toEqual(['B', 'A']);
    expect(ctx.lastSavedContent.value).toBe('A');
  });

  it('take-server waits out the raced keep-mine write and re-reads before adopting', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');
    await conflictVia412(ctx, save, 'n1', 'local draft', { serverContent: 'server truth', serverRevision: 5, serverVerified: true });
    const conflictId = getNodeConflict('n1')!.conflictId;

    // Keep-mine is clicked and its write hangs on the wire.
    let release: (() => void) | null = null;
    ctx.store.saveNodeContent.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { ok: false, kind: 'error' };  // the write fails: outcome unknown
    });
    const keeping = save.resolveConflictKeepMine();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.store.saveNodeContent).toHaveBeenCalledTimes(2);

    // The user adopts the server copy while that write is still out. The
    // operation holds the node's sends and waits.
    ctx.store.refreshConflictCopy.mockImplementation(async () => {
      const current = getNodeConflict('n1');
      if (!current) return null;
      const fresh = { nodeId: 'n1', draftContent: current.draftContent, serverContent: 'server truth v6', serverRevision: 6, serverVerified: true };
      return replaceNodeConflictIf('n1', current, fresh);
    });
    const taking = save.resolveConflictTakeServer();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.store.saveNodeContent).toHaveBeenCalledTimes(2);

    // The raced write fails with an unknown outcome; no retry may sneak in
    // after the adoption and overwrite the server with the local draft.
    release!();
    expect(await taking).toBe(true);
    await vi.runAllTimersAsync();

    expect(await keeping).toBe(false);
    expect(ctx.store.saveNodeContent).toHaveBeenCalledTimes(2);
    expect(getNodeRecord('n1')!.confirmedContent).toBe('server truth v6');
    expect(getNodeRecord('n1')!.confirmedRevision).toBe(6);
    expect(getNodeRecord('n1')!.outcomeUncertain).toBe(false);
    expect(getNodeConflict('n1')).toBeNull();
    expect(getNodeConflict('n1')?.conflictId).toBeUndefined();
    void conflictId;
    expect(ctx.lastSavedContent.value).toBe('server truth v6');
    expect(ctx.saveConflict.value).toBeNull();
  });

  // ── Take-server re-read semantics ──────────────────────────────────────

  it('take-server on an unverified conflict re-reads, swaps the record, and adopts the fresh copy', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');
    // The original conflict capture failed: the server fields hold a stale
    // cache, flagged unverified.
    await conflictVia412(ctx, save, 'n1', 'my draft', { serverContent: 'stale cache copy', serverRevision: 0, serverVerified: false });

    // Real-store semantics: the re-read swaps the registry record and
    // returns the fresh copy; a failure returns null.
    ctx.store.refreshConflictCopy.mockImplementation(async () => {
      const current = getNodeConflict('n1');
      if (!current) return null;
      const fresh = { nodeId: 'n1', draftContent: current.draftContent, serverContent: 'fresh server copy', serverRevision: 2, serverVerified: true };
      return replaceNodeConflictIf('n1', current, fresh);
    });

    const taken = await save.resolveConflictTakeServer();

    expect(taken).toBe(true);
    expect(ctx.draft.value).toBe('fresh server copy');
    expect(ctx.lastSavedContent.value).toBe('fresh server copy');
    expect(ctx.saveConflict.value).toBeNull();
    expect(ctx.editor.value.commands.setContent).toHaveBeenCalled();
  });

  it('take-server keeps the banner and draft when the re-read fails', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'old');
    ctx.draft.value = 'my draft';
    await conflictVia412(ctx, save, 'n1', 'my draft', { serverContent: 'stale cache copy', serverRevision: 0, serverVerified: false });
    ctx.store.refreshConflictCopy.mockResolvedValue(null);

    const taken = await save.resolveConflictTakeServer();

    // Nothing was adopted and the conflict stays open for a retry.
    expect(taken).toBe(false);
    expect(ctx.saveConflict.value?.nodeId).toBe('n1');
    expect(ctx.draft.value).toBe('my draft');
    expect(ctx.lastSavedContent.value).toBe('old');
    expect(ctx.editor.value.commands.setContent).not.toHaveBeenCalled();
  });

  it('an unverified conflict keeps the node outcome uncertain and gates plain enqueues', async () => {
    const ctx = makeCtx();
    ctx.editor.value = makeEchoEditor();
    const save = useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
    seedNode(save, 'n1', 'typed content');

    // A 412 whose capture GET failed: the conflict's server copy is a
    // stale cache — the node's real server state stays unknown.
    await conflictVia412(ctx, save, 'n1', 'other content', { serverContent: 'cached copy', serverRevision: 0, serverVerified: false });
    expect(getNodeRecord('n1')!.outcomeUncertain).toBe(true);

    // A plain enqueue cannot bypass the open conflict: refused with no
    // request, the unverified record and the banner untouched.
    expect(await save.enqueueSave('n1', 'typed content').done).toEqual({ status: 'conflict' });
    expect(ctx.store.saveNodeContent).toHaveBeenCalledTimes(1);
    expect(getNodeConflict('n1')?.serverVerified).toBe(false);
  });
});
