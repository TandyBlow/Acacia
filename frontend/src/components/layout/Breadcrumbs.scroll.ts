// ================================================================
// Scroll engine (unchanged)
// ================================================================
import { ref } from 'vue';
import type { Ref } from 'vue';
import { getLayoutScale } from '../../utils/layoutScale';

// Scroll animation constants
const BREADCRUMB_ANIM_MS = 180;
const BREADCRUMB_SCROLL_MIN_ANIM_MS = 80;
const BREADCRUMB_SCROLL_MAX_ANIM_MS = 240;
const BREADCRUMB_SCROLL_INPUT_WINDOW_MS = 150;

export function useBreadcrumbScroll(crumbTrackRef: Ref<HTMLElement | null>) {
  // Scroll engine state
  const scrollQueue = ref<Array<{ direction: 'left' | 'right' }>>([]);
  const isScrolling = ref(false);
  const lastWheelTime = ref(0);
  const currentSpeed = ref(0);
  const currentAnimMs = ref(BREADCRUMB_ANIM_MS);
  let scrollCancelToken = 0;

  // Touch support state
  const touchStartX = ref(0);
  const touchStartTime = ref(0);
  const touchStartScrollLeft = ref(0);

  function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function calcAnimDuration(): number {
    const speed = currentSpeed.value;
    if (speed <= 0) return BREADCRUMB_ANIM_MS;

    const clampedSpeed = Math.max(1, Math.min(speed, 12));
    const duration = BREADCRUMB_SCROLL_MAX_ANIM_MS -
      (clampedSpeed - 1) * (BREADCRUMB_SCROLL_MAX_ANIM_MS - BREADCRUMB_SCROLL_MIN_ANIM_MS) / 11;

    return Math.round(duration);
  }

  function findNextScrollTarget(direction: 'left' | 'right'): number {
    const container = crumbTrackRef.value;
    if (!container) return 0;

    const currentScrollLeft = container.scrollLeft;
    const containerLeft = container.getBoundingClientRect().left;
    const scale = getLayoutScale(container);

    const items = Array.from(container.querySelectorAll('.crumb-wrap')) as HTMLElement[];

    if (direction === 'right') {
      for (const item of items) {
        const itemRect = item.getBoundingClientRect();
        const itemLeft = (itemRect.left - containerLeft) / scale + currentScrollLeft;
        if (itemLeft > currentScrollLeft + 10) return itemLeft;
      }
      return container.scrollWidth - container.clientWidth;
    } else {
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]!;
        const itemRect = item.getBoundingClientRect();
        const itemLeft = (itemRect.left - containerLeft) / scale + currentScrollLeft;
        if (itemLeft < currentScrollLeft - 10) return itemLeft;
      }
      return 0;
    }
  }

  async function animateSingleScroll(direction: 'left' | 'right', duration: number): Promise<void> {
    const container = crumbTrackRef.value;
    if (!container) return;

    const targetScrollLeft = findNextScrollTarget(direction);
    const token = ++scrollCancelToken;

    container.style.scrollBehavior = 'smooth';
    container.scrollLeft = targetScrollLeft;

    await sleep(duration);

    if (token !== scrollCancelToken) return;
    container.style.scrollBehavior = 'auto';
  }

  async function processScrollQueue(): Promise<void> {
    isScrolling.value = true;

    while (scrollQueue.value.length > 0) {
      const entry = scrollQueue.value.shift()!;
      const container = crumbTrackRef.value;
      if (!container) break;

      const canScroll = entry.direction === 'right'
        ? container.scrollLeft < container.scrollWidth - container.clientWidth
        : container.scrollLeft > 0;

      if (!canScroll) continue;

      const duration = calcAnimDuration();
      currentAnimMs.value = duration;
      await animateSingleScroll(entry.direction, duration);
    }

    isScrolling.value = false;
    currentSpeed.value = 0;
  }

  function onWheel(e: WheelEvent): void {
    if (e.deltaY === 0) return;

    const now = Date.now();
    const dt = now - lastWheelTime.value;
    lastWheelTime.value = now;

    if (dt > 0 && dt < BREADCRUMB_SCROLL_INPUT_WINDOW_MS * 3) {
      const delta = Math.abs(e.deltaY);
      const itemsEquiv = delta / 120;
      currentSpeed.value = itemsEquiv / (dt / 1000);
    } else {
      currentSpeed.value = Math.max(1, currentSpeed.value * 0.5);
    }

    const direction: 'left' | 'right' = e.deltaY > 0 ? 'right' : 'left';

    if (scrollQueue.value.length < 20) {
      scrollQueue.value.push({ direction });
    }

    if (!isScrolling.value) {
      processScrollQueue();
    }
  }

  function onTouchStart(e: TouchEvent): void {
    const container = crumbTrackRef.value;
    if (!container || e.touches.length === 0) return;

    touchStartX.value = e.touches[0]!.clientX;
    touchStartTime.value = Date.now();
    touchStartScrollLeft.value = container.scrollLeft;
  }

  function onTouchMove(e: TouchEvent): void {
    const container = crumbTrackRef.value;
    if (!container || e.touches.length === 0) return;

    const touchX = e.touches[0]!.clientX;
    const deltaX = (touchStartX.value - touchX) / getLayoutScale(container);
    container.scrollLeft = touchStartScrollLeft.value + deltaX;
  }

  function onTouchEnd(e: TouchEvent): void {
    const container = crumbTrackRef.value;
    if (!container) return;

    const now = Date.now();
    const dt = now - touchStartTime.value;

    if (dt > 0 && dt < 300 && e.changedTouches.length > 0) {
      const touchEndX = e.changedTouches[0]!.clientX;
      const deltaX = (touchStartX.value - touchEndX) / getLayoutScale(container);
      const velocity = Math.abs(deltaX) / dt;

      if (velocity > 0.5) {
        const direction: 'left' | 'right' = deltaX > 0 ? 'right' : 'left';
        const steps = Math.min(3, Math.ceil(velocity * 2));

        for (let i = 0; i < steps; i++) {
          if (scrollQueue.value.length < 20) {
            scrollQueue.value.push({ direction });
          }
        }

        if (!isScrolling.value) {
          processScrollQueue();
        }
      }
    }
  }

  function resetScroll(): void {
    scrollQueue.value = [];
    currentSpeed.value = 0;
    isScrolling.value = false;
    scrollCancelToken++;
  }

  return { onWheel, onTouchStart, onTouchMove, onTouchEnd, resetScroll };
}
