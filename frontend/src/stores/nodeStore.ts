import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { findTreeNode, collectTreeDescendantIds } from '../utils/treeUtils';
import * as nodeCache from '../services/nodeCache';
import type { DataAdapter, NodeRecord, TreeNode, ViewState } from '../types/node';
import { ViewStates } from '../types/node';
import { UI } from '../constants/uiStrings';
import { LAST_ACTIVE_NODE_KEY } from '../constants/app';
import { usePageTransition } from '../composables/usePageTransition';
import { getToken } from '../utils/api';

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return UI.errors.unknown;
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

  const isEditState = computed(
    () =>
      viewState.value === ViewStates.ADD ||
      viewState.value === ViewStates.MOVE ||
      viewState.value === ViewStates.DELETE,
  );

  const isTreeState = computed(() => viewState.value === ViewStates.TREE);
  const isDailyQuizState = computed(() => viewState.value === ViewStates.DAILY_QUIZ);
  const isWelcomeState = computed(() => viewState.value === ViewStates.WELCOME);
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
  const dailyQuizLabel = computed(() => {
    if (dailyQuizDueCount.value > 0) {
      return `${UI.official.dailyQuiz} (${dailyQuizDueCount.value})`;
    }
    return UI.official.dailyQuiz;
  });

  const officialNodes = computed<OfficialNode[]>(() => [
    {
      id: 'daily_quiz',
      name: dailyQuizLabel.value,
      visible: dailyQuizVisible.value,
      action: () => startDailyQuiz(),
    },
    {
      id: 'welcome',
      name: UI.official.welcome,
      visible: true,
      action: () => startWelcome(),
    },
  ]);

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

    startTransition({ type: 'navigate', nodeId }, 'large');
  }

  function applyPendingSharedData(): void {
    if (pendingNodeContext.value) {
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
      try {
        localStorage.setItem(LAST_ACTIVE_NODE_KEY, activeNode.value?.id ?? '');
      } catch { /* ignore */ }
    }
  }

  async function initialize(): Promise<void> {
    const lastNodeId = (() => {
      try { return localStorage.getItem(LAST_ACTIVE_NODE_KEY) || null; } catch { return null; }
    })();
    await loadNode(lastNodeId);
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
    startTransition({ type: 'viewState', newState: 'add' }, 'large');
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
    }, 'large');
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
    }, 'large');
  }

  function setMoveTargetParent(id: string | null): void {
    moveTargetParentId.value = id;
  }

  function cancelOperation(): void {
    clearTransientState();

    const { startTransition } = usePageTransition();
    startTransition({ type: 'viewState', newState: 'display' }, 'large');
  }

  function startDailyQuiz(): void {
    errorMessage.value = null;

    const { startTransition } = usePageTransition();
    startTransition({ type: 'viewState', newState: 'daily_quiz' }, 'large');
  }

  function startWelcome(): void {
    errorMessage.value = null;

    const { startTransition } = usePageTransition();
    startTransition({ type: 'viewState', newState: 'welcome' }, 'large');
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
    } catch {
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
    try { localStorage.removeItem(LAST_ACTIVE_NODE_KEY); } catch { /* ignore */ }
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
      return true;
    } catch (error) {
      errorMessage.value = formatError(error);
      return false;
    }
  }

  async function onKnobClick(): Promise<void> {
    if (viewState.value === ViewStates.DAILY_QUIZ || viewState.value === ViewStates.WELCOME) {
      cancelOperation();
      return;
    }
    if (viewState.value === ViewStates.DISPLAY || viewState.value === ViewStates.ADD) {
      if (viewState.value === ViewStates.ADD) clearTransientState();
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
        return;
      }

      if (viewState.value === ViewStates.DELETE && operationNode.value) {
        await dataAdapter!.deleteNode(operationNode.value.id, deleteWithChildren.value);
        nodeCache.invalidate(currentNodeId.value);
        nodeCache.invalidate(operationNode.value.parentId);
        const reloadId = currentNodeId.value;
        await loadNode(reloadId, { replace: true });
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
    isDailyQuizState,
    isWelcomeState,
    isConfirmState,
    isEmpty,
    canConfirm,
    currentNodeId,
    dailyQuizVisible,
    dailyQuizDueCount,
    officialNodes,
    initialize,
    loadNode,
    applyPendingData,
    applyPendingSharedData,
    setViewState,
    startAdd,
    startDelete,
    startMove,
    startDailyQuiz,
    startWelcome,
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
