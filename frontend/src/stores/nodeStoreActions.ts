import * as nodeCache from '../services/nodeCache';
import { getDataAdapter, formatError, clearAdapterCache } from './nodeStoreAdapter';
import { clearTransientState } from './nodeStoreState';
import type { NodeStoreState } from './nodeStoreState';
import { currentSessionId, endSaveSession, getNodeConflict, replaceNodeConflictIf } from '../services/saveSession';
import type { ConflictedSave, ResolvedRevision, SaveConflict, SaveWriteResult } from '../services/saveSession';
import { computeHasAnyNodes, computeIsEditState } from './nodeStoreHelpers';
import { ViewStates } from '../types/node';
import type { TransitionTrigger } from '../types/transition';

export interface NodeStoreActionDeps {
  startTransition: (trigger: TransitionTrigger) => Promise<void>;
  canConfirm: () => boolean;
  triggerStyleCheck: () => void;
}

export function createNodeStoreActions(
  state: NodeStoreState,
  deps: NodeStoreActionDeps,
) {
  async function refreshTree(): Promise<void> {
    state.treeNodes.value = await getDataAdapter().getTree();
  }

  async function loadNode(nodeId: string | null, options?: { replace?: boolean; skipTransition?: boolean }): Promise<void> {
    if (options?.skipTransition) {
      const cached = nodeCache.getCached(nodeId);
      if (cached) {
        state.pendingNodeContext.value = cached;
        return;
      }
      state.isBusy.value = true;
      state.errorMessage.value = null;
      try {
        const context = await getDataAdapter().getNodeContext(nodeId);
        state.pendingNodeContext.value = context;
        nodeCache.setCache(nodeId, context);
      } catch (error) {
        state.errorMessage.value = formatError(error);
      } finally {
        state.isBusy.value = false;
      }
      return;
    }

    const cached = nodeCache.getCached(nodeId);
    if (cached) {
      state.pendingNodeContext.value = cached;
    }

    deps.startTransition({ type: 'navigate', nodeId });
  }

  function applyPendingSharedData(): void {
    if (state.pendingNodeContext.value) {
      state.activeNode.value = state.pendingNodeContext.value.nodeInfo;
      state.pathNodes.value = state.pendingNodeContext.value.pathNodes;
      state.childNodes.value = state.pendingNodeContext.value.children;
      state.hasAnyNodes.value = computeHasAnyNodes(
        state.pendingNodeContext.value.nodeInfo,
        state.pendingNodeContext.value.children,
        state.pendingNodeContext.value.pathNodes,
      );
    }
  }

  function applyPendingData(): void {
    if (state.pendingNodeContext.value) {
      state.activeNode.value = state.pendingNodeContext.value.nodeInfo;
      state.pathNodes.value = state.pendingNodeContext.value.pathNodes;
      state.childNodes.value = state.pendingNodeContext.value.children;
      state.viewState.value = ViewStates.DISPLAY;
      clearTransientState(state);
      state.pendingNodeContext.value = null;
    }
  }

  async function refreshCurrentNode(): Promise<void> {
    const currentNodeId = state.activeNode.value?.id ?? null;
    if (!state.activeNode.value || !currentNodeId) return;
    const view = state.viewState.value;
    if (
      computeIsEditState(view) ||
      view === ViewStates.DAILY_QUIZ ||
      view === ViewStates.OFFICIAL_CONTENT ||
      view === ViewStates.TREE_OVERVIEW
    ) {
      return;
    }
    nodeCache.invalidate(currentNodeId);
    try {
      const context = await getDataAdapter().getNodeContext(currentNodeId);
      nodeCache.setCache(currentNodeId, context);
      state.activeNode.value = context.nodeInfo;
      state.pathNodes.value = context.pathNodes;
      state.childNodes.value = context.children;
      state.hasAnyNodes.value = computeHasAnyNodes(context.nodeInfo, context.children, context.pathNodes);
    } catch {
      // Silently keep stale data if refresh fails
    }
  }

  /**
   * Re-reads the server copy for an open conflict. Returns the fresh,
   * verified copy for the caller (the registry stores it and the editor
   * view derives from it). Resolves null without touching anything when
   * the node has no pending conflict, the read fails, the session ended,
   * or the conflict was resolved or replaced while the read was in flight:
   * a late response then belongs to a settled state and must not reach the
   * cache either, where an older revision could roll back newer content.
   * The registry's record is authoritative — another node's save settling
   * must not retire this node's pending conflict.
   */
  async function refreshConflictCopy(nodeId: string): Promise<SaveConflict | null> {
    const original = getNodeConflict(nodeId);
    if (!original) return null;
    const sessionAtStart = currentSessionId();
    try {
      const context = await getDataAdapter().getNodeContext(nodeId);
      if (!context) return null;
      if (currentSessionId() !== sessionAtStart) return null;
      if (getNodeConflict(nodeId) !== original) return null;
      nodeCache.setCache(nodeId, context);
      // The re-read refreshes the server fields; the draft snapshot, its
      // validation verdict, and the stable conflict id stay as captured.
      const fresh: ConflictedSave = {
        nodeId,
        draftContent: original.draftContent,
        serverContent: context.nodeInfo?.content ?? '',
        serverRevision: context.nodeInfo?.revision ?? 0,
        serverVerified: true,
        draftValidated: original.draftValidated,
        conflictId: original.conflictId,
      };
      return replaceNodeConflictIf(nodeId, original, fresh);
    } catch (error) {
      console.error('[nodeStore] conflict copy re-read failed:', nodeId, error);
      return null;
    }
  }

  /**
   * One structured write against the network. The expected revision is
   * passed in by the save session — frozen on the task at first dispatch,
   * so a retry re-sends the version its content was edited against instead
   * of picking up a newer cache revision and defeating the version check.
   * Every await is followed by a session check: a response landing after
   * logout belongs to a dead state and must not touch the cache or the
   * active node.
   */
  async function saveNodeContent(
    nodeId: string,
    content: string,
    options?: { keepalive?: boolean; expectedRevision?: number | null },
  ): Promise<SaveWriteResult> {
    const sessionAtStart = currentSessionId();
    state.errorMessage.value = null;
    try {
      const result = await getDataAdapter().updateNodeContent(nodeId, content, {
        keepalive: options?.keepalive,
        revision: options?.expectedRevision ?? undefined,
      });
      if (currentSessionId() !== sessionAtStart) return { ok: false, kind: 'error' };
      if (result?.revision != null) {
        nodeCache.updateCachedRevision(nodeId, result.revision);
      }
      if (state.activeNode.value?.id === nodeId) {
        state.activeNode.value = { ...state.activeNode.value, content };
      }
      nodeCache.updateCachedContent(nodeId, content);
      deps.triggerStyleCheck();
      return { ok: true, revision: result?.revision ?? null };
    } catch (error) {
      if (currentSessionId() !== sessionAtStart) return { ok: false, kind: 'error' };
      const status = (error as { status?: number }).status;
      if (status === 412 || status === 428) {
        // Version conflict: the caller (save session) records it and the
        // user decides. The server copy is read here — a live read wins; a
        // failed one falls back to the cache flagged unverified.
        const captured = await _captureConflictCopy(nodeId, sessionAtStart);
        if (!captured) return { ok: false, kind: 'error' };
        return {
          ok: false,
          kind: 'conflict',
          conflict: { nodeId, draftContent: content, ...captured },
        };
      }
      state.errorMessage.value = formatError(error);
      console.error('[nodeStore] saveNodeContent failed:', nodeId, error);
      return { ok: false, kind: 'error' };
    }
  }

  async function _captureConflictCopy(
    nodeId: string,
    sessionAtStart: number,
  ): Promise<{ serverContent: string; serverRevision: number; serverVerified: boolean } | null> {
    try {
      const context = await getDataAdapter().getNodeContext(nodeId);
      if (!context) throw new Error('empty node context');
      if (currentSessionId() !== sessionAtStart) return null;
      nodeCache.setCache(nodeId, context);
      return {
        serverContent: context.nodeInfo?.content ?? '',
        serverRevision: context.nodeInfo?.revision ?? 0,
        serverVerified: true,
      };
    } catch {
      const cached = nodeCache.getCached(nodeId);
      return {
        serverContent: cached?.nodeInfo?.content ?? '',
        serverRevision: cached?.nodeInfo?.revision ?? 0,
        serverVerified: false,
      };
    }
  }

  /**
   * Resolves the write base for a task whose record never knew a version:
   * the cache first, one prefetch GET when it is empty. Returns the live
   * server CONTENT too, so the save session can tell when the server moved
   * past the text the draft was loaded from. The caller freezes the value
   * on the task; retries reuse it.
   */
  async function resolveNodeRevision(nodeId: string): Promise<ResolvedRevision | null> {
    const cachedRevision = nodeCache.getCachedRevision(nodeId);
    if (cachedRevision != null) {
      return { revision: cachedRevision, content: nodeCache.getCached(nodeId)?.nodeInfo?.content };
    }
    const sessionAtStart = currentSessionId();
    try {
      const context = await getDataAdapter().getNodeContext(nodeId);
      if (!context) return null;
      if (currentSessionId() !== sessionAtStart) return null;
      nodeCache.setCache(nodeId, context);
      return { revision: context.nodeInfo?.revision ?? null, content: context.nodeInfo?.content ?? '' };
    } catch {
      return null;
    }
  }

  /**
   * A plain, session-guarded read of the node's server truth: used after a
   * raced write has settled an open conflict by writing itself, so the
   * adoption can sync the draft to what the server actually holds.
   */
  async function readNodeContent(nodeId: string): Promise<{ content: string; revision: number } | null> {
    const sessionAtStart = currentSessionId();
    try {
      const context = await getDataAdapter().getNodeContext(nodeId);
      if (!context) return null;
      if (currentSessionId() !== sessionAtStart) return null;
      nodeCache.setCache(nodeId, context);
      return {
        content: context.nodeInfo?.content ?? '',
        revision: context.nodeInfo?.revision ?? 0,
      };
    } catch {
      return null;
    }
  }

  function resetAfterLogout(): void {
    // End the save session first: late responses of this session are then
    // recognized and dropped instead of writing into the next one.
    endSaveSession();
    state.activeNode.value = null;
    state.pathNodes.value = [];
    state.childNodes.value = [];
    state.treeNodes.value = [];
    state.errorMessage.value = null;
    clearTransientState(state);
    clearAdapterCache();
    nodeCache.invalidateAll();
  }

  async function confirmOperation(): Promise<void> {
    if (!deps.canConfirm()) {
      return;
    }

    const currentNodeId = state.activeNode.value?.id ?? null;
    state.isBusy.value = true;
    state.errorMessage.value = null;
    try {
      if (state.viewState.value === ViewStates.ADD) {
        const created = await getDataAdapter().createNode(currentNodeId, state.pendingNodeName.value.trim());
        nodeCache.invalidate(currentNodeId);
        await loadNode(created.id);
        deps.triggerStyleCheck();
        return;
      }

      if (state.viewState.value === ViewStates.DELETE && state.operationNode.value) {
        try {
          await getDataAdapter().deleteNode(state.operationNode.value.id, state.deleteWithChildren.value);
        } catch (delErr) {
          const msg = formatError(delErr);
          if (msg.includes('Node not found') || msg.includes('404')) {
            nodeCache.invalidate(currentNodeId);
            nodeCache.invalidate(state.operationNode.value.parentId);
            await loadNode(currentNodeId, { replace: true });
            return;
          }
          throw delErr;
        }
        nodeCache.invalidate(currentNodeId);
        nodeCache.invalidate(state.operationNode.value.parentId);
        await loadNode(currentNodeId, { replace: true });
        deps.triggerStyleCheck();
        return;
      }

      if (state.viewState.value === ViewStates.MOVE && state.operationNode.value) {
        const movingId = state.operationNode.value.id;
        await getDataAdapter().moveNode(movingId, state.moveTargetParentId.value);
        nodeCache.invalidate(state.moveTargetParentId.value);
        nodeCache.invalidate(state.operationNode.value.parentId);
        await loadNode(movingId);
        return;
      }
    } catch (error) {
      state.errorMessage.value = formatError(error);
    } finally {
      state.isBusy.value = false;
    }
  }

  return {
    refreshTree,
    loadNode,
    applyPendingSharedData,
    applyPendingData,
    refreshCurrentNode,
    saveNodeContent,
    resolveNodeRevision,
    refreshConflictCopy,
    readNodeContent,
    resetAfterLogout,
    confirmOperation,
  };
}
