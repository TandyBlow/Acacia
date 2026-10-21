import { ref, provide, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '../../stores/authStore'
import { useStyleStore } from '../../stores/styleStore'
import { useTreeSkeleton, invalidateSkeleton } from '../../composables/useTreeSkeleton'
import { useStats } from '../../composables/useStats'
import { cinemaTreeCanvas } from '../../composables/useCinemaBridge'
import { SceneManager } from './scene/SceneManager'
import type { SkeletonData } from '../../types/tree'
import { resolveInitParams, preloadUserOverrides, createCinemaBridge } from './treeCanvasLoad'
import { createSceneControls } from './treeCanvasSceneControls'

/**
 * Owns the 3D scene lifecycle for TreeCanvas: the SceneManager instance,
 * all scene state refs, and the imperative control helpers. Called once from
 * the entry as useTreeCanvasScene(containerRef). Watcher-only operations
 * (applyUserData / onBecameVisible) live in useTreeCanvasSync.
 */
export function useTreeCanvasScene(containerRef: Ref<HTMLDivElement | undefined>) {
  const authStore = useAuthStore()
  const { isAuthenticated } = storeToRefs(authStore)
  const styleStore = useStyleStore()
  const { fetchSkeleton } = useTreeSkeleton()
  const { nodes: statsNodes, fetchStats } = useStats()
  const noTreeData = ref(false)
  const sceneReady = ref(false)

  let manager: SceneManager | null = null
  let lastSkeleton: SkeletonData | null = null

  const isResizing = ref(false)
  let resizeObserver: ResizeObserver | null = null
  let resizeFrame: number | null = null

  function handleViewportResize() {
    if (resizeFrame !== null) return
    // Wait until Vue has applied the new layout scale before measuring the canvas.
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = null
      manager?.handleResize()
    })
  }

  provide('isTreeResizing', isResizing)

  let treeLoaded = false
  let loadGeneration = 0

  async function loadTree() {
    if (!containerRef.value || treeLoaded) return

    const gen = ++loadGeneration
    const userId = authStore.user?.id

    try {
      const cw = containerRef.value.clientWidth
      const ch = containerRef.value.clientHeight

      // Fetch skeleton and stats in parallel. Stats may fail (backend not
      // available, endpoint missing, etc.) — we log the error and fall back
      // to applyUserData() below.
      let statsOk = false
      const [skeleton] = await Promise.all([
        fetchSkeleton(cw || undefined, ch || undefined),
        userId
          ? fetchStats()
              .then(() => { statsOk = true })
              .catch((err) => {
                console.warn('[TreeCanvas] fetchStats failed, will retry via applyUserData:', err?.message ?? err)
              })
          : Promise.resolve(),
      ])
      if (gen !== loadGeneration) return

      if (!containerRef.value) {
        console.warn('[TreeCanvas] containerRef became null after fetch — component likely unmounted, aborting')
        return
      }
      if (containerRef.value.clientWidth === 0 || containerRef.value.clientHeight === 0) {
        console.warn('[TreeCanvas] container has zero dimensions, tree may not render correctly',
          { w: containerRef.value.clientWidth, h: containerRef.value.clientHeight })
      }

      if (!skeleton.branches || skeleton.branches.length === 0) {
        noTreeData.value = true
        sceneReady.value = true
        return
      }
      lastSkeleton = skeleton

      const { style, params, bgUrl } = resolveInitParams(styleStore)

      manager = new SceneManager(containerRef.value, style, {
        onResizeStart: () => { isResizing.value = true },
        onResizeEnd: () => { isResizing.value = false },
        onBranchClick: (_nodeId: string) => {
          // branch click handled by parent
        },
      }, params, bgUrl)

      if (userId) {
        preloadUserOverrides(manager, statsOk, statsNodes.value, userId, skeleton.growth)
      }
      manager.buildScene(skeleton)

      if (gen !== loadGeneration) return

      sceneReady.value = true

      // Set up resize observer
      resizeObserver = new ResizeObserver(() => {
        if (manager) manager.handleResize()
      })
      resizeObserver.observe(containerRef.value)
      window.addEventListener('resize', handleViewportResize)

      // Overrides were preloaded before buildScene (always, if userId was
      // available). No need for applyUserData() fallback — the tree was
      // generated with user-appropriate params from frame 1.

      treeLoaded = true

      // If we built the tree with pending style data, commit it now so the
      // isPendingReady watcher doesn't trigger a redundant transition.
      if (styleStore.isPendingReady && styleStore.pendingParams) {
        styleStore.applyPendingStyle()
      }

      // Register with cinema bridge so CinematicDemo can control the tree
      cinemaTreeCanvas.value = createCinemaBridge(manager)
    } catch (err) {
      if (gen !== loadGeneration) return
      noTreeData.value = true
      sceneReady.value = true
      console.error('Failed to load tree skeleton:', err)
    }
  }

  function cleanup() {
    window.removeEventListener('resize', handleViewportResize)
    if (resizeFrame !== null) {
      window.cancelAnimationFrame(resizeFrame)
      resizeFrame = null
    }
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    if (manager) {
      manager.dispose()
      manager = null
    }
    invalidateSkeleton()
  }

  function dispose() {
    cleanup()
    cinemaTreeCanvas.value = null
  }

  function reset() {
    cleanup()
    treeLoaded = false
    noTreeData.value = false
  }

  function isLoaded(): boolean {
    return treeLoaded && manager !== null
  }

  function loadIfAuthed() {
    if (isAuthenticated.value && !treeLoaded) {
      loadTree()
    }
  }

  function getManager(): SceneManager | null {
    return manager
  }

  function getLastSkeleton(): SkeletonData | null {
    return lastSkeleton
  }

  const controls = createSceneControls({ getManager, getLastSkeleton, statsNodes, styleStore })

  return {
    sceneReady,
    noTreeData,
    isResizing,
    statsNodes,
    fetchStats,
    getManager,
    getLastSkeleton,
    loadTree,
    loadIfAuthed,
    reset,
    isLoaded,
    dispose,
    ...controls,
  }
}

export type TreeCanvasScene = ReturnType<typeof useTreeCanvasScene>
