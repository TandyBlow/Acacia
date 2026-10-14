import { computed } from 'vue';
import { defineStore } from 'pinia';
import { i18n } from '../i18n';
import { ViewStates } from '../types/node';
import { computeIsEditState, computeCanConfirm } from './nodeStoreHelpers';
import { createNodeStoreState } from './nodeStoreState';
import { createNodeStoreRemote } from './nodeStoreRemote';
import { createNodeStoreActions } from './nodeStoreActions';
import { createNodeStoreNavigation } from './nodeStoreNavigation';
import { usePageTransition } from '../composables/usePageTransition';
import { useStyleStore } from './styleStore';
import { useAuthStore } from './authStore';

export { setDataAdapter, getDataAdapter } from './nodeStoreAdapter';

export interface OfficialNode {
  id: string;
  name: string;
  visible: boolean;
  action: () => void;
}

function _triggerStyleCheck(): void {
  const userId = useAuthStore().user?.id;
  if (userId) {
    useStyleStore().scheduleCheck(userId);
  }
}

export const useNodeStore = defineStore('node', () => {
  const { startTransition } = usePageTransition();

  const state = createNodeStoreState();

  const isEmpty = computed(() => !state.hasAnyNodes.value);

  const isEditState = computed(() => computeIsEditState(state.viewState.value));

  const isTreeState = computed(() => state.viewState.value === ViewStates.TREE || state.viewState.value === ViewStates.MOVE);
  const isTreeOverviewState = computed(() => state.viewState.value === ViewStates.TREE_OVERVIEW);
  const isDailyQuizState = computed(() => state.viewState.value === ViewStates.DAILY_QUIZ);
  const isOfficialContentState = computed(() => state.viewState.value === ViewStates.OFFICIAL_CONTENT);
  const isConfirmState = computed(() => isEditState.value);

  const canConfirm = computed(() =>
    computeCanConfirm(
      state.viewState.value,
      state.pendingNodeName.value,
      state.operationNode.value,
      state.moveTargetParentId.value,
      state.blockedParentIds.value,
    ),
  );

  const currentNodeId = computed(() => state.activeNode.value?.id ?? null);

  // 官方知识点列表
  const t = i18n.global.t.bind(i18n.global);
  const dailyQuizLabel = computed(() => {
    if (state.dailyQuizDueCount.value > 0) {
      return `${t('official.dailyQuiz')} (${state.dailyQuizDueCount.value})`;
    }
    return t('official.dailyQuiz');
  });

  const officialNodes = computed<OfficialNode[]>(() => {
    const items: OfficialNode[] = [
      {
        id: 'daily_quiz',
        name: dailyQuizLabel.value,
        visible: state.dailyQuizVisible.value,
        action: () => startDailyQuiz(),
      },
      {
        id: 'tree_overview',
        name: t('official.treeOverview'),
        visible: true,
        action: () => startTreeOverview(),
      },
    ];
    // Append content-type official nodes from backend
    for (const n of state.officialNodeSummaries.value) {
      items.push({
        id: n.id,
        name: n.title,
        visible: true,
        action: () => startOfficialContent(n.id),
      });
    }
    return items;
  });

  const remote = createNodeStoreRemote(state);
  const { fetchOfficialNodes, loadOfficialNodeContent, checkDailyQuizStatus } = remote;

  const {
    refreshTree,
    loadNode,
    applyPendingSharedData,
    applyPendingData,
    refreshCurrentNode,
    saveNodeContent,
    resolveNodeRevision,
    refreshConflictCopy,
    resetAfterLogout,
    confirmOperation,
  } = createNodeStoreActions(state, {
    startTransition,
    canConfirm: () => canConfirm.value,
    triggerStyleCheck: _triggerStyleCheck,
  });

  const {
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
    onKnobClick,
    initialize,
  } = createNodeStoreNavigation(state, {
    loadNode,
    refreshTree,
    fetchOfficialNodes,
    loadOfficialNodeContent,
    refreshCurrentNode,
  });

  return {
    viewState: state.viewState,
    activeNode: state.activeNode,
    pathNodes: state.pathNodes,
    childNodes: state.childNodes,
    treeNodes: state.treeNodes,
    operationNode: state.operationNode,
    operationHasChildren: state.operationHasChildren,
    pendingNodeName: state.pendingNodeName,
    deleteWithChildren: state.deleteWithChildren,
    moveTargetParentId: state.moveTargetParentId,
    blockedParentIds: state.blockedParentIds,
    isBusy: state.isBusy,
    errorMessage: state.errorMessage,
    isEditState,
    isTreeState,
    isTreeOverviewState,
    isDailyQuizState,
    isOfficialContentState,
    isConfirmState,
    isEmpty,
    canConfirm,
    currentNodeId,
    dailyQuizVisible: state.dailyQuizVisible,
    dailyQuizDueCount: state.dailyQuizDueCount,
    officialNodes,
    officialNodeContent: state.officialNodeContent,
    fetchOfficialNodes,
    startOfficialContent,
    clearOfficialContent,
    initialize,
    loadNode,
    applyPendingData,
    applyPendingSharedData,
    setViewState,
    startAdd,
    startDelete,
    startMove,
    startDailyQuiz,
    startTreeOverview,
    checkDailyQuizStatus,
    setMoveTargetParent,
    cancelOperation,
    saveNodeContent,
    resolveNodeRevision,
    refreshConflictCopy,
    refreshTree,
    refreshCurrentNode,
    resetAfterLogout,
    onKnobClick,
    confirmOperation,
  };
});
