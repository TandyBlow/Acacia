<template>
  <div ref="containerRef" class="tree-canvas">
    <div v-if="noTreeData" class="no-tree-msg">{{ UI.tree.noBackend }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, provide, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '../../stores/authStore';
import { useStyleStore } from '../../stores/styleStore';
import { useTreeSkeleton, invalidateSkeleton } from '../../composables/useTreeSkeleton';
import { useStats } from '../../composables/useStats';
import { usePageTransition } from '../../composables/usePageTransition';
import { SceneManager } from './scene/SceneManager';
import type { SkeletonData } from '../../types/tree';
import { UI } from '../../constants/uiStrings';

const containerRef = ref<HTMLDivElement>();
const { registerRegion, unregisterRegion } = usePageTransition();
const props = defineProps<{ visible?: boolean }>();
const authStore = useAuthStore();
const { isAuthenticated } = storeToRefs(authStore);
const styleStore = useStyleStore();
const { fetchSkeleton } = useTreeSkeleton();
const { nodes: statsNodes, fetchStats } = useStats();
const noTreeData = ref(false);
const sceneReady = ref(false);

let manager: SceneManager | null = null;
let lastSkeleton: SkeletonData | null = null;

const isResizing = ref(false);
let resizeObserver: ResizeObserver | null = null;

provide('isTreeResizing', isResizing);

let treeLoaded = false;
let loadGeneration = 0;

async function loadTree() {
  console.log('[TreeCanvas] loadTree called', { hasContainer: !!containerRef.value, treeLoaded, cw: containerRef.value?.clientWidth, ch: containerRef.value?.clientHeight });
  if (!containerRef.value || treeLoaded) return;

  const gen = ++loadGeneration;
  const userId = authStore.user?.id;

  try {
    const cw = containerRef.value.clientWidth;
    const ch = containerRef.value.clientHeight;

    // Fetch skeleton and stats in parallel. Stats may fail (backend not
    // available, endpoint missing, etc.) — we log the error and fall back
    // to applyUserData() below.
    let statsOk = false;
    const [skeleton] = await Promise.all([
      fetchSkeleton(cw || undefined, ch || undefined),
      userId
        ? fetchStats()
            .then(() => { statsOk = true; })
            .catch((err) => {
              console.warn('[TreeCanvas] fetchStats failed, will retry via applyUserData:', err?.message ?? err);
            })
        : Promise.resolve(),
    ]);
    console.log('[TreeCanvas] fetchSkeleton returned', { branches: skeleton.branches?.length, hasTrunk: !!skeleton.trunk, statsOk, statsNodes: statsNodes.value.length });

    if (gen !== loadGeneration) return;

    if (!containerRef.value) {
      console.warn('[TreeCanvas] containerRef became null after fetch — component likely unmounted, aborting');
      return;
    }
    if (containerRef.value.clientWidth === 0 || containerRef.value.clientHeight === 0) {
      console.warn('[TreeCanvas] container has zero dimensions, tree may not render correctly',
        { w: containerRef.value.clientWidth, h: containerRef.value.clientHeight });
    }

    if (!skeleton.branches || skeleton.branches.length === 0) {
      noTreeData.value = true;
      sceneReady.value = true;
      return;
    }
    lastSkeleton = skeleton;

    manager = new SceneManager(containerRef.value, styleStore.style, {
      onResizeStart: () => { isResizing.value = true; },
      onResizeEnd: () => { isResizing.value = false; },
      onBranchClick: (nodeId: string) => {
        console.log('Clicked branch, node_id:', nodeId);
      },
    });

    // Always preload user overrides when userId is available, even if stats
    // are empty. Using nodeCount=0 maps to tier-0 (seedling) params, which
    // is the correct visual for a new user. This avoids the two-phase flash:
    // default Oak Medium (64u) → seedling (6u) when applyUserData retries.
    if (userId) {
      const nodeCount = statsOk ? statsNodes.value.length : 0;
      const maxDepth = statsOk
        ? statsNodes.value.reduce((m, n) => Math.max(m, n.depth), 0)
        : 0;
      manager.preloadUserOverrides(nodeCount, maxDepth, userId, skeleton.growth);
      console.log('[TreeCanvas] user overrides preloaded,', { nodeCount, maxDepth, statsOk });
    }
    console.log('[TreeCanvas] SceneManager created, building scene...');

    manager.buildScene(skeleton);
    console.log('[TreeCanvas] buildScene completed');

    if (gen !== loadGeneration) return;

    sceneReady.value = true;

    // Set up resize observer
    resizeObserver = new ResizeObserver(() => {
      if (manager) manager.handleResize();
    });
    resizeObserver.observe(containerRef.value);

    // Overrides were preloaded before buildScene (always, if userId was
    // available). No need for applyUserData() fallback — the tree was
    // generated with user-appropriate params from frame 1.

    treeLoaded = true;
  } catch (err) {
    if (gen !== loadGeneration) return;
    noTreeData.value = true;
    sceneReady.value = true;
    console.error('Failed to load tree skeleton:', err);
  }
}

async function applyUserData() {
  const userId = authStore.user?.id;
  if (!userId || !manager) return;
  manager.setUserId(userId);
  try {
    await fetchStats();
  } catch {
    // Stats endpoint may be unavailable; proceed with default tree
    return;
  }
  if (manager) {
    manager.updateUserData(statsNodes.value, styleStore.distribution, lastSkeleton?.growth);
  }
}

watch(isAuthenticated, (authed) => {
  if (authed) {
    loadTree();
  } else {
    cleanup();
    treeLoaded = false;
    noTreeData.value = false;
  }
}, { immediate: true });

// When user object becomes available (may lag behind isAuthenticated),
// apply user data to the tree
watch(() => authStore.user, (user) => {
  if (user?.id && manager && treeLoaded) {
    applyUserData();
  }
});

onMounted(() => {
  registerRegion({
    id: 'content-tree',
    type: 'glass',
    element: containerRef as any,
    shouldShow: (state) => {
      return state.isAuthenticated &&
             !state.activeNode &&
             state.viewState === 'display';
    },
    parent: 'content',
  });

  if (isAuthenticated.value && !treeLoaded) {
    loadTree();
  }
});

watch(() => styleStore.style, (newStyle) => {
  if (manager) {
    manager.switchTheme(newStyle);
  }
});

watch(() => statsNodes.value, () => {
  if (manager) {
    manager.updateUserData(statsNodes.value, styleStore.distribution, lastSkeleton?.growth);
  }
}, { deep: true });

function onBecameVisible() {
  // 不需要重新加载，场景已经存在
  // 只需要确保渲染器正常工作
  if (manager) {
    manager.handleResize();
  }
}

watch(() => props.visible, async (nowVisible, wasVisible) => {
  if (!nowVisible) {
    sceneReady.value = false;
    return;
  }
  if (wasVisible) return;
  await nextTick();
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  onBecameVisible();
});

function cleanup() {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (manager) {
    manager.dispose();
    manager = null;
  }
  invalidateSkeleton();
}

onBeforeUnmount(() => {
  unregisterRegion('content-tree');
  cleanup();
});

defineExpose({ sceneReady });
</script>

<style scoped>
.tree-canvas {
  width: 100%;
  height: 100%;
  position: relative;
}

.no-tree-msg {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--color-primary);
  opacity: 0.6;
  font-size: 16px;
  font-weight: 600;
}
</style>
