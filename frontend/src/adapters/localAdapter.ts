import {
  assertSiblingNameUnique,
  buildPath,
  buildTree,
  bySortOrder,
  cloneNode,
  collectDescendantIds,
  generateId,
  nextSortOrder,
  normalizeSiblingOrder,
} from '../utils/treeUtils';
import type { CoreDataAdapter, NodeContext, NodeRecord, TreeNode } from '../types/node';
import { LOCAL_NODES_KEY } from '../constants/app';
import { i18n } from '../i18n';

/** @deprecated Use adapter.clearCache() via the injected adapter instead. */
export function clearLocalNodeCache(): void {
  localStorage.removeItem(LOCAL_NODES_KEY);
}

const seedNodes: NodeRecord[] = [
  {
    id: 'n-cs',
    name: '计算机科学',
    content: '# 计算机科学\n\n计算机科学是研究计算与信息处理的学科，涵盖理论、硬件、软件等多个层面。\n\n## 核心领域\n\n- **算法与数据结构**：程序的灵魂\n- **编程语言**：与计算机对话的工具\n- **操作系统**：管理硬件资源的管家\n- **网络**：连接世界的桥梁',
    parentId: null,
    sortOrder: 0,
  },
  {
    id: 'n-algo',
    name: '算法',
    content: '# 算法\n\n算法是解决特定问题的有限步骤序列，是计算机科学的核心。\n\n## 算法复杂度\n\n衡量算法效率的两个维度：\n- **时间复杂度**：随输入规模增长，执行时间的变化\n- **空间复杂度**：随输入规模增长，内存占用的变化\n\n### 大O表示法\n- O(1)：常数时间\n- O(log n)：对数时间（如二分查找）\n- O(n)：线性时间（如遍历数组）\n- O(n log n)：线性对数时间（如归并排序）\n- O(n²)：平方时间（如冒泡排序）',
    parentId: 'n-cs',
    sortOrder: 0,
  },
  {
    id: 'n-sort',
    name: '排序算法',
    content: '# 排序算法\n\n排序是最基础也最重要的算法之一。\n\n## 常见排序算法\n\n| 算法 | 平均时间 | 最坏时间 | 空间 | 稳定性 |\n|------|---------|---------|------|--------|\n| 冒泡 | O(n²) | O(n²) | O(1) | 稳定 |\n| 选择 | O(n²) | O(n²) | O(1) | 不稳定 |\n| 插入 | O(n²) | O(n²) | O(1) | 稳定 |\n| 归并 | O(n log n) | O(n log n) | O(n) | 稳定 |\n| 快速 | O(n log n) | O(n²) | O(log n) | 不稳定 |\n\n## 快速排序\n\n核心思想是**分治法**：\n1. 选择一个基准元素（pivot）\n2. 将数组分为小于和大于基准的两部分\n3. 递归地对两部分排序',
    parentId: 'n-algo',
    sortOrder: 0,
  },
  {
    id: 'n-recur',
    name: '递归',
    content: '# 递归\n\n递归是一种通过函数调用自身来解决问题的方法。\n\n## 三要素\n\n1. **基线条件**：递归终止的条件\n2. **递归条件**：函数调用自身的条件\n3. **状态推进**：每次调用使问题向基线靠近\n\n## 经典示例：阶乘\n\n```python\ndef factorial(n):\n    if n == 0:        # 基线条件\n        return 1\n    return n * factorial(n - 1)  # 递归 + 推进\n```\n\n## 栈与溢出\n\n每次递归调用都会在调用栈上分配新的栈帧。如果缺少基线条件或递归深度过大，将导致**栈溢出**（Stack Overflow）。\n\n## 尾递归优化\n\n当递归调用是函数的最后一个操作时，编译器可以复用当前栈帧，避免栈溢出。',
    parentId: 'n-algo',
    sortOrder: 1,
  },
  {
    id: 'n-dp',
    name: '动态规划',
    content: '# 动态规划\n\n动态规划（DP）是一种通过将问题分解为重叠子问题来优化递归的方法。\n\n## 核心思想\n\n1. **最优子结构**：问题的最优解包含子问题的最优解\n2. **重叠子问题**：相同的子问题被多次计算\n3. **状态转移方程**：描述子问题间的关系\n\n## 经典示例：斐波那契\n\n```python\ndef fib(n):\n    if n <= 1:\n        return n\n    dp = [0] * (n + 1)\n    dp[1] = 1\n    for i in range(2, n + 1):\n        dp[i] = dp[i-1] + dp[i-2]\n    return dp[n]\n```\n\nDP 将指数级复杂度降为 O(n)。',
    parentId: 'n-algo',
    sortOrder: 2,
  },
  {
    id: 'n-ds',
    name: '数据结构',
    content: '# 数据结构\n\n数据结构是组织和存储数据的方式，决定了数据的访问和修改效率。\n\n## 基础结构\n\n- **数组**：连续内存，O(1) 随机访问\n- **链表**：通过指针连接，O(1) 插入删除\n- **栈**：后进先出（LIFO）\n- **队列**：先进先出（FIFO）\n- **哈希表**：O(1) 平均查找\n- **树**：层次化存储，二分查找树 O(log n)\n- **图**：节点与边的网络，路径搜索',
    parentId: 'n-cs',
    sortOrder: 1,
  },
  {
    id: 'n-tree-ds',
    name: '树',
    content: '# 树\n\n树是一种层次化的非线性数据结构。\n\n## 术语\n\n- **根节点**：树的顶层节点\n- **父/子节点**：上层节点是父，下层是子\n- **叶节点**：没有子节点的节点\n- **深度**：从根到节点的路径长度\n- **高度**：从节点到最深叶的路径长度\n\n## 二叉树\n\n每个节点最多有两个子节点。\n\n### 遍历方式\n- **前序**：根 → 左 → 右\n- **中序**：左 → 根 → 右  \n- **后序**：左 → 右 → 根\n- **层序**：逐层从上到下',
    parentId: 'n-ds',
    sortOrder: 0,
  },
  {
    id: 'n-bst',
    name: '二叉搜索树',
    content: '# 二叉搜索树（BST）\n\nBST 满足：左子树所有值 < 根节点值 < 右子树所有值。\n\n## 操作复杂度\n\n| 操作 | 平均 | 最坏 |\n|------|------|------|\n| 查找 | O(log n) | O(n) |\n| 插入 | O(log n) | O(n) |\n| 删除 | O(log n) | O(n) |\n\n最坏情况发生在树退化为链表时。平衡树（如AVL、红黑树）可以保证 O(log n)。',
    parentId: 'n-tree-ds',
    sortOrder: 0,
  },
  {
    id: 'n-math',
    name: '数学',
    content: '# 数学\n\n数学是科学的语言，也是计算机科学的理论基础。\n\n## 在计算机科学中的应用\n\n- **离散数学**：逻辑、集合、图论——程序的基础\n- **线性代数**：矩阵运算——机器学习的核心\n- **概率论**：不确定性推理——AI 的根基\n- **微积分**：优化——梯度下降的数学原理',
    parentId: null,
    sortOrder: 1,
  },
  {
    id: 'n-la',
    name: '线性代数',
    content: '# 线性代数\n\n线性代数研究向量空间和线性变换。\n\n## 核心概念\n\n- **向量**：有大小和方向的量\n- **矩阵**：二维数组，表示线性变换\n- **特征值与特征向量**：变换不变的方向\n\n## 在AI中的应用\n\n神经网络的每一层本质上就是一次矩阵乘法加偏置：\n```\ny = Wx + b\n```\n其中 W 是权重矩阵，x 是输入向量，b 是偏置。',
    parentId: 'n-math',
    sortOrder: 0,
  },
  {
    id: 'n-prob',
    name: '概率论',
    content: '# 概率论\n\n概率论是研究随机现象规律的数学分支。\n\n## 基础概念\n\n- **随机变量**：取值为随机试验结果的变量\n- **概率分布**：随机变量各取值的概率\n- **期望**：随机变量的平均值\n- **方差**：随机变量的离散程度\n\n## 贝叶斯定理\n\n$$P(A|B) = \\frac{P(B|A) \\cdot P(A)}{P(B)}$$\n\n后验概率正比于似然 × 先验概率。',
    parentId: 'n-math',
    sortOrder: 1,
  },
  {
    id: 'n-lit',
    name: '文学',
    content: '# 文学\n\n文学是以语言为媒介表达思想与情感的艺术形式。\n\n## 体裁\n\n- **诗歌**：凝练的语言，节奏与意象\n- **小说**：叙事艺术，人物与情节\n- **散文**：自由表达，形散神聚\n- **戏剧**：对话与冲突，舞台艺术',
    parentId: null,
    sortOrder: 2,
  },
  {
    id: 'n-poetry',
    name: '现代诗歌',
    content: '# 现代诗歌\n\n现代诗打破古典格律的束缚，追求自由的表达形式。\n\n## 特点\n\n- 自由韵律，不严格押韵\n- 意象丰富，留白多\n- 语言精炼，意在言外\n- 注重个人体验与瞬间感受\n\n## 代表作\n\n> 黑夜给了我黑色的眼睛\n> 我却用它寻找光明\n> —— 顾城《一代人》',
    parentId: 'n-lit',
    sortOrder: 0,
  },
];

function readLocalNodes(): NodeRecord[] {
  const raw = localStorage.getItem(LOCAL_NODES_KEY);
  if (!raw) {
    localStorage.setItem(LOCAL_NODES_KEY, JSON.stringify(seedNodes));
    return seedNodes.map(cloneNode);
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
        .map((item, index) => ({
          id: String(item.id),
          name: String(item.name),
          content: typeof item.content === 'string' ? item.content : '',
          parentId: item.parentId ? String(item.parentId) : null,
          sortOrder: Number.isFinite(item.sortOrder) ? Number(item.sortOrder) : index,
        }));
    }
  } catch (e) {
    console.error('[localAdapter] parse local nodes failed, using seed data:', e);
    // fallback to seed below
  }

  localStorage.setItem(LOCAL_NODES_KEY, JSON.stringify(seedNodes));
  return seedNodes.map(cloneNode);
}

function writeLocalNodes(nodes: NodeRecord[]): void {
  localStorage.setItem(LOCAL_NODES_KEY, JSON.stringify(nodes));
}

export const localAdapter: CoreDataAdapter = {
  async getNodeContext(nodeId: string | null): Promise<NodeContext> {
    const nodes = readLocalNodes();
    if (!nodeId) {
      return {
        nodeInfo: null,
        pathNodes: [],
        children: nodes.filter((node) => node.parentId === null).sort(bySortOrder).map(cloneNode),
      };
    }

    const current = nodes.find((node) => node.id === nodeId) ?? null;
    if (!current) {
      return {
        nodeInfo: null,
        pathNodes: [],
        children: nodes.filter((node) => node.parentId === null).sort(bySortOrder).map(cloneNode),
      };
    }

    return {
      nodeInfo: cloneNode(current),
      pathNodes: buildPath(nodes, current.id),
      children: nodes.filter((node) => node.parentId === current.id).sort(bySortOrder).map(cloneNode),
    };
  },

  async createNode(parentId: string | null, name: string): Promise<NodeRecord> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error(i18n.global.t('errors.nodeNameEmpty'));
    }

    const nodes = readLocalNodes();
    assertSiblingNameUnique(nodes, parentId, trimmedName);

    const newNode: NodeRecord = {
      id: generateId(),
      name: trimmedName,
      content: '',
      parentId,
      sortOrder: nextSortOrder(nodes, parentId),
    };

    nodes.push(newNode);
    normalizeSiblingOrder(nodes, parentId);
    writeLocalNodes(nodes);
    return cloneNode(newNode);
  },

  async updateNodeContent(nodeId: string, content: string): Promise<void> {
    const nodes = readLocalNodes();
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) {
      throw new Error(i18n.global.t('errors.nodeNotFound'));
    }
    node.content = content;
    writeLocalNodes(nodes);
  },

  async deleteNode(nodeId: string, deleteChildren: boolean): Promise<void> {
    const nodes = readLocalNodes();
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) {
      throw new Error(i18n.global.t('errors.nodeNotFound'));
    }

    if (deleteChildren) {
      const removeIds = new Set<string>([nodeId]);
      collectDescendantIds(nodes, nodeId, removeIds);
      const remaining = nodes.filter((node) => !removeIds.has(node.id));
      normalizeSiblingOrder(remaining, target.parentId);
      writeLocalNodes(remaining);
      return;
    }

    const parentId = target.parentId;
    const directChildren = nodes.filter((node) => node.parentId === nodeId).sort(bySortOrder);
    let nextOrder = nextSortOrder(nodes, parentId, nodeId);
    directChildren.forEach((child) => {
      child.parentId = parentId;
      child.sortOrder = nextOrder++;
    });

    const remaining = nodes.filter((node) => node.id !== nodeId);
    normalizeSiblingOrder(remaining, parentId);
    writeLocalNodes(remaining);
  },

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    const nodes = readLocalNodes();
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) {
      throw new Error(i18n.global.t('errors.nodeNotFound'));
    }

    if (target.parentId === newParentId) {
      return;
    }

    if (newParentId) {
      const parentExists = nodes.some((node) => node.id === newParentId);
      if (!parentExists) {
        throw new Error(i18n.global.t('errors.parentNotFound'));
      }
      const blocked = new Set<string>([nodeId]);
      collectDescendantIds(nodes, nodeId, blocked);
      if (blocked.has(newParentId)) {
        throw new Error(i18n.global.t('errors.cannotMoveToChild'));
      }
    }

    assertSiblingNameUnique(nodes, newParentId, target.name, target.id);

    const oldParentId = target.parentId;
    target.parentId = newParentId;
    target.sortOrder = nextSortOrder(nodes, newParentId, target.id);

    normalizeSiblingOrder(nodes, oldParentId);
    normalizeSiblingOrder(nodes, newParentId);
    writeLocalNodes(nodes);
  },

  async getTree(): Promise<TreeNode[]> {
    const nodes = readLocalNodes();
    return buildTree(nodes, null);
  },

  clearCache(): void {
    clearLocalNodeCache();
  },
};
