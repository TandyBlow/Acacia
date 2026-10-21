import { watch, onUnmounted } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import {
  NAV_SCROLL_MIN_ANIM_MS,
  NAV_SCROLL_MAX_ANIM_MS,
  NAV_SCROLL_MOMENTUM_FRICTION,
  NAV_SCROLL_MOMENTUM_THRESHOLD,
  NAV_SCROLL_INPUT_WINDOW_MS,
  NAV_ANIM_MS,
} from '../../constants/app'
import { ROW_STEP } from './NavigationTypes'
import { animateSingleScroll } from './NavigationScrollStep'
import type { NavigationState } from './NavigationState'
import { getLayoutScale } from '../../utils/layoutScale'

export function useNavigationScroll(state: NavigationState) {
  // Calculate animation duration based on current speed
  function calcAnimDuration(): number {
    const speed = state.currentSpeed.value
    if (speed <= 0) return NAV_ANIM_MS
    const clampedSpeed = Math.max(1, Math.min(speed, 12))
    const duration = NAV_SCROLL_MAX_ANIM_MS - (clampedSpeed - 1) * (NAV_SCROLL_MAX_ANIM_MS - NAV_SCROLL_MIN_ANIM_MS) / 11
    return Math.round(duration)
  }

  // --- scroll animation engine ---
  function onWheel(e: WheelEvent): void {
    if (e.deltaY === 0) return

    const now = Date.now()
    const dt = now - state.lastWheelTime.value
    state.lastWheelTime.value = now

    if (dt > 0 && dt < NAV_SCROLL_INPUT_WINDOW_MS * 3) {
      const delta = Math.abs(e.deltaY)
      const rowsEquiv = delta / 120
      state.currentSpeed.value = rowsEquiv / (dt / 1000)
    } else {
      state.currentSpeed.value = Math.max(1, state.currentSpeed.value * 0.5)
    }

    const direction: 'up' | 'down' = e.deltaY > 0 ? 'down' : 'up'
    state.lastScrollDirection.value = direction

    if (state.scrollQueue.value.length < 6) {
      state.scrollQueue.value.push({ direction })
    }

    if (!state.isAnimating.value) {
      processScrollQueue()
    }
  }

  let touchY = 0
  let touchStartTime = 0
  function onTouchStart(e: TouchEvent): void {
    if (e.touches[0]) {
      touchY = e.touches[0].clientY
      touchStartTime = Date.now()
    }
  }
  function onTouchEnd(e: TouchEvent): void {
    if (!e.changedTouches[0]) return
    const target = e.currentTarget
    const scale = target instanceof Element ? getLayoutScale(target) : 1
    const dy = (touchY - e.changedTouches[0].clientY) / scale
    if (Math.abs(dy) < 30) return

    const direction: 'up' | 'down' = dy > 0 ? 'down' : 'up'
    const rows = Math.max(1, Math.round(Math.abs(dy) / ROW_STEP))

    // Track speed for momentum (rows per second)
    const dt = Date.now() - touchStartTime
    if (dt > 0) {
      state.currentSpeed.value = rows / (dt / 1000)
    }

    for (let i = 0; i < rows && state.scrollQueue.value.length < 20; i++) {
      state.scrollQueue.value.push({ direction })
    }
    state.lastScrollDirection.value = direction

    if (!state.isAnimating.value) {
      processScrollQueue()
    }
  }

  async function processScrollQueue(): Promise<void> {
    state.isAnimating.value = true

    while (state.scrollQueue.value.length > 0) {
      const entry = state.scrollQueue.value.shift()!

      const canScroll = entry.direction === 'down'
        ? state.scrollOffset.value + state.maxVisible.value < state.scrollSource.value.length
        : state.scrollOffset.value > 0
      if (!canScroll) continue

      const duration = calcAnimDuration()
      state.currentAnimMs.value = duration

      await animateSingleScroll(state, entry.direction, duration)
    }

    // Queue empty — apply momentum
    await applyMomentum()

    state.isAnimating.value = false
    state.currentSpeed.value = 0
  }

  async function applyMomentum(): Promise<void> {
    let velocity = state.currentSpeed.value

    while (velocity > NAV_SCROLL_MOMENTUM_THRESHOLD) {
      velocity *= NAV_SCROLL_MOMENTUM_FRICTION

      const direction = state.lastScrollDirection.value
      const canScroll = direction === 'down'
        ? state.scrollOffset.value + state.maxVisible.value < state.scrollSource.value.length
        : state.scrollOffset.value > 0
      if (!canScroll) break

      const duration = Math.max(NAV_SCROLL_MIN_ANIM_MS, Math.round(NAV_ANIM_MS / velocity))
      state.currentAnimMs.value = duration

      await animateSingleScroll(state, direction, duration)
    }
  }

  // [Bug2 fix] full reset used by the childNodes watcher — bumps the shared
  // cancel token so in-flight animateSingleScroll callbacks are invalidated.
  function resetScroll(): void {
    state.scrollCancelToken++
    state.scrollQueue.value = []
    state.isAnimating.value = false
    state.scrollOffset.value = 0
    state.scrollingTopId.value = null
    state.scrollingBottomId.value = null
    state.scrollDirection.value = null
    state.currentSpeed.value = 0
    state.currentAnimMs.value = NAV_ANIM_MS
  }

  // --- resize observer ---
  let ro: ResizeObserver | null = null

  function attachObserver(el: Element): void {
    ro?.disconnect()
    ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        state.containerH.value = entry.contentRect.height
      }
    })
    ro.observe(el)
  }

  watch(state.nodeListRef, (inst) => {
    if (!inst) return
    const el = inst && '$el' in inst ? (inst as ComponentPublicInstance).$el : inst
    if (el instanceof HTMLElement) attachObserver(el)
  })

  onUnmounted(() => ro?.disconnect())

  return { onWheel, onTouchStart, onTouchEnd, resetScroll }
}
