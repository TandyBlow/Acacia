// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculateLayoutScale, getLayoutPixelRatio, getLayoutScale } from './layoutScale'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('desktop layout scaling', () => {
  it.each([
    [1366, 768, 1],
    [1920, 1080, 1],
    [2560, 1440, 4 / 3],
    [3440, 1440, 4 / 3],
    [3840, 2160, 2],
    [5120, 2880, 8 / 3],
    [3840, 900, 1],
  ])('scales %s × %s using both viewport dimensions', (width, height, expected) => {
    expect(calculateLayoutScale(width, height, 'large')).toBe(expected)
  })

  it.each(['small', 'medium'] as const)('keeps %s layouts at their existing size', layout => {
    expect(calculateLayoutScale(3840, 2160, layout)).toBe(1)
  })

  it.each([0, -1, NaN, Infinity])('handles invalid viewport dimensions (%s)', dimension => {
    expect(calculateLayoutScale(dimension, 2160, 'large')).toBe(1)
    expect(calculateLayoutScale(3840, dimension, 'large')).toBe(1)
  })

  it('converts a measured viewport distance into logical CSS pixels', () => {
    const element = document.createElement('div')
    element.style.setProperty('--layout-scale', '2')
    expect(108 / getLayoutScale(element)).toBe(54)
  })

  it('keeps unscaled elements at the device pixel ratio and scales canvas resolution', () => {
    vi.stubGlobal('devicePixelRatio', 2)
    const element = document.createElement('div')
    document.body.appendChild(element)
    expect(getLayoutScale(element)).toBe(1)
    expect(getLayoutPixelRatio(element)).toBe(2)
    element.style.setProperty('--layout-scale', '2')
    expect(getLayoutPixelRatio(element)).toBe(4)
  })
})
