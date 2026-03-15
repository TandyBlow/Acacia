import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { dataAdapter } from '../services/dataAdapter';
import type { NodeRecord, TreeNode, ViewState } from '../types/node';

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return '发生了未知错误';
}

function findTreeNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const childHit = findTreeNode(node.children, id);
    if (childHit) {
      return childHit;
    }
  }
  return null;
}

function collectDescendantIds(node: TreeNode | null, result: Set<string>): void {
  if (!node) {
    return;
  }
  for (const child of node.children) {
    result.add(child.id);
    collectDescendantIds(child, result);
  }
}

export const useNodeStore = defineStore(
  'node',
  () => {
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
    const statusMessage = ref('已就绪');
    const errorMessage = ref<string | null>(null);

    const isEditState = computed(() =>
      viewState.value === 'add' || viewState.value === 'move' || viewState.value === 'delete',
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

    async function loadNode(nodeId: string | null): Promise<void> {
      isBusy.value = true;
      errorMessage.value = null;
      try {
        const context = await dataAdapter.getNodeContext(nodeId);
        activeNode.value = context.nodeInfo;
        pathNodes.value = context.pathNodes;
        childNodes.value = context.children;
        viewState.value = 'display';
        statusMessage.value = activeNode.value
          ? `当前查看：${activeNode.value.name}`
          : '当前位于主页';
        clearTransientState();
      } catch (error) {
        errorMessage.value = formatError(error);
      } finally {
        isBusy.value = false;
      }
    }

    async function initialize(): Promise<void> {
      await loadNode(null);
    }

    function startAdd(): void {
      errorMessage.value = null;
      viewState.value = 'add';
      pendingNodeName.value = '';
      operationNode.value = null;
      deleteWithChildren.value = false;
      moveTargetParentId.value = null;
      blockedParentIds.value = [];
      statusMessage.value = '进入添加节点状态';
    }

    async function startDelete(node: NodeRecord): Promise<void> {
      errorMessage.value = null;
      viewState.value = 'delete';
      operationNode.value = node;
      deleteWithChildren.value = false;
      statusMessage.value = `进入删除节点状态：${node.name}`;
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
      statusMessage.value = `进入移动节点状态：${node.name}`;

      await refreshTree();
      const hit = findTreeNode(treeNodes.value, node.id);
      const blocked = new Set<string>([node.id]);
      collectDescendantIds(hit, blocked);
      blockedParentIds.value = Array.from(blocked);
    }

    function setMoveTargetParent(id: string | null): void {
      moveTargetParentId.value = id;
    }

    function cancelOperation(): void {
      viewState.value = 'display';
      statusMessage.value = activeNode.value ? `当前查看：${activeNode.value.name}` : '当前位于主页';
      clearTransientState();
    }

    async function saveActiveNodeContent(content: string): Promise<void> {
      if (!activeNode.value) {
        return;
      }
      isBusy.value = true;
      errorMessage.value = null;
      try {
        await dataAdapter.updateNodeContent(activeNode.value.id, content);
        activeNode.value = { ...activeNode.value, content };
        statusMessage.value = `已保存：${activeNode.value.name}`;
      } catch (error) {
        errorMessage.value = formatError(error);
      } finally {
        isBusy.value = false;
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
          await loadNode(created.id);
          statusMessage.value = `已添加节点：${created.name}`;
          return;
        }

        if (viewState.value === 'delete' && operationNode.value) {
          const deletingName = operationNode.value.name;
          await dataAdapter.deleteNode(operationNode.value.id, deleteWithChildren.value);
          const reloadId = currentNodeId.value;
          await loadNode(reloadId);
          statusMessage.value = `已删除节点：${deletingName}`;
          return;
        }

        if (viewState.value === 'move' && operationNode.value) {
          const movingId = operationNode.value.id;
          const movingName = operationNode.value.name;
          await dataAdapter.moveNode(movingId, moveTargetParentId.value);
          await loadNode(movingId);
          statusMessage.value = `已移动节点：${movingName}`;
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
      statusMessage,
      errorMessage,
      isEditState,
      canConfirm,
      currentNodeId,
      initialize,
      loadNode,
      startAdd,
      startDelete,
      startMove,
      setMoveTargetParent,
      cancelOperation,
      saveActiveNodeContent,
      refreshTree,
      onKnobClick,
      confirmOperation,
    };
  }
);
