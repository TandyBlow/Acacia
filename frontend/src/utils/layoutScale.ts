import type { LayoutType } from '../types/transition'

/** Match the approved desktop layout at 1920 × 1080 without shrinking smaller layouts. */
export function calculateLayoutScale(width: number, height: number, layout: LayoutType): number {
  if (layout !== 'large' || !Number.isFinite(width) || !Number.isFinite(height)) return 1
  return Math.max(1, Math.min(width / 1920, height / 1080))
}

/** Convert viewport measurements back into the layout's unscaled CSS coordinates. */
export function getLayoutScale(element: Element): number {
  const scale = Number(getComputedStyle(element).getPropertyValue('--layout-scale'))
  return Number.isFinite(scale) && scale >= 1 ? scale : 1
}

/** Keep a transformed canvas sharp at its displayed size, including on high-DPI screens. */
export function getLayoutPixelRatio(element: Element): number {
  return (window.devicePixelRatio || 1) * getLayoutScale(element)
}
