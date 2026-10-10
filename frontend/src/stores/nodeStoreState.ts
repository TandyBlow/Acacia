import { ref } from 'vue';
import type { Ref } from 'vue';
import type { NodeRecord, TreeNode, ViewState, OfficialNodeSummary } from '../types/node';
import { ViewStates } from '../types/node';

export interface OfficialNodeContent {
  id: string;
  title: string;
  content: string;
}

export interface PendingNodeContext {
  nodeInfo: NodeRecord | null;
  pathNodes: NodeRecord[];
  children: NodeRecord[];
}

export interface SaveConflict {
  nodeId: string;
  /** The draft that was being saved when the conflict hit — NOT the
   * currently displayed draft, which may belong to another node by now. */
  draftContent: string;
  serverContent: string;
  serverRevision: number;
}

export interface NodeStoreState {
  viewState: Ref<ViewState>;
  activeNode: Ref<NodeRecord | null>;
  pathNodes: Ref<NodeRecord[]>;
  childNodes: Ref<NodeRecord[]>;
  treeNodes: Ref<TreeNode[]>;
  pendingNodeContext: Ref<PendingNodeContext | null>;
  operationNode: Ref<NodeRecord | null>;
  operationHasChildren: Ref<boolean>;
  pendingNodeName: Ref<string>;
  deleteWithChildren: Ref<boolean>;
  moveTargetParentId: Ref<string | null>;
  blockedParentIds: Ref<string[]>;
  isBusy: Ref<boolean>;
  errorMessage: Ref<string | null>;
  /** Set when a save was rejected with 412/428 — the server holds a newer version. */
  lastSaveConflict: Ref<SaveConflict | null>;
  hasAnyNodes: Ref<boolean>;
  dailyQuizVisible: Ref<boolean>;
  dailyQuizDueCount: Ref<number>;
  officialNodeSummaries: Ref<OfficialNodeSummary[]>;
  officialNodeContent: Ref<OfficialNodeContent | null>;
}

export function createNodeStoreState(): NodeStoreState {
  const viewState = ref<ViewState>(ViewStates.DISPLAY);
  const activeNode = ref<NodeRecord | null>(null);
  const pathNodes = ref<NodeRecord[]>([]);
  const childNodes = ref<NodeRecord[]>([]);
  const treeNodes = ref<TreeNode[]>([]);

  // 待应用的节点上下文（在转换动画期间缓存）
  const pendingNodeContext = ref<PendingNodeContext | null>(null);

  const operationNode = ref<NodeRecord | null>(null);
  const operationHasChildren = ref(false);
  const pendingNodeName = ref('');
  const deleteWithChildren = ref(false);
  const moveTargetParentId = ref<string | null>(null);
  const blockedParentIds = ref<string[]>([]);

  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);
  const lastSaveConflict = ref<SaveConflict | null>(null);

  // 账号是否有任何知识点（乐观默认为 true，加载后确定）
  const hasAnyNodes = ref(true);

  // 每日复习
  const dailyQuizVisible = ref(true);
  const dailyQuizDueCount = ref(0);

  // 内容型官方知识点（从后端获取）
  const officialNodeSummaries = ref<OfficialNodeSummary[]>([]);

  const officialNodeContent = ref<OfficialNodeContent | null>(null);

  return {
    viewState,
    activeNode,
    pathNodes,
    childNodes,
    treeNodes,
    pendingNodeContext,
    operationNode,
    operationHasChildren,
    pendingNodeName,
    deleteWithChildren,
    moveTargetParentId,
    blockedParentIds,
    isBusy,
    errorMessage,
    lastSaveConflict,
    hasAnyNodes,
    dailyQuizVisible,
    dailyQuizDueCount,
    officialNodeSummaries,
    officialNodeContent,
  };
}

export function clearTransientState(state: NodeStoreState): void {
  state.operationNode.value = null;
  state.operationHasChildren.value = false;
  state.pendingNodeName.value = '';
  state.deleteWithChildren.value = false;
  state.moveTargetParentId.value = null;
  state.blockedParentIds.value = [];
}
