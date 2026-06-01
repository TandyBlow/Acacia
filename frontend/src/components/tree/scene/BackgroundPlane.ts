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

  /**
   * @param texturePath  PNG path to load (used for known presets)
   * @param camera       Orthographic camera for sizing
   * @param readyTexture If provided, use this texture directly instead of loading from texturePath
   */
  constructor(texturePath: string, camera: THREE.OrthographicCamera, readyTexture?: THREE.Texture) {
    this.camera = camera;

    const geometry = new THREE.PlaneGeometry(1, 1);

    this.material = new THREE.MeshBasicMaterial({
      color: 0x87ceeb,
      depthWrite: false,
      depthTest: false,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.set(0, 0, -20);
    this.mesh.renderOrder = -1;
    this.mesh.name = 'background-plane';

    if (readyTexture) {
      this.texture = readyTexture;
      this.material.map = readyTexture;
      this.material.color.setHex(0xffffff);
      this.material.needsUpdate = true;
      this.updateSize();
    } else {
      this.loadTexture(texturePath);
    }
  }

  /**
   * 加载背景纹理
   */
  private loadTexture(texturePath: string): void {
    const loader = new THREE.TextureLoader();
    const fallbackPath = '/backgrounds/default.png';

    const tryLoad = (path: string) => {
      loader.load(
        path,
        (texture) => {
          this.texture = texture;
          this.material.map = texture;
          this.material.color.setHex(0xffffff);
          this.material.needsUpdate = true;
          this.updateSize();
        },
        undefined,
        (error) => {
          if (path !== fallbackPath) {
            console.warn('[BackgroundPlane] 背景纹理加载失败，回退到默认:', path);
            tryLoad(fallbackPath);
          } else {
            console.warn('[BackgroundPlane] 默认背景纹理也加载失败:', error);
          }
        }
      );
    };

    tryLoad(texturePath);
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
  }

  /**
   * 切换背景图 — 先加载新纹理，加载成功后再释放旧纹理，避免黑屏间隙
   */
  updateTexture(texturePath: string): void {
    const loader = new THREE.TextureLoader();
    const fallbackPath = '/backgrounds/default.png';

    const tryLoad = (path: string) => {
      loader.load(
        path,
        (newTexture) => {
          // 新纹理加载成功后，才释放旧纹理并切换
          if (this.texture && this.texture !== newTexture) {
            this.texture.dispose();
          }
          this.texture = newTexture;
          this.material.map = newTexture;
          this.material.color.setHex(0xffffff);
          this.material.needsUpdate = true;
          this.updateSize();
        },
        undefined,
        (error) => {
          if (path !== fallbackPath) {
            console.warn('[BackgroundPlane] 背景纹理加载失败，回退到默认:', path);
            tryLoad(fallbackPath);
          } else {
            console.warn('[BackgroundPlane] 默认背景纹理也加载失败:', error);
          }
        }
      );
    };

    tryLoad(texturePath);
  }

  /**
   * 直接设置纹理（用于程序化生成的渐变等）
   */
  setTexture(texture: THREE.Texture): void {
    if (this.texture) {
      this.texture.dispose();
    }
    this.texture = texture;
    this.material.map = texture;
    this.material.color.setHex(0xffffff);
    this.material.needsUpdate = true;
    this.updateSize();
  }

  /**
   * 快速切换纹理（不 dispose 旧纹理，用于预加载纹理缓存复用）
   */
  swapTexture(texture: THREE.Texture): void {
    this.texture = texture;
    this.material.map = texture;
    this.material.color.setHex(0xffffff);
    this.material.needsUpdate = true;
    this.updateSize();
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
