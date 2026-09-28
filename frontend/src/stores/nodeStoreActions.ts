import * as nodeCache from '../services/nodeCache';
import { getDataAdapter, formatError, clearAdapterCache } from './nodeStoreAdapter';
import { clearTransientState } from './nodeStoreState';
import type { NodeStoreState } from './nodeStoreState';
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
    options?: { force?: boolean; keepalive?: boolean },
  ): Promise<boolean> {
    // force lets a flushed save land after navigation already moved on.
    if (!options?.force && (!state.activeNode.value || state.activeNode.value.id !== nodeId)) {
      return false;
    }

    state.errorMessage.value = null;
    try {
      await getDataAdapter().updateNodeContent(nodeId, content, { keepalive: options?.keepalive });
      if (state.activeNode.value?.id === nodeId) {
        state.activeNode.value = { ...state.activeNode.value, content };
      }
      nodeCache.updateCachedContent(nodeId, content);
      deps.triggerStyleCheck();
      return true;
    } catch (error) {
      state.errorMessage.value = formatError(error);
      console.error('[nodeStore] saveActiveNodeContent failed:', nodeId, error);
      return false;
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
    resetAfterLogout,
    confirmOperation,
  };
}
