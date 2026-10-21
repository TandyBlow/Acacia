import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useKnobDispatch } from './useKnobDispatch'
import { usePageTransition } from './usePageTransition'
import { useDevStore } from '../stores/devStore'
import { COMPACT_BREAKPOINT, MIN_SPACE_HEIGHT } from '../constants/app'
import { CONTENT_DIRECT_STATES } from './useMainLayoutState'
import { calculateLayoutScale } from '../utils/layoutScale'
import type { LayoutType } from '../types/transition'
import type { MainLayoutState } from './useMainLayoutState'

function debounce<T extends (...args: never[]) => void>(fn: T, delay: number): T {
  let timeoutId: number | null = null
  return ((...args: never[]) => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
    }
    timeoutId = window.setTimeout(() => {
      fn(...args)
      timeoutId = null
    }, delay)
  }) as T
}

function getLayoutHeight(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim()
  if (v && v.endsWith('px')) {
    return parseFloat(v) || window.innerHeight
  }
  return window.innerHeight
}

function computeLayout(w: number, h: number): LayoutType {
  if (h < MIN_SPACE_HEIGHT) {
    return 'small'
  }
  if (w < COMPACT_BREAKPOINT) {
    return 'small'
  }
  if (w > h) {
    return 'large'
  }
  return 'medium'
}

/**
 * Layout sizing, resize handling, and page-transition region registration.
 * Side-effect composable: registers its own onMounted/onBeforeUnmount/watch.
 * Must be called once during setup.
 */
export function useMainLayoutLayout(state: MainLayoutState) {
  const { layoutType, compactMode } = useKnobDispatch()
  const { registerRegion, unregisterRegion, startTransition, syncRegionVisibility } = usePageTransition()
  const devStore = useDevStore()
  const initialHeight = getLayoutHeight()
  const layoutScale = ref(calculateLayoutScale(
    window.innerWidth, initialHeight, computeLayout(window.innerWidth, initialHeight),
  ))

  function updateLayoutState(): void {
    const w = window.innerWidth
    const h = getLayoutHeight()

    state.isTooSmall.value = h < MIN_SPACE_HEIGHT

    const newLayout = computeLayout(w, h)
    layoutScale.value = calculateLayoutScale(w, h, newLayout)

    const wasLayout = layoutType.value
    layoutType.value = newLayout

    if (wasLayout !== newLayout) {
      startTransition({ type: 'layout', newLayout })
    }

    if (newLayout !== 'small') {
      compactMode.value = 'content'
    }
  }

  const handleResize = debounce(updateLayoutState, 150)

  // Non-debounced: immediately fix region visibility when crossing the compact
  // threshold to prevent nav/content overlap during the 150ms debounce window.
  // CSS @media applies instantly on resize; this keeps JS display state in sync.
  function handleResizeImmediate(): void {
    const w = window.innerWidth
    const h = getLayoutHeight()

    const newLayout = computeLayout(w, h)
    layoutScale.value = calculateLayoutScale(w, h, newLayout)

    if (newLayout !== layoutType.value) {
      layoutType.value = newLayout
      syncRegionVisibility()
    }
  }

  onMounted(() => {
    window.addEventListener('resize', handleResizeImmediate)
    window.addEventListener('resize', handleResize)

    if (state.logoRef.value) {
      registerRegion({
        id: 'logo',
        type: 'inset',
        element: state.logoRef,
        shouldShow: (s) => s.layout !== 'small',
      })
    }

    if (state.breadcrumbsRef.value) {
      registerRegion({
        id: 'breadcrumbs',
        type: 'inset',
        element: state.breadcrumbsRef,
        shouldShow: () => true,
      })
    }

    if (state.navigationRef.value) {
      registerRegion({
        id: 'navigation',
        type: 'inset',
        element: state.navigationRef,
        shouldShow: (s) => {
          if (s.layout === 'small') {
            if (CONTENT_DIRECT_STATES.includes(s.viewState)) return true
            return s.compactMode === 'nav'
          }
          return true
        },
      })
    }

    if (state.contentAreaRef.value) {
      registerRegion({
        id: 'content',
        type: 'glass',
        element: state.contentAreaRef,
        shouldShow: (s) => {
          if (s.layout === 'small') {
            if (CONTENT_DIRECT_STATES.includes(s.viewState)) return true
            return s.compactMode !== 'nav'
          }
          return true
        },
      })
    }

    if (state.knobRef.value) {
      registerRegion({
        id: 'knob',
        type: 'inset',
        element: state.knobRef,
        shouldShow: () => true,
      })
    }

    // Initial visibility sync — must run after regions are registered
    updateLayoutState()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResizeImmediate)
    window.removeEventListener('resize', handleResize)

    unregisterRegion('logo')
    unregisterRegion('breadcrumbs')
    unregisterRegion('navigation')
    unregisterRegion('content')
    unregisterRegion('knob')
  })

  watch(
    () => devStore.enableTransition,
    (transition) => {
      const root = document.documentElement
      if (!transition) {
        root.setAttribute('data-no-transition', '')
      } else {
        root.removeAttribute('data-no-transition')
      }
    },
    { immediate: true },
  )

  return { layoutScale }
}
