// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResizeHandler } from '../scene/sceneResize'
import type { SceneState } from '../scene/sceneState'
import type { CameraRig } from '../scene/sceneCamera'
import type { BackgroundManager } from '../scene/sceneBackground'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('canvas resolution during layout scaling', () => {
  it('updates resolution when the UI scale changes without resizing the logical container', () => {
    vi.stubGlobal('devicePixelRatio', 1)
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { value: 1500 },
      clientHeight: { value: 900 },
    })
    container.style.setProperty('--layout-scale', '2')
    const renderer = { getPixelRatio: vi.fn(() => 1), setPixelRatio: vi.fn(), setSize: vi.fn() }
    const state = {
      container, renderer, camera: {}, lastContainerW: 1500, lastContainerH: 900,
      callbacks: { onResizeStart: vi.fn() },
    } as unknown as SceneState
    const handler = new ResizeHandler(state, {} as CameraRig, {} as BackgroundManager)

    handler.handleResize()

    expect(renderer.setPixelRatio).toHaveBeenCalledExactlyOnceWith(2)
    expect(renderer.setSize).not.toHaveBeenCalled()
    expect(state.callbacks.onResizeStart).not.toHaveBeenCalled()
  })
})
