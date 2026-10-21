import * as THREE from 'three'
import type { SceneState } from './sceneState'
import type { CameraRig } from './sceneCamera'
import type { BackgroundManager } from './sceneBackground'
import { getLayoutPixelRatio } from '../../../utils/layoutScale'

export class ResizeHandler {
  private state: SceneState
  private cameraRig: CameraRig
  private background: BackgroundManager

  constructor(state: SceneState, cameraRig: CameraRig, background: BackgroundManager) {
    this.state = state
    this.cameraRig = cameraRig
    this.background = background
  }

  handleResize() {
    if (!this.state.container || !this.state.camera || !this.state.renderer) return
    const w = this.state.container.clientWidth
    const h = this.state.container.clientHeight
    if (w === 0 || h === 0) return
    // A viewport resize can change only the UI scale, leaving logical sizes unchanged.
    const pixelRatio = getLayoutPixelRatio(this.state.container)
    if (pixelRatio !== this.state.renderer.getPixelRatio()) {
      this.state.renderer.setPixelRatio(pixelRatio)
    }
    if (w === this.state.lastContainerW && h === this.state.lastContainerH) return
    this.state.lastContainerW = w
    this.state.lastContainerH = h

    if (!this.state.isResizing) {
      this.state.isResizing = true
      this.state.renderer.domElement.style.opacity = '0'
      this.state.callbacks.onResizeStart()
    }

    if (this.state.resizeDebounceTimer !== null) {
      window.clearTimeout(this.state.resizeDebounceTimer)
    }
    this.state.resizeDebounceTimer = window.setTimeout(() => {
      this.state.resizeDebounceTimer = null
      this.onResizeDebounced()
    }, 1000)

    const frustum = this.cameraRig.computeOrthoFrustum(w, h)
    this.state.camera.left = frustum.left
    this.state.camera.right = frustum.right
    this.state.camera.top = frustum.top
    this.state.camera.bottom = frustum.bottom
    this.state.camera.updateProjectionMatrix()
    this.state.renderer.setSize(w, h)

    // 更新背景尺寸以适配新的相机视口
    this.background.updateSize()

    // this.updateGroundLineY();
  }

  private async onResizeDebounced() {
    if (!this.state.skeleton) {
      this.state.renderer!.domElement.style.opacity = '1'
      this.state.isResizing = false
      this.state.callbacks.onResizeEnd()
      return
    }

    // Recompute bounds and refit camera for new container size
    this.state.treeGroup!.position.y = 0
    this.state.treeGroup!.updateMatrixWorld(true)
    this.state.treeBounds = new THREE.Box3().setFromObject(this.state.treeGroup!)
    this.state.treeBounds.getCenter(this.state.treeCenter)

    const w = this.state.container.clientWidth
    const h = this.state.container.clientHeight
    if (w > 0 && h > 0) {
      const frustum = this.cameraRig.computeOrthoFrustum(w, h)
      this.state.camera!.left = frustum.left
      this.state.camera!.right = frustum.right
      this.state.camera!.top = frustum.top
      this.state.camera!.bottom = frustum.bottom
      this.state.camera!.updateProjectionMatrix()
      const halfH = (frustum.top - frustum.bottom) / 2
      const camY = this.state.treeBounds.min.y + halfH
      this.state.camera!.position.set(
        this.state.treeCenter.x,
        camY,
        this.state.treeCenter.z + 10,
      )
      this.state.camera!.lookAt(this.state.treeCenter.x, camY, this.state.treeCenter.z)
    }

    // this.updateGroundLineY();
    // this.updateParticleSpawnArea();

    // Reposition background to follow the updated camera
    this.background.updateSize()

    // Show canvas now that camera is correctly positioned
    this.state.renderer!.domElement.style.opacity = '1'
    this.state.isResizing = false
    this.state.callbacks.onResizeEnd()
  }

  clearTimer() {
    if (this.state.resizeDebounceTimer !== null) {
      window.clearTimeout(this.state.resizeDebounceTimer)
      this.state.resizeDebounceTimer = null
    }
  }
}
