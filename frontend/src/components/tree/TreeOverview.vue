<template>
  <div ref="treeRef" class="tree-shell">
    <header class="header">
      <h2>{{ UI.tree.treeOverview }}</h2>
    </header>
    <p class="hint">拖拽知识点到目标父节点下即可移动，拖到顶部方框可移至根节点</p>

    <div ref="rootZoneRef" class="root-zone" data-sortable data-parent-id="">
      <span class="root-zone-hint">拖拽至此，移至根节点</span>
    </div>

    <div class="tree-scroll">
      <ul ref="rootListRef" class="tree-root" data-sortable data-parent-id="">
        <TreeNodeItem
          v-for="node in treeNodes"
          :key="node.id"
          :node="node"
          :depth="0"
          :expanded-ids="expandedIds"
          :selected-parent-id="null"
          :blocked-parent-ids="[]"
          @toggle="toggleExpand"
          @select="() => {}"
        />
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import Sortable from 'sortablejs';
import TreeNodeItem from './TreeNodeItem.vue';
import { useNodeStore, getDataAdapter } from '../../stores/nodeStore';
import { usePageTransition } from '../../composables/usePageTransition';
import type { TreeNode } from '../../types/node';
import { UI } from '../../constants/uiStrings';

const store = useNodeStore();
const { treeNodes } = storeToRefs(store);
const { registerRegion, unregisterRegion } = usePageTransition();
const treeRef = ref<HTMLElement | null>(null);
const rootZoneRef = ref<HTMLElement | null>(null);
const rootListRef = ref<HTMLElement | null>(null);
const expandedIds = ref<string[]>([]);

let sortables: Sortable[] = [];

function collectAllIds(nodes: TreeNode[], result: string[]): void {
  for (const node of nodes) {
    result.push(node.id);
    collectAllIds(node.children, result);
  }
}

function buildDescendantMap(nodes: TreeNode[], map: Map<string, Set<string>>): void {
  for (const node of nodes) {
    const arr: string[] = [];
    collectAllIds(node.children, arr);
    map.set(node.id, new Set(arr));
    buildDescendantMap(node.children, map);
  }
}

function toggleExpand(id: string): void {
  if (expandedIds.value.includes(id)) {
    expandedIds.value = expandedIds.value.filter((item) => item !== id);
    return;
  }
  expandedIds.value = [...expandedIds.value, id];
}

function destroySortables(): void {
  for (const s of sortables) {
    s.destroy();
  }
  sortables = [];
}

function initSortables(): void {
  destroySortables();

  const descendantMap = new Map<string, Set<string>>();
  buildDescendantMap(treeNodes.value, descendantMap);

  const handleDragMove = (evt: Sortable.MoveEvent): boolean => {
    const nodeId = (evt.dragged as HTMLElement).dataset.nodeId;
    const targetParentId = (evt.to as HTMLElement).dataset.parentId;
    if (!nodeId) return true;
    // Prevent dropping a node into its own descendant
    if (targetParentId) {
      const descendants = descendantMap.get(nodeId);
      if (descendants && descendants.has(targetParentId)) {
        return false;
      }
    }
    return true;
  };

  const handleDragEnd = async (evt: Sortable.SortableEvent): Promise<void> => {
    const nodeId = (evt.item as HTMLElement).dataset.nodeId;
    const newParentId = (evt.to as HTMLElement).dataset.parentId ?? null;
    const oldParentId = (evt.from as HTMLElement).dataset.parentId ?? null;

    if (!nodeId) return;

    // No change in parent — revert via tree refresh
    if (newParentId === oldParentId) {
      await store.refreshTree();
      return;
    }

    try {
      const adapter = getDataAdapter();
      await adapter.moveNode(nodeId, newParentId || null);
      await store.refreshTree();
    } catch {
      await store.refreshTree();
    }
  };

  const rootZone = rootZoneRef.value;
  if (rootZone) {
    sortables.push(new Sortable(rootZone, {
      group: {
        name: 'tree-nodes',
        pull: false,
        put: true,
      },
      animation: 150,
      onEnd: handleDragEnd,
      onMove: handleDragMove,
    }));
  }

  const lists = treeRef.value?.querySelectorAll<HTMLElement>('[data-sortable]:not(.root-zone)');
  lists?.forEach((list) => {
    sortables.push(new Sortable(list, {
      group: 'tree-nodes',
      animation: 150,
      sort: false,
      delay: 0,
      delayOnTouchOnly: true,
      touchStartThreshold: 3,
      filter: '.expand-btn',
      preventOnFilter: false,
      onEnd: handleDragEnd,
      onMove: handleDragMove,
    }));
  });
}

watch(
  treeNodes,
  () => {
    const ids: string[] = [];
    collectAllIds(treeNodes.value, ids);
    expandedIds.value = ids;
  },
  { immediate: true },
);

// Reinitialize SortableJS after each tree render or expand/collapse
watch([treeNodes, expandedIds], async () => {
  await nextTick();
  initSortables();
}, { flush: 'post' });

onMounted(async () => {
  void rootListRef;
  registerRegion({
    id: 'content-treeoverview',
    type: 'glass',
    element: treeRef,
    shouldShow: (state) => state.viewState === 'tree_overview',
    parent: 'content',
  });

  if (treeNodes.value.length === 0) {
    await store.refreshTree();
  }
  await nextTick();
  initSortables();
});

onBeforeUnmount(() => {
  destroySortables();
  unregisterRegion('content-treeoverview');
});
</script>

<style scoped>
.tree-shell {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-rows: auto auto auto 1fr;
  gap: 8px;
  padding: 8px;
  color: var(--color-primary);
}

.header h2 {
  margin: 0;
}

.hint {
  margin: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
}

.root-zone {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  border: 2px dashed rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  transition: border-color 160ms ease, background 160ms ease;
}

.root-zone:hover {
  border-color: rgba(102, 255, 229, 0.4);
  background: rgba(102, 255, 229, 0.06);
}

.root-zone-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.tree-scroll {
  min-height: 0;
  overflow: auto;
}

.tree-root {
  margin: 0;
  padding: 0;
  min-height: 40px;
}

/* SortableJS ghost — the element following the cursor */
:deep(.sortable-ghost) {
  opacity: 0.4;
  background: rgba(102, 255, 229, 0.12);
  border-radius: 10px;
}

/* SortableJS chosen — the original element being dragged */
:deep(.sortable-chosen) {
  opacity: 0.5;
}

/* SortableJS drag — the dragged element */
:deep(.sortable-drag) {
  opacity: 0.9;
  background: rgba(102, 255, 229, 0.15);
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}
</style>
