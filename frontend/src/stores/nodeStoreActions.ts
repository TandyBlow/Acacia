import * as nodeCache from '../services/nodeCache';
import { getDataAdapter, formatError, clearAdapterCache } from './nodeStoreAdapter';
import { clearTransientState } from './nodeStoreState';
import type { NodeStoreState, SaveConflict } from './nodeStoreState';
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

  async function saveActiveNodeContent(
    nodeId: string,
    content: string,
    options?: { force?: boolean; keepalive?: boolean; revision?: number },
  ): Promise<boolean> {
    // force lets a flushed save land after navigation already moved on.
    if (!options?.force && (!state.activeNode.value || state.activeNode.value.id !== nodeId)) {
      return false;
    }

    state.errorMessage.value = null;
    // A conflict recorded by an earlier save must not be mistaken for this
    // one: after this call, a non-null lastSaveConflict is always fresh.
    // Only THIS node's pending conflict retires — another node's open
    // conflict keeps waiting for its user.
    state.pendingSaveConflicts.delete(nodeId);
    state.lastSaveConflict.value = null;
    try {
      // The version this content was edited against; a mismatch answers 412
      // and the conflict handler below takes over (never a blind retry).
      let revision = options?.revision ?? nodeCache.getCachedRevision(nodeId);
      if (revision == null) {
        try {
          const context = await getDataAdapter().getNodeContext(nodeId);
          revision = context.nodeInfo?.revision;
          nodeCache.setCache(nodeId, context);
        } catch {
          // Proceed without a version; the server answers 428 and the
          // conflict path preserves the draft.
        }
      }
      const result = await getDataAdapter().updateNodeContent(nodeId, content, {
        keepalive: options?.keepalive,
        revision,
      });
      if (result?.revision != null) {
        nodeCache.updateCachedRevision(nodeId, result.revision);
      }
      if (state.activeNode.value?.id === nodeId) {
        state.activeNode.value = { ...state.activeNode.value, content };
      }
      nodeCache.updateCachedContent(nodeId, content);
      state.pendingSaveConflicts.delete(nodeId);
      state.lastSaveConflict.value = null;
      deps.triggerStyleCheck();
      return true;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 412 || status === 428) {
        // Version conflict: keep the draft that was being saved, pull the
        // server copy, and let the user choose keep-mine or take-server.
        const { serverContent, serverRevision, serverVerified } = await _captureConflict(nodeId);
        const conflict: SaveConflict = { nodeId, draftContent: content, serverContent, serverRevision, serverVerified };
        state.pendingSaveConflicts.set(nodeId, conflict);
        state.lastSaveConflict.value = conflict;
        console.error('[nodeStore] save conflict, autosave paused for node:', nodeId, status);
        return false;
      }
      state.errorMessage.value = formatError(error);
      console.error('[nodeStore] saveActiveNodeContent failed:', nodeId, error);
      return false;
    }
  }

  async function _captureConflict(nodeId: string) {
    try {
      const context = await getDataAdapter().getNodeContext(nodeId);
      nodeCache.setCache(nodeId, context);
      return {
        serverContent: context.nodeInfo?.content ?? '',
        serverRevision: context.nodeInfo?.revision ?? 0,
        serverVerified: true,
      };
    } catch {
      // Surface the conflict with whatever the cache still holds — which may
      // predate the conflicting write. Verified stays false so taking the
      // "server copy" waits for a live re-read (refreshConflictCopy).
      const cached = nodeCache.getCached(nodeId);
      return {
        serverContent: cached?.nodeInfo?.content ?? '',
        serverRevision: cached?.nodeInfo?.revision ?? 0,
        serverVerified: false,
      };
    }
  }

  /**
   * Re-reads the server copy for an open conflict. Returns the fresh,
   * verified conflict copy — the caller must sync its own view of the
   * conflict, the store's update does not propagate. Resolves null without
   * touching anything when the node has no pending conflict, the read
   * fails, or the conflict was resolved or replaced while the read was in
   * flight: a late response then belongs to a settled state and must not
   * reach the cache either, where an older revision could roll back newer
   * content. Per-node state is authoritative — another node's save
   * settling must not retire this node's pending conflict.
   */
  async function refreshConflictCopy(nodeId: string): Promise<SaveConflict | null> {
    const original = state.pendingSaveConflicts.get(nodeId);
    if (!original) return null;
    try {
      const context = await getDataAdapter().getNodeContext(nodeId);
      // Any save of this node that settled while this GET was in flight
      // retired the conflict (or a new capture replaced it): the response
      // is stale. Check the node's map entry captured at start, before the
      // cache write.
      if (state.pendingSaveConflicts.get(nodeId) !== original) return null;
      nodeCache.setCache(nodeId, context);
      const fresh: SaveConflict = {
        nodeId,
        draftContent: original.draftContent,
        serverContent: context.nodeInfo?.content ?? '',
        serverRevision: context.nodeInfo?.revision ?? 0,
        serverVerified: true,
      };
      state.pendingSaveConflicts.set(nodeId, fresh);
      if (state.lastSaveConflict.value === original) {
        state.lastSaveConflict.value = fresh;
      }
      return fresh;
    } catch (error) {
      console.error('[nodeStore] conflict copy re-read failed:', nodeId, error);
      return null;
    }
  }

  function resetAfterLogout(): void {
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
    saveActiveNodeContent,
    refreshConflictCopy,
    resetAfterLogout,
    confirmOperation,
  };
}
