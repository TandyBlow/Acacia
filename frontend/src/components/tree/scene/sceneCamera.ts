import * as THREE from 'three'
import type { SceneState } from './sceneState'
import { getLayoutPixelRatio } from '../../../utils/layoutScale'

export class CameraRig {
  private state: SceneState

  constructor(state: SceneState) {
    this.state = state
  }

  computeOrthoFrustum(w: number, h: number) {
    if (!this.state.treeBounds) {
      const halfH = 4
      const halfW = halfH * (w / h)
      return { left: -halfW, right: halfW, top: halfH, bottom: -halfH }
    }
    const size = new THREE.Vector3()
    this.state.treeBounds.getSize(size)
    const padding = 1.3
    const halfH = (size.y / 2) * padding
    const halfW = (size.x / 2) * padding
    const aspect = w / h
    const frustumHalfH = Math.max(halfH, halfW / aspect)
    const frustumHalfW = frustumHalfH * aspect
    return { left: -frustumHalfW, right: frustumHalfW, top: frustumHalfH, bottom: -frustumHalfH }
  }

  refit() {
    if (!this.state.treeBounds || !this.state.camera) return
    const w = this.state.refContainerW || this.state.container.clientWidth
    const h = this.state.refContainerH || this.state.container.clientHeight
    const frustum = this.computeOrthoFrustum(w, h)

    this.state.camera.left = frustum.left
    this.state.camera.right = frustum.right
    this.state.camera.top = frustum.top
    this.state.camera.bottom = frustum.bottom
    this.state.camera.updateProjectionMatrix()

    // Position camera so tree bottom sits at canvas bottom
    const halfH = (frustum.top - frustum.bottom) / 2
    const camY = this.state.treeBounds.min.y + halfH
    this.state.camera.position.set(
      this.state.treeCenter.x,
      camY,
      this.state.treeCenter.z + 10,
    )
    this.state.camera.lookAt(this.state.treeCenter.x, camY, this.state.treeCenter.z)

    // 更新背景位置以跟随相机
    if (this.state.backgroundPlane) {
      this.state.backgroundPlane.updateSize()
    }
  }

  setup() {
    if (!this.state.container) return
    const containerW = this.state.container.clientWidth || 1
    const containerH = this.state.container.clientHeight || 1
    this.state.refContainerW = containerW
    this.state.refContainerH = containerH
    this.state.lastContainerW = containerW
    this.state.lastContainerH = containerH

    const frustum = this.computeOrthoFrustum(containerW, containerH)
    this.state.camera = new THREE.OrthographicCamera(
      frustum.left, frustum.right,
      frustum.top, frustum.bottom,
      0.1, 200,
    )
    this.refit()

    this.state.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.state.renderer.setSize(containerW, containerH)
    this.state.renderer.setPixelRatio(getLayoutPixelRatio(this.state.container))

    this.state.container.appendChild(this.state.renderer.domElement)
  }
}
