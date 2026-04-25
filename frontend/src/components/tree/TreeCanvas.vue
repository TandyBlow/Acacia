<template>
  <div ref="containerRef" class="tree-canvas">
    <div v-if="noTreeData" class="no-tree-msg">{{ UI.tree.noBackend }}</div>
    <div v-if="isDev && !noTreeData" class="dev-buttons">
      <button class="dev-btn" :disabled="busy" @click="onTagNodes">{{ UI.tree.devTagNodes }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, provide, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '../../stores/authStore';
import { useStyleStore } from '../../stores/styleStore';
import { useTreeSkeleton, invalidateSkeleton } from '../../composables/useTreeSkeleton';
import { useStats } from '../../composables/useStats';
import { SceneManager } from './scene/SceneManager';
import { DebugGUI } from './scene/DebugGUI';
import type { SkeletonData } from '../../types/tree';
import type { ThemeStyle } from '../../stores/styleStore';
import { UI } from '../../constants/uiStrings';

const containerRef = ref<HTMLDivElement>();
const props = defineProps<{ visible?: boolean }>();
const authStore = useAuthStore();
const { isAuthenticated } = storeToRefs(authStore);
const styleStore = useStyleStore();
const { busy, fetchSkeleton, onTagNodes } = useTreeSkeleton();
const { nodes: statsNodes, fetchStats } = useStats();
const isDev = import.meta.env.DEV;
const noTreeData = ref(false);

let manager: SceneManager | null = null;
let debugGUI: DebugGUI | null = null;
let lastSkeleton: SkeletonData | null = null;

const isResizing = ref(false);
let resizeObserver: ResizeObserver | null = null;

provide('isTreeResizing', isResizing);

let treeLoaded = false;
let loadGeneration = 0;

async function loadTree() {
  if (!containerRef.value || treeLoaded) return;

  const gen = ++loadGeneration;

  try {
    const cw = containerRef.value.clientWidth;
    const ch = containerRef.value.clientHeight;
    const skeleton = await fetchSkeleton(cw || undefined, ch || undefined);

    // Abort if a newer loadTree was triggered while we awaited
    if (gen !== loadGeneration) return;

    if (!skeleton.branches || skeleton.branches.length === 0) {
      noTreeData.value = true;
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

    manager.buildScene(skeleton);

    if (gen !== loadGeneration) return;

    // Dev debug GUI
    if (isDev && manager) {
      debugGUI = new DebugGUI({
        getEzTreeOptions: () => manager!.getEzTreeOptions(),
        setEzTreeOptions: (opts) => manager!.setEzTreeOptions(opts),
        loadEzTreePreset: (name) => manager!.loadEzTreePreset(name),
        setMainLightPos: (x, y, z) => manager!.setMainLightPos(x, y, z),
        setLeafTexture: (i) => manager!.setLeafTexture(i),
        switchTheme: (style) => manager!.switchTheme(style as ThemeStyle),
      });
    }

    // Set up resize observer
    resizeObserver = new ResizeObserver(() => {
      if (manager) manager.handleResize();
    });
    resizeObserver.observe(containerRef.value);

    // Apply user data (may be deferred if user not yet available)
    applyUserData();

    treeLoaded = true;
  } catch (err) {
    if (gen !== loadGeneration) return;
    noTreeData.value = true;
    console.error('Failed to load tree skeleton:', err);
  }
}

async function applyUserData() {
  const userId = authStore.user?.id;
  if (!userId || !manager) return;
  manager.setUserId(userId);
  try {
    await fetchStats(userId);
  } catch {
    // Stats endpoint may be unavailable; proceed with default tree
    return;
  }
  if (manager) {
    manager.updateUserData(statsNodes.value, styleStore.distribution);
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
    manager.updateUserData(statsNodes.value, styleStore.distribution);
  }
}, { deep: true });

function onBecameVisible() {
  if (!lastSkeleton || !containerRef.value) return;
  redrawTree();
}

watch(() => props.visible, async (nowVisible, wasVisible) => {
  if (!nowVisible || wasVisible) return;
  await nextTick();
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  onBecameVisible();
});

async function redrawTree() {
  if (!lastSkeleton || !containerRef.value) {
    isResizing.value = false;
    return;
  }
  cleanup();
  invalidateSkeleton();
  treeLoaded = false;
  await loadTree();
  isResizing.value = false;
}

function cleanup() {
  if (debugGUI) {
    debugGUI.dispose();
    debugGUI = null;
  }
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
  cleanup();
});
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

.dev-buttons {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  gap: 8px;
}

.dev-btn {
  padding: 6px 14px;
  border: 1px solid var(--color-glass-border);
  border-radius: 12px;
  background: var(--color-glass-bg);
  backdrop-filter: blur(10px);
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 160ms ease;
}

.dev-btn:disabled {
  opacity: 0.4;
  cursor: wait;
}

.dev-btn:hover:not(:disabled) {
  opacity: 0.8;
}
</style>
