// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useBreadcrumbScroll } from './Breadcrumbs.scroll'

describe('breadcrumbs in a scaled layout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  function setupTrack() {
    const track = document.createElement('div')
    track.style.setProperty('--layout-scale', '2')
    document.body.appendChild(track)
    Object.defineProperties(track, {
      clientWidth: { value: 200 },
      scrollWidth: { value: 600 },
    })
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 30 } as DOMRect)
    for (let index = 0; index < 3; index++) {
      const item = document.createElement('div')
      item.className = 'crumb-wrap'
      track.appendChild(item)
      vi.spyOn(item, 'getBoundingClientRect').mockImplementation(() => ({
        left: 30 + (index * 100 - track.scrollLeft) * 2,
      }) as DOMRect)
    }
    return { track, scroll: useBreadcrumbScroll(ref(track)) }
  }

  it('scrolls to the next breadcrumb using logical coordinates in both directions', async () => {
    const { track, scroll } = setupTrack()
    scroll.onWheel(new WheelEvent('wheel', { deltaY: 120 }))
    expect(track.scrollLeft).toBe(100)
    await vi.runAllTimersAsync()

    scroll.onWheel(new WheelEvent('wheel', { deltaY: -120 }))
    expect(track.scrollLeft).toBe(0)
    await vi.runAllTimersAsync()
  })

  it('keeps the touched content under the finger at 2x scale', () => {
    const { track, scroll } = setupTrack()
    scroll.onTouchStart({ touches: [{ clientX: 400 }] } as unknown as TouchEvent)
    scroll.onTouchMove({ touches: [{ clientX: 200 }] } as unknown as TouchEvent)
    expect(track.scrollLeft).toBe(100)
  })
})
