import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { findTreeNode, collectTreeDescendantIds } from '../utils/treeUtils';
import * as nodeCache from '../services/nodeCache';
import type { DataAdapter, NodeRecord, TreeNode, ViewState, OfficialNodeSummary } from '../types/node';
import { ViewStates } from '../types/node';
import { i18n } from '../i18n';

import { usePageTransition } from '../composables/usePageTransition';
import { apiFetch, getToken } from '../utils/api';
import { useStyleStore } from './styleStore';
import { useAuthStore } from './authStore';

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return i18n.global.t('errors.unknown');
}

function _triggerStyleCheck(): void {
  const userId = useAuthStore().user?.id;
  if (userId) {
    useStyleStore().scheduleCheck(userId);
  }
}

let dataAdapter: DataAdapter | null = null;

export function setDataAdapter(adapter: DataAdapter): void {
  dataAdapter = adapter;
}

export function getDataAdapter(): DataAdapter {
  if (!dataAdapter) throw new Error('Data adapter not initialized');
  return dataAdapter;
}

export interface OfficialNode {
  id: string;
  name: string;
  visible: boolean;
  action: () => void;
}

export const useNodeStore = defineStore('node', () => {
  const { startTransition } = usePageTransition();

  const viewState = ref<ViewState>(ViewStates.DISPLAY);
  const activeNode = ref<NodeRecord | null>(null);
  const pathNodes = ref<NodeRecord[]>([]);
  const childNodes = ref<NodeRecord[]>([]);
  const treeNodes = ref<TreeNode[]>([]);

  // 待应用的节点上下文（在转换动画期间缓存）
  const pendingNodeContext = ref<{
    nodeInfo: NodeRecord | null;
    pathNodes: NodeRecord[];
    children: NodeRecord[];
  } | null>(null);

  const operationNode = ref<NodeRecord | null>(null);
  const operationHasChildren = ref(false);
  const pendingNodeName = ref('');
  const deleteWithChildren = ref(false);
  const moveTargetParentId = ref<string | null>(null);
  const blockedParentIds = ref<string[]>([]);

  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);

  // 账号是否有任何知识点（乐观默认为 true，加载后确定）
  const hasAnyNodes = ref(true);
  const isEmpty = computed(() => !hasAnyNodes.value);

  // 每日复习
  const dailyQuizVisible = ref(true);
  const dailyQuizDueCount = ref(0);

  // 内容型官方知识点（从后端获取）
  const officialNodeSummaries = ref<OfficialNodeSummary[]>([]);

  const isEditState = computed(
    () =>
      viewState.value === ViewStates.ADD ||
      viewState.value === ViewStates.MOVE ||
      viewState.value === ViewStates.DELETE,
  );

  const isTreeState = computed(() => viewState.value === ViewStates.TREE || viewState.value === ViewStates.MOVE);
  const isTreeOverviewState = computed(() => viewState.value === ViewStates.TREE_OVERVIEW);
  const isDailyQuizState = computed(() => viewState.value === ViewStates.DAILY_QUIZ);
  const isOfficialContentState = computed(() => viewState.value === ViewStates.OFFICIAL_CONTENT);
  const isConfirmState = computed(() => isEditState.value);

  const canConfirm = computed(() => {
    if (viewState.value === ViewStates.ADD) {
      return pendingNodeName.value.trim().length > 0;
    }
    if (viewState.value === ViewStates.DELETE) {
      return Boolean(operationNode.value);
    }
    if (viewState.value === ViewStates.MOVE) {
      if (!operationNode.value) {
        return false;
      }
      if (moveTargetParentId.value === operationNode.value.parentId) {
        return false;
      }
      if (!moveTargetParentId.value) {
        return true;
      }
      return !blockedParentIds.value.includes(moveTargetParentId.value);
    }
    return false;
  });

  const currentNodeId = computed(() => activeNode.value?.id ?? null);

  // 官方知识点列表
  const t = i18n.global.t.bind(i18n.global);
  const dailyQuizLabel = computed(() => {
    if (dailyQuizDueCount.value > 0) {
      return `${t('official.dailyQuiz')} (${dailyQuizDueCount.value})`;
    }
    return t('official.dailyQuiz');
  });

  const officialNodes = computed<OfficialNode[]>(() => {
    const items: OfficialNode[] = [
      {
        id: 'daily_quiz',
        name: dailyQuizLabel.value,
        visible: dailyQuizVisible.value,
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
    for (const n of officialNodeSummaries.value) {
      items.push({
        id: n.id,
        name: n.title,
        visible: true,
        action: () => startOfficialContent(n.id),
      });
    }
    return items;
  });

  function clearTransientState(): void {
    operationNode.value = null;
    operationHasChildren.value = false;
    pendingNodeName.value = '';
    deleteWithChildren.value = false;
    moveTargetParentId.value = null;
    blockedParentIds.value = [];
  }

  async function refreshTree(): Promise<void> {
    treeNodes.value = await dataAdapter!.getTree();
  }

  async function loadNode(nodeId: string | null, options?: { replace?: boolean; skipTransition?: boolean }): Promise<void> {
    if (options?.skipTransition) {
      const cached = nodeCache.getCached(nodeId);
      if (cached) {
        pendingNodeContext.value = cached;
        return;
      }
      isBusy.value = true;
      errorMessage.value = null;
      try {
        const context = await dataAdapter!.getNodeContext(nodeId);
        pendingNodeContext.value = context;
        nodeCache.setCache(nodeId, context);
      } catch (error) {
        errorMessage.value = formatError(error);
      } finally {
        isBusy.value = false;
      }
      return;
    }

    const cached = nodeCache.getCached(nodeId);
    if (cached) {
      pendingNodeContext.value = cached;
    }

    startTransition({ type: 'navigate', nodeId });
  }

  function applyPendingSharedData(): void {
    if (pendingNodeContext.value) {
      activeNode.value = pendingNodeContext.value.nodeInfo;
      pathNodes.value = pendingNodeContext.value.pathNodes;
      childNodes.value = pendingNodeContext.value.children;
      hasAnyNodes.value = !!(
        pendingNodeContext.value.nodeInfo ||
        pendingNodeContext.value.children.length > 0 ||
        pendingNodeContext.value.pathNodes.length > 0
      );
    }
  }

  function applyPendingData(): void {
    if (pendingNodeContext.value) {
      activeNode.value = pendingNodeContext.value.nodeInfo;
      pathNodes.value = pendingNodeContext.value.pathNodes;
      childNodes.value = pendingNodeContext.value.children;
      viewState.value = ViewStates.DISPLAY;
      clearTransientState();
      pendingNodeContext.value = null;
    }
  }

  async function initialize(): Promise<void> {
    await fetchOfficialNodes();
    await loadNode(null);
    setupVisibilityRefresh();
  }

  let visibilityBound = false;
  function setupVisibilityRefresh(): void {
    if (visibilityBound) return;
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        fetchOfficialNodes();
        if (officialNodeContent.value) {
          loadOfficialNodeContent(officialNodeContent.value.id);
        }
      }
    });
  }

  function setViewState(state: string): void {
    viewState.value = state as ViewState;
    clearTransientState();
  }

  function startAdd(): void {
    errorMessage.value = null;
    pendingNodeName.value = '';
    operationNode.value = null;
    deleteWithChildren.value = false;
    moveTargetParentId.value = null;
    blockedParentIds.value = [];

    const { startTransition } = usePageTransition();
    startTransition({ type: 'viewState', newState: 'add' });
  }

  async function startDelete(node: NodeRecord): Promise<void> {
    errorMessage.value = null;

    const { startTransition } = usePageTransition();
    startTransition({
      type: 'viewState',
      newState: 'delete',
      setup: async () => {
        operationNode.value = node;
        deleteWithChildren.value = false;
        await refreshTree();
        const hit = findTreeNode(treeNodes.value, node.id);
        operationHasChildren.value = Boolean(hit && hit.children.length > 0);
      },
    });
  }

  async function startMove(node: NodeRecord): Promise<void> {
    errorMessage.value = null;

    const { startTransition } = usePageTransition();
    startTransition({
      type: 'viewState',
      newState: 'move',
      setup: async () => {
        operationNode.value = node;
        moveTargetParentId.value = node.parentId;
        deleteWithChildren.value = false;
        await refreshTree();
        const hit = findTreeNode(treeNodes.value, node.id);
        const blocked = new Set<string>([node.id]);
        collectTreeDescendantIds(hit, blocked);
        blockedParentIds.value = Array.from(blocked);
      },
    });
  }

  function setMoveTargetParent(id: string | null): void {
    moveTargetParentId.value = id;
  }

  function cancelOperation(): void {
    clearTransientState();

    const { startTransition } = usePageTransition();
    startTransition({ type: 'viewState', newState: 'display' });
  }

  function startDailyQuiz(): void {
    errorMessage.value = null;

    const { startTransition } = usePageTransition();
    startTransition({ type: 'viewState', newState: 'daily_quiz' });
  }

  function startTreeOverview(): void {
    errorMessage.value = null;

    const { startTransition } = usePageTransition();
    startTransition({
      type: 'viewState',
      newState: 'tree_overview',
      setup: async () => {
        await refreshTree();
      },
    });
  }

  function getLocale(): string {
    return localStorage.getItem('acacia_locale') || 'zh-CN';
  }

  async function fetchOfficialNodes(): Promise<void> {
    try {
      officialNodeSummaries.value = await apiFetch<OfficialNodeSummary[]>(`/official-nodes?locale=${getLocale()}`);
    } catch (e) {
      console.error('[nodeStore] fetchOfficialNodes failed:', e);
      officialNodeSummaries.value = [];
    }
  }

  function startOfficialContent(nodeId: string): void {
    errorMessage.value = null;

    const { startTransition } = usePageTransition();
    startTransition({
      type: 'viewState',
      newState: 'official_content',
      setup: async () => {
        await Promise.all([loadOfficialNodeContent(nodeId), fetchOfficialNodes()]);
      },
    });
  }

  const officialNodeContent = ref<{ id: string; title: string; content: string } | null>(null);

  async function loadOfficialNodeContent(nodeId: string): Promise<void> {
    try {
      officialNodeContent.value = await apiFetch<{ id: string; title: string; content: string }>(`/official-nodes/${nodeId}?locale=${getLocale()}`);
    } catch (e) {
      console.error('[nodeStore] loadOfficialNodeContent failed:', e);
      officialNodeContent.value = null;
    }
  }

  function clearOfficialContent(): void {
    officialNodeContent.value = null;
  }

  async function checkDailyQuizStatus(): Promise<void> {
    try {
      const token = getToken();
      if (!token) return;
      const backendUrl = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:7860';
      const res = await fetch(`${backendUrl}/daily-quiz/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        dailyQuizDueCount.value = data.due_count ?? 0;
      }
    } catch (e) {
      console.error('[nodeStore] checkDailyQuizStatus failed:', e);
      dailyQuizDueCount.value = 0;
    }
  }

  function resetAfterLogout(): void {
    activeNode.value = null;
    pathNodes.value = [];
    childNodes.value = [];
    treeNodes.value = [];
    errorMessage.value = null;
    clearTransientState();
    dataAdapter?.clearCache?.();
    nodeCache.invalidateAll();
  }

  async function saveActiveNodeContent(nodeId: string, content: string): Promise<boolean> {
    if (!activeNode.value || activeNode.value.id !== nodeId) {
      return false;
    }

    errorMessage.value = null;
    try {
      await dataAdapter!.updateNodeContent(nodeId, content);
      if (activeNode.value?.id === nodeId) {
        activeNode.value = { ...activeNode.value, content };
      }
      _triggerStyleCheck();
      return true;
    } catch (error) {
      errorMessage.value = formatError(error);
      return false;
    }
  }

  async function onKnobClick(): Promise<void> {
    if (viewState.value === ViewStates.DAILY_QUIZ || viewState.value === ViewStates.TREE_OVERVIEW || viewState.value === ViewStates.OFFICIAL_CONTENT) {
      cancelOperation();
      return;
    }
    if (viewState.value === ViewStates.DISPLAY || viewState.value === ViewStates.ADD) {
      if (viewState.value === ViewStates.ADD) {
        clearTransientState();
        await loadNode(null, { skipTransition: true });
      }
      await loadNode(null);
      return;
    }
    cancelOperation();
  }

  async function confirmOperation(): Promise<void> {
    if (!canConfirm.value) {
      return;
    }

    isBusy.value = true;
    errorMessage.value = null;
    try {
      if (viewState.value === ViewStates.ADD) {
        const created = await dataAdapter!.createNode(
          currentNodeId.value,
          pendingNodeName.value.trim(),
        );
        nodeCache.invalidate(currentNodeId.value);
        await loadNode(created.id);
        _triggerStyleCheck();
        return;
      }

      if (viewState.value === ViewStates.DELETE && operationNode.value) {
        await dataAdapter!.deleteNode(operationNode.value.id, deleteWithChildren.value);
        nodeCache.invalidate(currentNodeId.value);
        nodeCache.invalidate(operationNode.value.parentId);
        const reloadId = currentNodeId.value;
        await loadNode(reloadId, { replace: true });
        _triggerStyleCheck();
        return;
      }

      if (viewState.value === ViewStates.MOVE && operationNode.value) {
        const movingId = operationNode.value.id;
        await dataAdapter!.moveNode(movingId, moveTargetParentId.value);
        nodeCache.invalidate(moveTargetParentId.value);
        nodeCache.invalidate(operationNode.value.parentId);
        await loadNode(movingId);
        return;
      }
    } catch (error) {
      errorMessage.value = formatError(error);
    } finally {
      isBusy.value = false;
    }
  }

  return {
    viewState,
    activeNode,
    pathNodes,
    childNodes,
    treeNodes,
    operationNode,
    operationHasChildren,
    pendingNodeName,
    deleteWithChildren,
    moveTargetParentId,
    blockedParentIds,
    isBusy,
    errorMessage,
    isEditState,
    isTreeState,
    isTreeOverviewState,
    isDailyQuizState,
    isOfficialContentState,
    isConfirmState,
    isEmpty,
    canConfirm,
    currentNodeId,
    dailyQuizVisible,
    dailyQuizDueCount,
    officialNodes,
    officialNodeContent,
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
    saveActiveNodeContent,
    refreshTree,
    resetAfterLogout,
    onKnobClick,
    confirmOperation,
  };
});
