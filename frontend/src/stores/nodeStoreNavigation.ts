import { findTreeNode } from '../utils/treeUtils';
import { buildBlockedParentIds } from './nodeStoreHelpers';
import { clearTransientState } from './nodeStoreState';
import type { NodeStoreState } from './nodeStoreState';
import type { NodeRecord, ViewState } from '../types/node';
import { ViewStates } from '../types/node';
import { usePageTransition } from '../composables/usePageTransition';

export interface NodeStoreNavDeps {
  loadNode(nodeId: string | null, options?: { replace?: boolean; skipTransition?: boolean }): Promise<void>;
  refreshTree(): Promise<void>;
  fetchOfficialNodes(): Promise<void>;
  loadOfficialNodeContent(nodeId: string): Promise<void>;
  refreshCurrentNode(): Promise<void>;
}

export interface NodeStoreNavigation {
  setViewState(state: string): void;
  startAdd(): void;
  startDelete(node: NodeRecord): Promise<void>;
  startMove(node: NodeRecord): Promise<void>;
  setMoveTargetParent(id: string | null): void;
  cancelOperation(): void;
  startDailyQuiz(): void;
  startTreeOverview(): void;
  startOfficialContent(nodeId: string): void;
  clearOfficialContent(): void;
  prepareRootNavigation(): Promise<boolean>;
  onKnobClick(): Promise<void>;
  initialize(): Promise<void>;
}

export function createNodeStoreNavigation(
  state: NodeStoreState,
  deps: NodeStoreNavDeps,
): NodeStoreNavigation {
  let visibilityBound = false;
  function setupVisibilityRefresh(): void {
    if (visibilityBound) return;
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        deps.fetchOfficialNodes();
        if (state.officialNodeContent.value) {
          deps.loadOfficialNodeContent(state.officialNodeContent.value.id);
        }
        deps.refreshCurrentNode();
      }
    });
  }

  async function initialize(): Promise<void> {
    await deps.fetchOfficialNodes();
    await deps.loadNode(null);
    setupVisibilityRefresh();
  }

  function setViewState(newState: string): void {
    state.viewState.value = newState as ViewState;
    clearTransientState(state);
  }

  function startAdd(): void {
    state.errorMessage.value = null;
    state.pendingNodeName.value = '';
    state.operationNode.value = null;
    state.deleteWithChildren.value = false;
    state.moveTargetParentId.value = null;
    state.blockedParentIds.value = [];

    const { startTransition } = usePageTransition();
    startTransition({ type: 'viewState', newState: 'add' });
  }

  async function startDelete(node: NodeRecord): Promise<void> {
    state.errorMessage.value = null;

    const { startTransition } = usePageTransition();
    startTransition({
      type: 'viewState',
      newState: 'delete',
      setup: async () => {
        state.operationNode.value = node;
        state.deleteWithChildren.value = false;
        await deps.refreshTree();
        const hit = findTreeNode(state.treeNodes.value, node.id);
        state.operationHasChildren.value = Boolean(hit && hit.children.length > 0);
      },
    });
  }

  async function startMove(node: NodeRecord): Promise<void> {
    state.errorMessage.value = null;

    const { startTransition } = usePageTransition();
    startTransition({
      type: 'viewState',
      newState: 'move',
      setup: async () => {
        state.operationNode.value = node;
        state.moveTargetParentId.value = node.parentId;
        state.deleteWithChildren.value = false;
        await deps.refreshTree();
        state.blockedParentIds.value = buildBlockedParentIds(state.treeNodes.value, node.id);
      },
    });
  }

  function setMoveTargetParent(id: string | null): void {
    state.moveTargetParentId.value = id;
  }

  function cancelOperation(): void {
    clearTransientState(state);

    const { startTransition } = usePageTransition();
    startTransition({ type: 'viewState', newState: 'display' });
  }

  function startDailyQuiz(): void {
    state.errorMessage.value = null;

    const { startTransition } = usePageTransition();
    startTransition({ type: 'viewState', newState: 'daily_quiz' });
  }

  function startTreeOverview(): void {
    state.errorMessage.value = null;

    const { startTransition } = usePageTransition();
    startTransition({
      type: 'viewState',
      newState: 'tree_overview',
      setup: async () => {
        await deps.refreshTree();
      },
    });
  }

  function startOfficialContent(nodeId: string): void {
    state.errorMessage.value = null;

    const { startTransition } = usePageTransition();
    startTransition({
      type: 'viewState',
      newState: 'official_content',
      setup: async () => {
        await Promise.all([deps.loadOfficialNodeContent(nodeId), deps.fetchOfficialNodes()]);
      },
    });
  }

  function clearOfficialContent(): void {
    state.officialNodeContent.value = null;
  }

  async function prepareRootNavigation(): Promise<boolean> {
    // Stage root data without starting a competing content transition. The
    // caller commits it together with the compact mode change.
    state.pendingNodeContext.value = null;
    state.errorMessage.value = null;
    await deps.loadNode(null, { skipTransition: true });
    return state.pendingNodeContext.value !== null;
  }

  async function onKnobClick(): Promise<void> {
    if (
      state.viewState.value === ViewStates.DAILY_QUIZ ||
      state.viewState.value === ViewStates.TREE_OVERVIEW ||
      state.viewState.value === ViewStates.OFFICIAL_CONTENT
    ) {
      cancelOperation();
      return;
    }
    if (state.viewState.value === ViewStates.DISPLAY || state.viewState.value === ViewStates.ADD) {
      if (state.viewState.value === ViewStates.ADD) {
        clearTransientState(state);
        await deps.loadNode(null, { skipTransition: true });
      }
      await deps.loadNode(null);
      return;
    }
    cancelOperation();
  }

  return {
    setViewState,
    startAdd,
    startDelete,
    startMove,
    setMoveTargetParent,
    cancelOperation,
    startDailyQuiz,
    startTreeOverview,
    startOfficialContent,
    clearOfficialContent,
    prepareRootNavigation,
    onKnobClick,
    initialize,
  };
}
