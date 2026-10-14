// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveRequestRecord, SaveWriteResult } from './saveSession';
import {
  MAX_SAVE_RETRIES,
  SAVE_RETRY_BASE_MS,
  adoptServerContent,
  clearNodeConflictIf,
  configureSaveSession,
  currentSessionId,
  enqueueNodeSave,
  endSaveSession,
  flushAllSaveTasks,
  getNodeConflict,
  getNodeRecord,
  invalidateNodeConflict,
  prepareNodeView,
  reconcileNodeContent,
  replaceNodeConflictIf,
  resetSaveSessionForTests,
  runNodeResolution,
  setNodeDraft,
  whenNodeIdle,
  beginNodeAdoption,
  cancelNodeTask,
  endNodeAdoption,
} from './saveSession';

type Write = (req: SaveRequestRecord) => Promise<SaveWriteResult>;

function setup(performWrite?: Write, resolveRevision?: (nodeId: string) => Promise<number | null>) {
  resetSaveSessionForTests();
  const write = vi.fn<Write>(performWrite ?? (async () => ({ ok: true, revision: null })));
  const resolve = vi.fn(resolveRevision ?? (async () => ({ revision: 7, content: 'ignored' })));
  configureSaveSession({ performWrite: write, resolveRevision: resolve });
  return { write, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe('saveSession registry', () => {
  it('performs the write with the full request envelope', async () => {
    const { write, resolve } = setup();
    const { taskId, done } = enqueueNodeSave('n1', 'content', { validated: true });

    expect(typeof taskId).toBe('number');
    await expect(done).resolves.toEqual({ status: 'saved', revision: null });
    expect(write).toHaveBeenCalledTimes(1);
    const req = write.mock.calls[0][0];
    expect(req.nodeId).toBe('n1');
    expect(req.content).toBe('content');
    expect(req.expectedRevision).toBe(7);
    expect(req.sessionId).toBe(currentSessionId());
    expect(typeof req.requestId).toBe('number');
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('skips the request when the content is already confirmed', async () => {
    setup();
    prepareNodeView('n1', 'saved text');
    const { done } = enqueueNodeSave('n1', 'saved text', { validated: true });

    await expect(done).resolves.toEqual({ status: 'saved', revision: null });
  });

  it('refuses to queue content without a validation verdict', async () => {
    setup();
    const { done } = enqueueNodeSave('n1', 'risky', {});
    await expect(done).resolves.toEqual({ status: 'refused' });
  });

  it('a confirmed write updates the record and clears a prior conflict', async () => {
    const { write } = setup();
    write.mockResolvedValueOnce({ ok: false, kind: 'conflict', conflict: { nodeId: 'n1', draftContent: 'c1', serverContent: 'server', serverRevision: 4, serverVerified: true } });
    const first = enqueueNodeSave('n1', 'c1', { validated: true });
    await expect(first.done).resolves.toEqual({ status: 'conflict' });
    expect(getNodeConflict('n1')?.serverContent).toBe('server');
    expect(getNodeConflict('n1')?.draftValidated).toBe(true);

    // The resolving write is licensed by the conflict it was granted against.
    write.mockResolvedValueOnce({ ok: true, revision: 5 });
    const second = enqueueNodeSave('n1', 'c1', { validated: true, force: true, conflictLicense: getNodeConflict('n1')!.conflictId });
    await expect(second.done).resolves.toEqual({ status: 'saved', revision: 5 });
    expect(getNodeConflict('n1')).toBeNull();
    const record = getNodeRecord('n1')!;
    expect(record.confirmedContent).toBe('c1');
    expect(record.confirmedRevision).toBe(5);
    expect(record.outcomeUncertain).toBe(false);
  });

  it('an unverified conflict keeps the outcome uncertain; the licensed write clears it', async () => {
    const { write } = setup();
    write.mockResolvedValueOnce({ ok: false, kind: 'conflict', conflict: { nodeId: 'n1', draftContent: 'c1', serverContent: 'cache copy', serverRevision: 0, serverVerified: false } });

    await expect(enqueueNodeSave('n1', 'c1', { validated: true }).done).resolves.toEqual({ status: 'conflict' });
    expect(getNodeRecord('n1')!.outcomeUncertain).toBe(true);

    // The licensed write goes out despite the open conflict and confirms
    // the server state, clearing the uncertainty.
    write.mockResolvedValueOnce({ ok: true, revision: 2 });
    const licensed = enqueueNodeSave('n1', 'c1', {
      validated: true, force: true, conflictLicense: getNodeConflict('n1')!.conflictId,
    });
    await expect(licensed.done).resolves.toEqual({ status: 'saved', revision: 2 });
    expect(write).toHaveBeenCalledTimes(2);
    expect(getNodeConflict('n1')).toBeNull();
    expect(getNodeRecord('n1')!.outcomeUncertain).toBe(false);
  });

  it('invalidation and re-reads keep the conflict id; a fresh capture mints a new one', async () => {
    const { write } = setup();
    write.mockResolvedValueOnce({ ok: false, kind: 'conflict', conflict: { nodeId: 'n1', draftContent: 'c1', serverContent: 'server v1', serverRevision: 1, serverVerified: true } });
    await expect(enqueueNodeSave('n1', 'c1', { validated: true }).done).resolves.toEqual({ status: 'conflict' });
    const originalId = getNodeConflict('n1')!.conflictId;

    // Invalidation (the write may have committed) keeps the grant.
    invalidateNodeConflict('n1');
    expect(getNodeConflict('n1')!.conflictId).toBe(originalId);

    // A re-read refreshes the server fields under the same id.
    const fresh = { nodeId: 'n1', draftContent: 'c1', serverContent: 'server v2', serverRevision: 2, serverVerified: true };
    expect(replaceNodeConflictIf('n1', getNodeConflict('n1')!, fresh)?.conflictId).toBe(originalId);

    // A NEW version conflict (the licensed write hit a moved server again)
    // mints a new id — outstanding licenses are revoked.
    write.mockResolvedValueOnce({ ok: false, kind: 'conflict', conflict: { nodeId: 'n1', draftContent: 'c2', serverContent: 'server v3', serverRevision: 3, serverVerified: true } });
    await expect(enqueueNodeSave('n1', 'c2', { validated: true, force: true, conflictLicense: originalId }).done).resolves.toEqual({ status: 'conflict' });
    expect(getNodeConflict('n1')!.conflictId).not.toBe(originalId);
  });

  it('an unknown failure ends the wait immediately and retries with the same expected revision', async () => {
    const { write } = setup();
    write.mockResolvedValueOnce({ ok: false, kind: 'error' });

    const { done } = enqueueNodeSave('n1', 'draft', { validated: true });
    await expect(done).resolves.toEqual({ status: 'unknown' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(getNodeRecord('n1')!.outcomeUncertain).toBe(true);

    // The retry keeps the original expected revision under a new request id.
    write.mockResolvedValueOnce({ ok: true, revision: 9 });
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_BASE_MS);
    expect(write).toHaveBeenCalledTimes(2);
    const first = write.mock.calls[0][0];
    const retry = write.mock.calls[1][0];
    expect(retry.expectedRevision).toBe(first.expectedRevision);
    expect(retry.content).toBe(first.content);
    expect(retry.requestId).not.toBe(first.requestId);

    const record = getNodeRecord('n1')!;
    expect(record.confirmedContent).toBe('draft');
    expect(record.confirmedRevision).toBe(9);
    expect(record.outcomeUncertain).toBe(false);
  });

  it('the retry budget is per node', async () => {
    const { write } = setup();
    write.mockResolvedValue({ ok: false, kind: 'error' });

    await expect(enqueueNodeSave('nA', 'A', { validated: true }).done).resolves.toEqual({ status: 'unknown' });
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_BASE_MS * 8);
    // Initial attempt + MAX_SAVE_RETRIES retries, then the node gives up.
    const callsForA = write.mock.calls.filter(([req]) => req.nodeId === 'nA');
    expect(callsForA).toHaveLength(MAX_SAVE_RETRIES + 1);

    // A fresh node still gets its own full budget.
    await expect(enqueueNodeSave('nB', 'B', { validated: true }).done).resolves.toEqual({ status: 'unknown' });
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_BASE_MS);
    expect(write.mock.calls.filter(([req]) => req.nodeId === 'nB')).toHaveLength(2);
  });

  it('an in-flight unknown failure does not clobber a newer queued draft with a stale retry', async () => {
    const { write } = setup();
    write.mockResolvedValueOnce({ ok: false, kind: 'error' });

    const first = enqueueNodeSave('n1', 'old draft', { validated: true });
    await expect(first.done).resolves.toEqual({ status: 'unknown' });
    // The newer draft is queued while the first request is out.
    const newer = enqueueNodeSave('n1', 'new draft', { validated: true, delayMs: SAVE_RETRY_BASE_MS });
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_BASE_MS);

    // The stale content went out exactly once: no background retry of it —
    // the newer task carries the node forward instead.
    const contents = write.mock.calls.map(([req]) => req.content);
    expect(contents.filter((c) => c === 'old draft')).toHaveLength(1);
    expect(contents).toContain('new draft');
    await expect(newer.done).resolves.toEqual({ status: 'saved', revision: null });
  });

  it('superseding a queued task ends the old wait and sends only the new content', async () => {
    const { write } = setup();
    const first = enqueueNodeSave('n1', 'v1', { validated: true, delayMs: 5_000 });
    const second = enqueueNodeSave('n1', 'v2', { validated: true });

    await expect(first.done).resolves.toEqual({ status: 'superseded' });
    await expect(second.done).resolves.toEqual({ status: 'saved', revision: null });
    expect(write.mock.calls.map(([req]) => req.content)).toEqual(['v2']);
  });

  it('cancelling a settled-node task sends nothing; an unresolved node gets a reconciliation write', async () => {
    const { write } = setup();
    prepareNodeView('n1', 'saved', 3);

    reconcileNodeContent('n1', 'saved', true);
    await vi.runAllTimersAsync();
    expect(write).not.toHaveBeenCalled();

    // Uncertain outcome: the desired content must go out despite matching
    // the (unproven) confirmed content.
    const record = getNodeRecord('n1')!;
    record.outcomeUncertain = true;
    const reconciled = reconcileNodeContent('n1', 'saved', true);
    expect(reconciled).not.toBeNull();
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_BASE_MS);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0].content).toBe('saved');
    expect(write.mock.calls[0][0].expectedRevision).toBe(3);
  });

  it('a late confirmed response does not overwrite a newer queued draft', async () => {
    const { write } = setup();
    let release: (() => void) | null = null;
    write.mockImplementationOnce(
      () => new Promise<SaveWriteResult>((resolve) => { release = () => resolve({ ok: true, revision: 3 }); }),
    );

    const first = enqueueNodeSave('n1', 'v1', { validated: true });
    const second = enqueueNodeSave('n1', 'v2', { validated: true });
    // Flush the dispatch chain's microtasks so the request is actually out.
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(1);

    release!();
    // A single await: asserting via expect(...).resolves would burn extra
    // microtasks and let the queued follow-up settle first.
    expect(await first.done).toEqual({ status: 'saved', revision: 3 });
    // The node's confirmed content is what the server accepted; the newer
    // draft is untouched and still goes out.
    expect(getNodeRecord('n1')!.confirmedContent).toBe('v1');
    expect(await second.done).toEqual({ status: 'saved', revision: null });
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0].content).toBe('v2');
    expect(getNodeRecord('n1')!.confirmedContent).toBe('v2');
  });

  it('ending the session ends every wait and late responses touch nothing', async () => {
    let release: ((result: SaveWriteResult) => void) | null = null;
    setup((req) => new Promise((resolve) => { release = resolve; }));

    const { done } = enqueueNodeSave('n1', 'draft', { validated: true });
    await vi.advanceTimersByTimeAsync(0); // request is out
    const sessionBefore = currentSessionId();
    endSaveSession();

    await expect(done).resolves.toEqual({ status: 'session-ended' });
    expect(currentSessionId()).toBe(sessionBefore + 1);
    expect(getNodeRecord('n1')).toBeUndefined();

    release!({ ok: true, revision: 4 });
    await vi.runAllTimersAsync();
    expect(getNodeRecord('n1')).toBeUndefined();
  });

  it('flush sends queued tasks immediately and stamps keepalive', async () => {
    const { write } = setup();
    enqueueNodeSave('n1', 'queued', { validated: true, delayMs: 60_000 });

    flushAllSaveTasks({ keepalive: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0].content).toBe('queued');
    expect(write.mock.calls[0][0].keepalive).toBe(true);
  });

  it('prepareNodeView restores the preserved draft, including an emptied one', async () => {
    setup();
    expect(prepareNodeView('n1', 'saved')).toBe('saved');
    setNodeDraft('n1', 'edited');
    setNodeDraft('n1', '');
    expect(prepareNodeView('n1', 'saved')).toBe('');
    expect(getNodeRecord('n1')!.editCount).toBe(2);
  });

  it('conflict retirement and replacement are identity-guarded', async () => {
    const { write } = setup();
    write.mockResolvedValueOnce({ ok: false, kind: 'conflict', conflict: { nodeId: 'n1', draftContent: 'c', serverContent: 's1', serverRevision: 1, serverVerified: true } });
    await expect(enqueueNodeSave('n1', 'c', { validated: true }).done).resolves.toEqual({ status: 'conflict' });
    const conflict = getNodeConflict('n1')!;

    // A genuinely different conflict (different id) does not match.
    expect(clearNodeConflictIf('n1', { ...conflict, conflictId: conflict.conflictId + 1 })).toBe(false);
    expect(getNodeConflict('n1')).toBe(conflict);

    const fresh = { nodeId: 'n1', draftContent: 'c', serverContent: 's2', serverRevision: 2, serverVerified: true, draftValidated: true };
    expect(replaceNodeConflictIf('n1', conflict, fresh)).not.toBeNull();
    expect(getNodeConflict('n1')?.serverContent).toBe('s2');

    invalidateNodeConflict('n1');
    expect(getNodeConflict('n1')?.serverVerified).toBe(false);
    expect(clearNodeConflictIf('n1', getNodeConflict('n1')!)).toBe(true);
    expect(getNodeConflict('n1')).toBeNull();
  });

  it('resolution operations on one node run strictly in order', async () => {
    setup();
    const order: string[] = [];
    const first = runNodeResolution('n1', async () => {
      await vi.advanceTimersByTimeAsync(10);
      order.push('first');
      return 1;
    });
    const second = runNodeResolution('n1', async () => {
      order.push('second');
      return 2;
    });
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });

  it('continued typing queued at the same base inherits the own write that lands', async () => {
    let release: ((result: SaveWriteResult) => void) | null = null;
    const { write } = setup();
    write.mockImplementationOnce(
      () => new Promise<SaveWriteResult>((resolve) => { release = () => resolve({ ok: true, revision: 5 }); }),
    );
    prepareNodeView('n1', 'loaded', 1);

    const first = enqueueNodeSave('n1', 'draft v1', { validated: true });
    // A second draft is queued while the first request is out: both were
    // edited against revision 1.
    const second = enqueueNodeSave('n1', 'draft v2', { validated: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0].expectedRevision).toBe(1);

    // The first write lands: the server moves to revision 5. The queued
    // draft follows OUR OWN commit — it must not hit a self-inflicted 412.
    release!();
    await expect(first.done).resolves.toEqual({ status: 'saved', revision: 5 });
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0].content).toBe('draft v2');
    expect(write.mock.calls[1][0].expectedRevision).toBe(5);
    await expect(second.done).resolves.toEqual({ status: 'saved', revision: null });
  });

  it('a pinned write keeps its captured revision when an own write lands meanwhile', async () => {
    let release: ((result: SaveWriteResult) => void) | null = null;
    const { write } = setup();
    write.mockImplementationOnce(
      () => new Promise<SaveWriteResult>((resolve) => { release = () => resolve({ ok: true, revision: 5 }); }),
    );
    prepareNodeView('n1', 'loaded', 1);

    const first = enqueueNodeSave('n1', 'draft v1', { validated: true });
    const pinned = enqueueNodeSave('n1', 'keep-mine draft', { validated: true, force: true, revision: 2 });
    await vi.advanceTimersByTimeAsync(0);
    release!();
    await expect(first.done).resolves.toEqual({ status: 'saved', revision: 5 });
    await vi.advanceTimersByTimeAsync(0);

    // The pinned revision belongs to a captured conflict: an own success
    // in between must not upgrade it — a moved server must answer 412.
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0].content).toBe('keep-mine draft');
    expect(write.mock.calls[1][0].expectedRevision).toBe(2);
    await expect(pinned.done).resolves.toEqual({ status: 'saved', revision: null });
  });

  it('a queued draft keeps its base version — only own successes inherit', async () => {
    const { write } = setup();
    write.mockResolvedValue({ ok: true, revision: 5 });
    prepareNodeView('n1', 'loaded', 1);

    // A draft queued at base 1 stays at 1 even after later enqueues learn
    // newer confirmed revisions: the version is stamped at queue time.
    const first = enqueueNodeSave('n1', 'draft v1', { validated: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(write.mock.calls[0][0].expectedRevision).toBe(1);
    await expect(first.done).resolves.toEqual({ status: 'saved', revision: 5 });

    // The next draft is stamped from the confirmed revision (5), not from
    // any externally refreshed cache.
    await enqueueNodeSave('n1', 'draft v2', { validated: true, force: true }).done;
    expect(write.mock.calls[1][0].expectedRevision).toBe(5);
  });

  it('resolving an unknown base compares the live text: a moved server enters the conflict flow', async () => {
    const { write, resolve } = setup();
    resolve.mockResolvedValue({ revision: 9, content: 'server moved on' });
    prepareNodeView('n1', 'loaded text', null); // base version never known

    const { done } = enqueueNodeSave('n1', 'my draft', { validated: true });

    await expect(done).resolves.toEqual({ status: 'conflict' });
    expect(write).not.toHaveBeenCalled();
    expect(getNodeConflict('n1')?.serverContent).toBe('server moved on');
    expect(getNodeConflict('n1')?.serverRevision).toBe(9);
    expect(getNodeConflict('n1')?.serverVerified).toBe(true);
    expect(getNodeConflict('n1')?.draftContent).toBe('my draft');
    const record = getNodeRecord('n1')!;
    expect(record.conflict).not.toBeNull();
    expect(record.draft).toBe('loaded text');
  });

  it('switch-back refreshes a clean record from the fresh read and keeps anything at stake', async () => {
    let release: ((result: SaveWriteResult) => void) | null = null;
    const { write } = setup();
    prepareNodeView('n1', 'loaded', 1);

    // Clean record: the fresh read wins, content AND revision.
    expect(prepareNodeView('n1', 'fresh from server', 7)).toBe('fresh from server');
    const record = getNodeRecord('n1')!;
    expect(record.confirmedContent).toBe('fresh from server');
    expect(record.confirmedRevision).toBe(7);

    // Unknown outcome: the server state is not settled — keep the record.
    record.outcomeUncertain = true;
    expect(prepareNodeView('n1', 'newer', 8)).toBe('fresh from server');
    expect(record.confirmedRevision).toBe(7);
    record.outcomeUncertain = false;

    // Open conflict: keep.
    record.conflict = { nodeId: 'n1', draftContent: 'd', serverContent: 's', serverRevision: 1, serverVerified: true, draftValidated: true, conflictId: 1 };
    expect(prepareNodeView('n1', 'newer', 8)).toBe('fresh from server');
    record.conflict = null;

    // A task still resolving its write base counts as pending too.
    write.mockImplementationOnce(
      () => new Promise<SaveWriteResult>(() => { /* hangs */ }),
    );
    const saving = enqueueNodeSave('n1', 'edited', { validated: true, force: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(prepareNodeView('n1', 'newer', 8)).toBe('fresh from server');
    release = null;
    resetSaveSessionForTests();
    void saving;
  });

  it('whenNodeIdle answers after the write lands, or session-ended on logout', async () => {
    let release: ((result: SaveWriteResult) => void) | null = null;
    const { write } = setup();
    write.mockImplementationOnce(
      () => new Promise<SaveWriteResult>((resolve) => { release = () => resolve({ ok: true, revision: 2 }); }),
    );
    const first = enqueueNodeSave('n1', 'draft', { validated: true });
    await vi.advanceTimersByTimeAsync(0);

    // Registered while the write is on the wire.
    let idleOutcome: string | null = null;
    const idle = whenNodeIdle('n1').then((outcome) => { idleOutcome = outcome; });
    release!();
    await expect(first.done).resolves.toEqual({ status: 'saved', revision: 2 });
    await idle;
    expect(idleOutcome).toBe('idle');

    // Logout ends a pending idle wait explicitly.
    write.mockImplementationOnce(
      () => new Promise<SaveWriteResult>(() => { /* hangs */ }),
    );
    const second = enqueueNodeSave('n1', 'draft v2', { validated: true, force: true });
    await vi.advanceTimersByTimeAsync(0);
    const logout = whenNodeIdle('n1').then((outcome) => outcome);
    endSaveSession();
    await expect(logout).resolves.toBe('session-ended');
    await expect(second.done).resolves.toEqual({ status: 'session-ended' });
  });

  it("an adoption hold pauses the node's sends until it is lifted", async () => {
    const { write } = setup();
    beginNodeAdoption('n1');

    const held = enqueueNodeSave('n1', 'held draft', { validated: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(write).not.toHaveBeenCalled();

    // Under the hold the task just waits; take-server cancels it.
    cancelNodeTask('n1');
    await expect(held.done).resolves.toEqual({ status: 'cancelled' });

    // Failed saves do not re-arm retries into the hold either: the
    // reconciled write stays queued until the hold lifts.
    getNodeRecord('n1')!.outcomeUncertain = true;
    const reconciled = reconcileNodeContent('n1', 'held draft', true);
    expect(reconciled).not.toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(write).not.toHaveBeenCalled();

    endNodeAdoption('n1');
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_BASE_MS);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0].content).toBe('held draft');
    await expect(reconciled!.done).resolves.toEqual({ status: 'saved', revision: null });
  });

  it('adopting the server content cancels pending work and confirms the copy', async () => {
    const { write } = setup();
    const { done } = enqueueNodeSave('n1', 'stale draft', { validated: true, delayMs: 60_000 });

    adoptServerContent('n1', 'server copy', 6);
    await expect(done).resolves.toEqual({ status: 'cancelled' });
    const record = getNodeRecord('n1')!;
    expect(record.confirmedContent).toBe('server copy');
    expect(record.confirmedRevision).toBe(6);
    expect(record.draft).toBe('server copy');
    await vi.runAllTimersAsync();
    expect(write).not.toHaveBeenCalled();
  });
});
