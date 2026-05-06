import * as THREE from 'three';

/**
 * 2D背景图渲染器
 * 背景图高度填充满画面，宽度居中裁剪
 */
export class BackgroundPlane {
  private mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;
  private texture: THREE.Texture | null = null;
  private camera: THREE.OrthographicCamera;

  constructor(texturePath: string, camera: THREE.OrthographicCamera) {
    this.camera = camera;

    // 创建几何体（初始大小，会在updateSize中调整）
    const geometry = new THREE.PlaneGeometry(1, 1);

    // 创建材质
    this.material = new THREE.MeshBasicMaterial({
      color: 0x87ceeb, // 天蓝色占位
      depthWrite: false,
      depthTest: false, // 改为false，确保背景总是在最后面
    });

    // 创建网格
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.set(0, 0, -20); // 放在树后面，居中
    this.mesh.renderOrder = -1; // 最先渲染
    this.mesh.name = 'background-plane';

    // 加载纹理
    this.loadTexture(texturePath);
  }

  /**
   * 加载背景纹理
   */
  private loadTexture(texturePath: string): void {
    const loader = new THREE.TextureLoader();

    loader.load(
      texturePath,
      (texture) => {
        // 纹理加载成功
        this.texture = texture;
        this.material.map = texture;
        this.material.color.setHex(0xffffff); // 恢复白色（显示纹理原色）
        this.material.needsUpdate = true;

        // 更新尺寸以适配相机
        this.updateSize();

        console.log('[BackgroundPlane] 背景纹理加载成功:', texturePath);
      },
      undefined,
      (error) => {
        console.warn('[BackgroundPlane] 背景纹理加载失败:', texturePath, error);
      }
    );
  }

  /**
   * 更新背景平面尺寸以填充满画面
   * 宽度和高度都拉伸填充整个画面
   */
  updateSize(): void {
    if (!this.texture) return;

    // 获取相机的可视区域尺寸
    const cameraHeight = this.camera.top - this.camera.bottom;
    const cameraWidth = this.camera.right - this.camera.left;

    // 直接使用相机的宽高，不保持纹理宽高比
    const planeHeight = cameraHeight;
    const planeWidth = cameraWidth;

    // 更新几何体尺寸
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);

    // 设置平面位置，使其中心和相机位置对齐（XY平面）
    this.mesh.position.set(
      this.camera.position.x,
      this.camera.position.y,
      -20
    );

    // 重置scale
    this.mesh.scale.set(1, 1, 1);

    console.log('[BackgroundPlane] 尺寸更新:', {
      cameraSize: `${cameraWidth.toFixed(1)} x ${cameraHeight.toFixed(1)}`,
      cameraPosition: `(${this.camera.position.x.toFixed(1)}, ${this.camera.position.y.toFixed(1)}, ${this.camera.position.z.toFixed(1)})`,
      planeSize: `${planeWidth.toFixed(1)} x ${planeHeight.toFixed(1)}`,
      planePosition: `(${this.mesh.position.x.toFixed(1)}, ${this.mesh.position.y.toFixed(1)}, ${this.mesh.position.z})`,
      textureSize: `${(this.texture.image as HTMLImageElement).width} x ${(this.texture.image as HTMLImageElement).height}`
    });
  }

  /**
   * 切换背景图
   */
  updateTexture(texturePath: string): void {
    // 释放旧纹理
    if (this.texture) {
      this.texture.dispose();
    }

    // 加载新纹理
    this.loadTexture(texturePath);
  }

  /**
   * 获取网格对象
   */
  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  /**
   * 清理资源
   */
  dispose(): void {
    if (this.texture) {
      this.texture.dispose();
    }
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
