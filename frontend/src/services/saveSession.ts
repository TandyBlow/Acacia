import { reactive } from 'vue'

/**
 * The single home for editor save state. It lives at module scope, so it
 * outlives every editor instance: switching nodes, unmounting the editor,
 * or destroying the component never tears down a queued save, a retry, or
 * an open conflict.
 *
 * Everything is keyed by node id. One record per node carries the draft,
 * the edit counter, the confirmed (server-known) content and revision, the
 * retry state, and the open conflict. Queued tasks and in-flight requests
 * are bookkeeping rather than view state and live in plain side maps —
 * reactive wrapping would proxy them and break the identity checks that
 * match late responses and expire superseded tasks.
 *
 * A session counter stamps every request; ending the session (logout)
 * retires all records and makes late responses droppable. The registry
 * schedules sends (one write in flight at a time, kicked in record order)
 * but never validates content: callers pass the verdict of the shared
 * validation entry, and the refusal outcome is recorded here.
 */

export const MAX_SAVE_RETRIES = 3
export const SAVE_RETRY_BASE_MS = 2000

export interface SaveConflict {
  nodeId: string
  /** The draft that was being saved when the conflict hit — NOT the
   * currently displayed draft, which may belong to another node by now. */
  draftContent: string
  serverContent: string
  serverRevision: number
  /** True when serverContent/serverRevision come from a live GET. A failed
   * GET falls back to the cache, which may predate the conflicting write —
   * taking that "server copy" could revert the node. */
  serverVerified: boolean
}

export type ConflictedSave = SaveConflict & { draftValidated: boolean }

export type SaveTaskOutcome =
  | { status: 'saved'; revision: number | null }
  | { status: 'conflict' }
  | { status: 'unknown' }
  | { status: 'refused' }
  | { status: 'superseded' }
  | { status: 'cancelled' }
  | { status: 'session-ended' }

/** The envelope of one write attempt. A retry is a new request record with
 * a new requestId but the same content snapshot and expected revision. */
export interface SaveRequestRecord {
  requestId: number
  nodeId: string
  content: string
  /** Frozen at first dispatch; retries reuse it so the server's version
   * check keeps protecting against overwriting a moved server. */
  expectedRevision: number | null
  sessionId: number
  keepalive?: boolean
}

export type SaveWriteResult =
  | { ok: true; revision: number | null }
  | { ok: false; kind: 'conflict'; conflict: SaveConflict }
  | { ok: false; kind: 'error' }

export interface SaveTask {
  taskId: number
  content: string
  validated: boolean
  force: boolean
  keepalive?: boolean
  /** The version this draft was edited against: stamped from the record's
   * confirmed revision at enqueue (or pinned for keep-mine writes), and
   * frozen. External cache refreshes never rewrite it. */
  expectedRevision: number | null
  /** Normal tasks inherit the revision of an own write that succeeded after
   * they were queued at the same base version — continued typing follows
   * our own commits. Licensed keep-mine writes never do: their version is
   * pinned to the captured conflict. */
  inheritOwnSuccess: boolean
  editCount: number
  timer?: number
  resolve: (outcome: SaveTaskOutcome) => void
}

export interface NodeSaveRecord {
  nodeId: string
  /** Latest editor draft mirrored for the node; restored on switch-back. */
  draft: string
  editCount: number
  /** Content the server is known to hold, with its revision. */
  confirmedContent: string
  confirmedRevision: number | null
  confirmedSeeded: boolean
  /** A save failed without telling whether it committed; the same-content
   * dedup must not skip until a later save confirms. */
  outcomeUncertain: boolean
  retryCount: number
  conflict: ConflictedSave | null
}

export interface SaveTaskHandle {
  taskId: number
  done: Promise<SaveTaskOutcome>
}

/** Result of resolving an unknown write base: the live server version and
 * the text it currently holds (used to detect a moved server before an
 * unversioned draft is sent). */
export interface ResolvedRevision {
  revision: number | null
  content?: string
}

export interface SaveSessionDeps {
  performWrite(req: SaveRequestRecord): Promise<SaveWriteResult>
  resolveRevision(nodeId: string): Promise<ResolvedRevision | null>
}

export function configureSaveSession(d: SaveSessionDeps): void {
  deps = d
}

// Reactive so editor views (conflict banner, confirmed content) can derive
// from records without keeping a second writable copy.
const records = reactive(new Map<string, NodeSaveRecord>())
// Bookkeeping, kept out of the reactive records (raw identity comparisons).
const queuedTasks = new Map<string, SaveTask>()
const inFlightRequests = new Map<string, SaveRequestRecord>()
const inFlightTasks = new Map<string, SaveTask>()
const resolutionChains = new Map<string, Promise<unknown>>()

let sessionId = 1
let taskCounter = 0
let requestCounter = 0
let deps: SaveSessionDeps | null = null
let sending = false

export function currentSessionId(): number {
  return sessionId
}

/**
 * Ends the save session (logout): every queued task's wait ends, all
 * per-node records are dropped, and the session counter moves on so a late
 * response from the old session is recognized and discarded.
 */
export function endSaveSession(): void {
  sessionId += 1
  for (const [nodeId, task] of queuedTasks) {
    clearTaskTimer(nodeId)
    task.resolve({ status: 'session-ended' })
  }
  for (const [, task] of inFlightTasks) {
    task.resolve({ status: 'session-ended' })
  }
  queuedTasks.clear()
  inFlightRequests.clear()
  inFlightTasks.clear()
  records.clear()
  resolutionChains.clear()
}

export function getNodeRecord(nodeId: string): NodeSaveRecord | undefined {
  return records.get(nodeId)
}

export function getNodeConflict(nodeId: string): ConflictedSave | null {
  return records.get(nodeId)?.conflict ?? null
}

function ensureRecord(nodeId: string, seedContent?: string): NodeSaveRecord {
  let record = records.get(nodeId)
  if (!record) {
    record = reactive({
      nodeId,
      draft: '',
      editCount: 0,
      confirmedContent: '',
      confirmedRevision: null,
      confirmedSeeded: false,
      outcomeUncertain: false,
      retryCount: 0,
      conflict: null,
    })
    records.set(nodeId, record)
  }
  if (seedContent !== undefined && !record.confirmedSeeded) {
    record.confirmedContent = seedContent
    record.confirmedSeeded = true
  }
  return record
}

/**
 * Prepares the editor view for a node: seeds the record on first touch —
 * content AND the revision it was loaded at, which becomes the write base
 * of the drafts edited on top of it — and returns the draft to display:
 * the node's preserved draft when it has one (switch-back, including a
 * draft emptied by the user), otherwise the freshly loaded content.
 */
export function prepareNodeView(nodeId: string, seedContent: string, seedRevision: number | null = null): string {
  const existing = records.get(nodeId)
  if (!existing) {
    const record = ensureRecord(nodeId, seedContent)
    record.confirmedRevision = seedRevision
    record.draft = seedContent
    return seedContent
  }
  if (!existing.confirmedSeeded) {
    existing.confirmedContent = seedContent
    existing.confirmedRevision = seedRevision
    existing.confirmedSeeded = true
    existing.draft = seedContent
    return seedContent
  }
  return existing.draft
}

/** Mirrors the editor draft into the node's record, counting edits. */
export function setNodeDraft(nodeId: string, draft: string): void {
  const record = ensureRecord(nodeId)
  if (record.draft !== draft) {
    record.draft = draft
    record.editCount += 1
  }
}

export interface EnqueueOptions {
  validated?: boolean
  force?: boolean
  keepalive?: boolean
  /** Explicit revision pinned from creation (conflict keep-mine writes). */
  revision?: number
  /** Delay the first dispatch (autosave debounce). */
  delayMs?: number
}

/**
 * Queues a save for one node. Queueing has no side effects on confirmed
 * content or conflicts — those change only when a write settles. The
 * returned handle's `done` always settles: saved, conflict, unknown,
 * refused (validation), superseded (replaced), cancelled, session-ended.
 */
export function enqueueNodeSave(
  nodeId: string,
  content: string,
  options?: EnqueueOptions,
): SaveTaskHandle {
  if (!options?.validated) {
    return immediateDone({ status: 'refused' })
  }
  const record = ensureRecord(nodeId)
  const previous = queuedTasks.get(nodeId)
  if (previous) {
    clearTaskTimer(nodeId)
    queuedTasks.delete(nodeId)
    previous.resolve({ status: 'superseded' })
  }
  if (!options.force && !record.outcomeUncertain && content === record.confirmedContent) {
    return immediateDone({ status: 'saved', revision: record.confirmedRevision })
  }
  const task: SaveTask = {
    taskId: ++taskCounter,
    content,
    validated: options.validated,
    force: options.force ?? false,
    keepalive: options.keepalive,
    // The write base is the version this draft was edited against — the
    // record's confirmed revision at queue time. A pinned revision
    // (keep-mine) wins; external cache refreshes never rewrite it.
    expectedRevision: options.revision ?? record.confirmedRevision,
    inheritOwnSuccess: options.revision === undefined,
    editCount: record.editCount,
    resolve: () => {},
  }
  const done = new Promise<SaveTaskOutcome>((resolve) => { task.resolve = resolve })
  queuedTasks.set(nodeId, task)
  if (options.delayMs && options.delayMs > 0) {
    armTaskTimer(nodeId, task, options.delayMs)
  } else {
    dispatchNext()
  }
  return { taskId: task.taskId, done }
}

function immediateDone(outcome: SaveTaskOutcome): SaveTaskHandle {
  return { taskId: ++taskCounter, done: Promise.resolve(outcome) }
}

function armTaskTimer(nodeId: string, task: SaveTask, delayMs: number): void {
  task.timer = window.setTimeout(() => {
    // Drop only the due marker: the task stays queued for dispatchNext,
    // which is what hands it to dispatchTask (and deletes it there).
    task.timer = undefined
    if (queuedTasks.get(nodeId) === task) {
      dispatchNext()
    }
  }, delayMs)
}

function clearTaskTimer(nodeId: string): void {
  const task = queuedTasks.get(nodeId)
  if (task?.timer !== undefined) {
    window.clearTimeout(task.timer)
    task.timer = undefined
  }
}

/**
 * Cancels the node's queued task and ends its wait. When the node's server
 * state is unresolved — a save is in flight, or a failed one left the
 * outcome unknown — the desired content goes back as a short reconciliation
 * write; otherwise the server already holds it and nothing is sent.
 */
export function reconcileNodeContent(nodeId: string, desired: string, validated: boolean): SaveTaskHandle | null {
  const record = ensureRecord(nodeId)
  clearTaskTimer(nodeId)
  queuedTasks.get(nodeId)?.resolve({ status: 'cancelled' })
  queuedTasks.delete(nodeId)
  if (!validated) return null
  if (!inFlightRequests.has(nodeId) && !record.outcomeUncertain) return null
  return enqueueNodeSave(nodeId, desired, { force: true, validated, delayMs: SAVE_RETRY_BASE_MS })
}

/** Sends every queued task now (tab close, editor teardown). */
export function flushAllSaveTasks(options?: { keepalive?: boolean }): void {
  for (const [nodeId, task] of queuedTasks) {
    clearTaskTimer(nodeId)
    if (options?.keepalive) task.keepalive = true
  }
  dispatchNext()
}

function dispatchNext(): void {
  if (sending || !deps) return
  for (const record of records.values()) {
    const task = queuedTasks.get(record.nodeId)
    if (!task || task.timer !== undefined) continue
    void dispatchTask(record, task)
    return
  }
}

async function dispatchTask(record: NodeSaveRecord, task: SaveTask): Promise<void> {
  sending = true
  try {
    queuedTasks.delete(record.nodeId)

    if (!task.force && !record.outcomeUncertain && task.content === record.confirmedContent) {
      task.resolve({ status: 'saved', revision: record.confirmedRevision })
      return
    }
    const sessionAtDispatch = sessionId
    if (task.expectedRevision == null) {
      // The draft never knew a base version. Resolving one now must not
      // sneak a stale draft past a moved server: if the live read holds
      // different text than what this record was loaded from, the draft's
      // base is gone — keep it and enter the conflict flow instead.
      const resolved = await deps!.resolveRevision(record.nodeId)
      if (sessionId !== sessionAtDispatch) {
        task.resolve({ status: 'session-ended' })
        return
      }
      if (
        resolved
        && record.confirmedSeeded
        && resolved.content !== undefined
        && resolved.content !== record.confirmedContent
      ) {
        record.retryCount = 0
        record.outcomeUncertain = false
        record.conflict = {
          nodeId: record.nodeId,
          draftContent: task.content,
          serverContent: resolved.content,
          serverRevision: resolved.revision ?? 0,
          serverVerified: true,
          draftValidated: task.validated,
        }
        clearTaskTimer(record.nodeId)
        queuedTasks.get(record.nodeId)?.resolve({ status: 'conflict' })
        queuedTasks.delete(record.nodeId)
        task.resolve({ status: 'conflict' })
        return
      }
      task.expectedRevision = resolved?.revision ?? null
    }
    const request: SaveRequestRecord = {
      requestId: ++requestCounter,
      nodeId: record.nodeId,
      content: task.content,
      expectedRevision: task.expectedRevision,
      sessionId: sessionAtDispatch,
      keepalive: task.keepalive,
    }
    inFlightRequests.set(record.nodeId, request)
    inFlightTasks.set(record.nodeId, task)
    let result: SaveWriteResult
    try {
      result = await deps!.performWrite(request)
    } catch {
      result = { ok: false, kind: 'error' }
    } finally {
      if (inFlightRequests.get(record.nodeId) === request) inFlightRequests.delete(record.nodeId)
      if (inFlightTasks.get(record.nodeId) === task) inFlightTasks.delete(record.nodeId)
    }
    settle(record, task, request, result)
  } catch {
    // Anything unexpected (a throwing dependency, most likely) must still
    // end the task's wait: the outcome is treated as unknown.
    record.outcomeUncertain = true
    task.resolve({ status: 'unknown' })
  } finally {
    sending = false
    dispatchNext()
  }
}

function settle(record: NodeSaveRecord, task: SaveTask, request: SaveRequestRecord, result: SaveWriteResult): void {
  // The session ended while the request was out: it belongs to a dead
  // state and must touch nothing.
  if (request.sessionId !== sessionId) return
  if (result.ok) {
    record.confirmedContent = request.content
    if (result.revision != null) record.confirmedRevision = result.revision
    // Continued typing queued at the same base version follows our own
    // commit: inherit the post-write revision. External reads and unknown
    // outcomes never do this — only a confirmed own write may advance a
    // queued task's version.
    const queued = queuedTasks.get(record.nodeId)
    if (
      result.revision != null
      && queued?.inheritOwnSuccess
      && (queued.expectedRevision == null || queued.expectedRevision === request.expectedRevision)
    ) {
      queued.expectedRevision = result.revision
    }
    record.outcomeUncertain = false
    record.retryCount = 0
    // The server accepted this node's content: any open conflict for it is
    // resolved by the write itself, not by a user choice that never came.
    record.conflict = null
    task.resolve({ status: 'saved', revision: result.revision })
    return
  }
  if (result.kind === 'conflict') {
    record.retryCount = 0
    record.outcomeUncertain = !result.conflict.serverVerified
    record.conflict = { ...result.conflict, draftValidated: task.validated }
    // Pause this node: a queued sibling task would write past an unresolved
    // conflict, so it ends here with the same verdict.
    clearTaskTimer(record.nodeId)
    queuedTasks.get(record.nodeId)?.resolve({ status: 'conflict' })
    queuedTasks.delete(record.nodeId)
    task.resolve({ status: 'conflict' })
    return
  }
  // Unknown outcome: the write may have committed. The task's wait ends
  // now; the retry continues in the background with the same snapshot and
  // the same expected revision.
  record.outcomeUncertain = true
  record.retryCount += 1
  task.resolve({ status: 'unknown' })
  if (record.retryCount <= MAX_SAVE_RETRIES && !queuedTasks.has(record.nodeId)) {
    const retryTask: SaveTask = {
      taskId: ++taskCounter,
      content: request.content,
      validated: task.validated,
      force: true,
      keepalive: task.keepalive,
      expectedRevision: request.expectedRevision,
      inheritOwnSuccess: task.inheritOwnSuccess,
      editCount: task.editCount,
      resolve: () => {},
    }
    const retryDone = new Promise<SaveTaskOutcome>((resolve) => { retryTask.resolve = resolve })
    void retryDone.catch(() => {})
    queuedTasks.set(record.nodeId, retryTask)
    armTaskTimer(record.nodeId, retryTask, SAVE_RETRY_BASE_MS * 2 ** (record.retryCount - 1))
  }
}

/**
 * Runs conflict-resolution operations (keep-mine, take-server) for one node
 * strictly in submission order — two rapid clicks must not interleave.
 */
export function runNodeResolution<T>(nodeId: string, operation: () => Promise<T>): Promise<T> {
  const previous = resolutionChains.get(nodeId) ?? Promise.resolve()
  const next = previous.then(operation, operation)
  resolutionChains.set(nodeId, next.catch(() => {}))
  return next
}

/**
 * Adopts the server copy as the node's confirmed state (take-server): the
 * draft is replaced, pending work for the node is cancelled, and an
 * unresolved-outcome flag is cleared by the live read.
 */
export function adoptServerContent(nodeId: string, content: string, revision: number): void {
  const record = ensureRecord(nodeId)
  clearTaskTimer(nodeId)
  queuedTasks.get(nodeId)?.resolve({ status: 'cancelled' })
  queuedTasks.delete(nodeId)
  record.confirmedContent = content
  record.confirmedRevision = revision
  record.confirmedSeeded = true
  record.outcomeUncertain = false
  setNodeDraft(nodeId, content)
}

/** Retires the node's conflict when it is still this exact one. */
export function clearNodeConflictIf(nodeId: string, expected: ConflictedSave): boolean {
  const record = records.get(nodeId)
  if (!record || record.conflict !== expected) return false
  record.conflict = null
  return true
}

/** Swaps the node's conflict for a fresh copy when the original is intact. */
export function replaceNodeConflictIf(nodeId: string, expected: ConflictedSave, fresh: ConflictedSave): ConflictedSave | null {
  const record = records.get(nodeId)
  if (!record || record.conflict !== expected) return null
  record.conflict = { ...fresh }
  return record.conflict
}

/** The server copy of an open conflict can no longer be trusted. */
export function invalidateNodeConflict(nodeId: string): void {
  const record = records.get(nodeId)
  if (record?.conflict) {
    record.conflict = { ...record.conflict, serverVerified: false }
  }
}

export function resetSaveSessionForTests(): void {
  sessionId = 1
  taskCounter = 0
  requestCounter = 0
  deps = null
  sending = false
  records.clear()
  queuedTasks.clear()
  inFlightRequests.clear()
  inFlightTasks.clear()
  resolutionChains.clear()
}
