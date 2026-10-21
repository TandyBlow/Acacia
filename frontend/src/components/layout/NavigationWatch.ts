import { watch, nextTick, inject, ref, type Ref } from 'vue'
import type { NavigationState } from './NavigationState'

// Must be called LAST in the entry so the immediate childNodes watcher fires
// after animateNavPageTransition / resetScroll already exist.
export function useNavigationWatch(
  state: NavigationState,
  anim: { animateNavPageTransition: () => Promise<void> },
  scroll: { resetScroll: () => void },
) {
  const contentAnimating = inject<Ref<boolean>>('contentAnimating', ref(false))

  // Keep showOfficialNodes and displayItems in sync when not mid-animation.
  // Covers: dailyQuizVisible async update, viewState transitions in non-compact layout.
  // When activeNode changes, childNodes always changes in the same tick, so the
  // childNodes watcher handles displayItems — we must NOT update displayItems
  // here or the new children will flash before the animation runs.
  watch([state.visibleOfficialNodes, state.activeNode], (newVals, oldVals) => {
    if (state.navAnimating.value || state.isAnimating.value) return
    const next = state.visibleOfficialNodes.value.length > 0 && !state.activeNode.value
    state.showOfficialNodes.value = next
    if (newVals[1] === oldVals[1]) {
      state.displayItems.value = state.scrollSource.value.slice(state.scrollOffset.value, state.scrollOffset.value + state.maxVisible.value)
    }
  })

  // [Bug2 fix] reset when child nodes change — cancel any in-flight scroll
  watch(state.childNodes, () => {
    scroll.resetScroll()

    if (!state.hasInitialized) {
      // Setup fire (immediate: true)
      state.hasInitialized = true
      state.showOfficialNodes.value = state.visibleOfficialNodes.value.length > 0 && !state.activeNode.value
      state.pressedNodeId.value = null
      state.displayItems.value = state.scrollSource.value.slice(0, state.maxVisible.value)
      state.transitionName.value = 'none'
      // If data is already present, there is no async "first data" still
      // loading — the next childNodes change is a user navigation and must animate.
      if (state.childNodes.value.length > 0 || state.visibleOfficialNodes.value.length > 0) {
        state.pendingFirstData = false
      }
      nextTick(() => { state.transitionName.value = 'cell' })
    } else if (state.pendingFirstData) {
      // Initial data load
      state.pendingFirstData = false
      state.showOfficialNodes.value = state.visibleOfficialNodes.value.length > 0 && !state.activeNode.value
      state.pressedNodeId.value = null
      state.displayItems.value = state.scrollSource.value.slice(0, state.maxVisible.value)
      state.transitionName.value = 'none'
      nextTick(() => { state.transitionName.value = 'cell' })
    } else if (state.layoutType.value === 'small' && state.compactMode.value === 'nav' && contentAnimating.value) {
      // The compact toggle animates the whole navigation area. Populate its
      // list before it enters, without also playing a list page transition.
      state.navAnimToken++
      state.navPhase.value = 'idle'
      state.navAnimating.value = false
      state.showOfficialNodes.value = state.visibleOfficialNodes.value.length > 0 && !state.activeNode.value
      state.pressedNodeId.value = null
      state.displayItems.value = state.scrollSource.value.slice(0, state.maxVisible.value)
      state.transitionName.value = 'none'
      nextTick(() => { state.transitionName.value = 'cell' })
    } else {
      // Page navigation
      anim.animateNavPageTransition()
    }
  }, { immediate: true })

  // Without this reset, resizing to large layout while in add/daily_quiz/official_content
  // leaves the node list permanently hidden.
  watch(state.layoutType, (lt) => {
    if (lt !== 'small') {
      state.hideNodeList.value = false
      state.hideNonAnchorItems.value = false
      state.otAnchorItemId.value = null
      state.otClickedItemId.value = null
      state.otAnchorDeltaY.value = 0
      state.otAnchorPrep.value = false
      state.anchorOfficial.value = null
      state.anchorSlidingDown.value = false
    }
  })

  // Reset hideNodeList when leaving add state in small layout.
  // animateSmallLayoutAdd sets hideNodeList=true; cancelOperation (or any
  // other exit from add) must clear it so the node list reappears.
  // Also reset official transition state when leaving daily_quiz/official_content.
  watch(() => state.store.viewState, (newState, oldState) => {
    if (oldState === 'add' && newState !== 'add') {
      state.hideNodeList.value = false
    }
    if ((oldState === 'daily_quiz' || oldState === 'official_content') && newState === 'display') {
      state.resetOfficialTransition()
    }
  })

  // Sync anchorOfficial from shared composable during official transition
  watch(state.otAnchorItemId, (id) => {
    if (id) {
      const item = state.scrollSource.value.find(i => i.id === id)
      if (item) state.anchorOfficial.value = item
    } else if (!state.otAnimating.value) {
      state.anchorOfficial.value = null
    }
  })

  // [Bug4 fix] update visible window when container resizes
  watch(state.maxVisible, (mv) => {
    if (!state.isAnimating.value && !state.navAnimating.value) {
      state.displayItems.value = state.scrollSource.value.slice(state.scrollOffset.value, state.scrollOffset.value + mv)
    }
  })
}
