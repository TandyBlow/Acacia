import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { clearLocalNodeCache, dataAdapter } from '../adapters';
import { findTreeNode, collectTreeDescendantIds } from '../utils/treeUtils';
import * as nodeCache from '../services/nodeCache';
import type { NodeRecord, TreeNode, ViewState } from '../types/node';

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return '发生了未知错误';
}

let navigator: ((path: string, replace: boolean) => void) | null = null;
let getInitialNodeId: (() => string | null) | null = null;

export function setNavigator(
  nav: (path: string, replace: boolean) => void,
  getRouteId: () => string | null,
): void {
  navigator = nav;
  getInitialNodeId = getRouteId;
}

function navigate(path: string, replace = false): void {
  navigator?.(path, replace);
}

export const useNodeStore = defineStore('node', () => {
  const viewState = ref<ViewState>('display');
  const activeNode = ref<NodeRecord | null>(null);
  const pathNodes = ref<NodeRecord[]>([]);
  const childNodes = ref<NodeRecord[]>([]);
  const treeNodes = ref<TreeNode[]>([]);

  const operationNode = ref<NodeRecord | null>(null);
  const operationHasChildren = ref(false);
  const pendingNodeName = ref('');
  const deleteWithChildren = ref(false);
  const moveTargetParentId = ref<string | null>(null);
  const blockedParentIds = ref<string[]>([]);

  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);

  const isEditState = computed(
    () =>
      viewState.value === 'add' ||
      viewState.value === 'move' ||
      viewState.value === 'delete' ||
      viewState.value === 'logout',
  );

  const canConfirm = computed(() => {
    if (viewState.value === 'add') {
      return pendingNodeName.value.trim().length > 0;
    }
    if (viewState.value === 'delete') {
      return Boolean(operationNode.value);
    }
    if (viewState.value === 'move') {
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
    if (viewState.value === 'logout') {
      return true;
    }
    return false;
  });

  const currentNodeId = computed(() => activeNode.value?.id ?? null);

  function clearTransientState(): void {
    operationNode.value = null;
    operationHasChildren.value = false;
    pendingNodeName.value = '';
    deleteWithChildren.value = false;
    moveTargetParentId.value = null;
    blockedParentIds.value = [];
  }

  async function refreshTree(): Promise<void> {
    treeNodes.value = await dataAdapter.getTree();
  }

  let syncRouteFromLoad = false;

  async function loadNode(nodeId: string | null, options?: { replace?: boolean }): Promise<void> {
    const cached = nodeCache.getCached(nodeId);
    if (cached) {
      activeNode.value = cached.nodeInfo;
      pathNodes.value = cached.pathNodes;
      childNodes.value = cached.children;
      viewState.value = 'display';
      clearTransientState();

      syncRouteFromLoad = true;
      const targetPath = nodeId ? `/node/${nodeId}` : '/';
      navigate(targetPath, options?.replace ?? false);
      return;
    }

    isBusy.value = true;
    errorMessage.value = null;
    try {
      const context = await dataAdapter.getNodeContext(nodeId);
      activeNode.value = context.nodeInfo;
      pathNodes.value = context.pathNodes;
      childNodes.value = context.children;
      viewState.value = 'display';
      clearTransientState();

      nodeCache.setCache(nodeId, context);

      syncRouteFromLoad = true;
      const targetPath = nodeId ? `/node/${nodeId}` : '/';
      navigate(targetPath, options?.replace ?? false);
    } catch (error) {
      errorMessage.value = formatError(error);
    } finally {
      isBusy.value = false;
    }
  }

  async function syncFromRoute(nodeId: string | null): Promise<void> {
    if (syncRouteFromLoad) {
      syncRouteFromLoad = false;
      return;
    }
    const currentId = activeNode.value?.id ?? null;
    if (nodeId === currentId) {
      return;
    }
    await loadNode(nodeId);
    syncRouteFromLoad = false;
  }

  async function initialize(): Promise<void> {
    const routeNodeId = getInitialNodeId?.() ?? null;
    syncRouteFromLoad = true;
    await loadNode(routeNodeId);
    syncRouteFromLoad = false;
  }

  function startAdd(): void {
    errorMessage.value = null;
    viewState.value = 'add';
    pendingNodeName.value = '';
    operationNode.value = null;
    deleteWithChildren.value = false;
    moveTargetParentId.value = null;
    blockedParentIds.value = [];
  }

  function startLogout(): void {
    errorMessage.value = null;
    viewState.value = 'logout';
    clearTransientState();
  }

  async function startDelete(node: NodeRecord): Promise<void> {
    errorMessage.value = null;
    viewState.value = 'delete';
    operationNode.value = node;
    deleteWithChildren.value = false;
    await refreshTree();
    const hit = findTreeNode(treeNodes.value, node.id);
    operationHasChildren.value = Boolean(hit && hit.children.length > 0);
  }

  async function startMove(node: NodeRecord): Promise<void> {
    errorMessage.value = null;
    viewState.value = 'move';
    operationNode.value = node;
    moveTargetParentId.value = node.parentId;
    deleteWithChildren.value = false;

    await refreshTree();
    const hit = findTreeNode(treeNodes.value, node.id);
    const blocked = new Set<string>([node.id]);
    collectTreeDescendantIds(hit, blocked);
    blockedParentIds.value = Array.from(blocked);
  }

  function setMoveTargetParent(id: string | null): void {
    moveTargetParentId.value = id;
  }

  function cancelOperation(): void {
    viewState.value = 'display';
    clearTransientState();
  }

  function clearForLogout(): void {
    viewState.value = 'display';
    activeNode.value = null;
    pathNodes.value = [];
    childNodes.value = [];
    treeNodes.value = [];
    errorMessage.value = null;
    clearTransientState();
    clearLocalNodeCache();
    nodeCache.invalidateAll();
    navigate('/', true);
  }

  async function saveActiveNodeContent(nodeId: string, content: string): Promise<boolean> {
    if (!activeNode.value || activeNode.value.id !== nodeId) {
      return false;
    }

    errorMessage.value = null;
    try {
      await dataAdapter.updateNodeContent(nodeId, content);
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
    if (viewState.value === 'display') {
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
      if (viewState.value === 'add') {
        const created = await dataAdapter.createNode(
          currentNodeId.value,
          pendingNodeName.value.trim(),
        );
        nodeCache.invalidate(currentNodeId.value);
        await loadNode(created.id);
        return;
      }

      if (viewState.value === 'delete' && operationNode.value) {
        await dataAdapter.deleteNode(operationNode.value.id, deleteWithChildren.value);
        nodeCache.invalidate(currentNodeId.value);
        nodeCache.invalidate(operationNode.value.parentId);
        const reloadId = currentNodeId.value;
        await loadNode(reloadId, { replace: true });
        return;
      }

      if (viewState.value === 'move' && operationNode.value) {
        const movingId = operationNode.value.id;
        await dataAdapter.moveNode(movingId, moveTargetParentId.value);
        nodeCache.invalidate(moveTargetParentId.value);
        nodeCache.invalidate(operationNode.value.parentId);
        await loadNode(movingId);
        return;
      }

      if (viewState.value === 'logout') {
        // Logout is handled by Knob.vue (authStore.logout + clearForLogout).
        // This branch exists because confirmOperation is a shared dispatch path,
        // but logout confirmation flow is managed externally.
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
    canConfirm,
    currentNodeId,
    initialize,
    loadNode,
    startAdd,
    startLogout,
    startDelete,
    startMove,
    setMoveTargetParent,
    cancelOperation,
    saveActiveNodeContent,
    refreshTree,
    clearForLogout,
    syncFromRoute,
    onKnobClick,
    confirmOperation,
  };
});
