import * as THREE from 'three';
import GUI from 'lil-gui';
import { Tree as EzTree } from '@dgreenheck/ez-tree';

type EzTreeOptions = EzTree['options'];

interface SceneManagerDebugAPI {
  getEzTreeOptions: () => EzTreeOptions | null;
  setEzTreeOptions: (opts: EzTreeOptions) => void;
  loadEzTreePreset: (name: string) => void;
  setMainLightPos: (x: number, y: number, z: number) => void;
  setLeafTexture: (index: number) => void;
  switchTheme: (style: string) => void;
  simulateUserData: (nodeCount: number, maxDepth: number, growthMultiplier: number) => void;
  reloadRealUserData: () => void;
  setPlatformType: (type: number) => void;
  setPlatformZ: (z: number) => void;
  getCurrentPlatformType: () => number;
  getCurrentPlatformZ: () => number;
}

const THEME_STYLES = ['default', 'sakura', 'cyberpunk', 'ink'] as const;
const PLATFORM_LABELS: Record<number, string> = {
  0: '0: 山崖 Cliff',
  1: '1: 观景台 ViewingDeck',
  2: '2: 天台 Rooftop',
  3: '3: 寺庙台基 TempleBase',
  4: '4: 巨石 Megalith',
};

export class DebugGUI {
  private gui: GUI;
  private sm: SceneManagerDebugAPI;
  private presetObj = { preset: 'Oak Medium' };
  private lightObj = { azimuth: 45, elevation: 45 };
  private texObj = { texture: 0 };
  private themeObj = { style: 'default' };
  private simObj = { nodeCount: 50, maxDepth: 4, growth: 0.8 };
  private platformObj = { type: 0, z: 3.0 };

  constructor(sceneManager: SceneManagerDebugAPI) {
    this.sm = sceneManager;
    this.gui = new GUI({ title: 'Tree Debug' });

    // Sync initial values from SceneManager
    this.platformObj.type = this.sm.getCurrentPlatformType();
    this.platformObj.z = this.sm.getCurrentPlatformZ();

    this.buildSimFolder();
    this.buildTreeFolder();
    this.buildLeafFolder();
    this.buildLightFolder();
    this.buildThemeFolder();
    this.buildPlatformFolder();
  }

  private applySim() {
    this.sm.simulateUserData(this.simObj.nodeCount, this.simObj.maxDepth, this.simObj.growth);
  }

  private buildSimFolder() {
    const f = this.gui.addFolder('用户数据模拟 (Sim)');
    f.add(this.simObj, 'nodeCount', 1, 1000, 1).name('节点数').onChange(() => this.applySim());
    f.add(this.simObj, 'maxDepth', 1, 12, 1).name('最大深度').onChange(() => this.applySim());
    f.add(this.simObj, 'growth', 0.3, 2.5, 0.01).name('成长倍率').onChange(() => this.applySim());

    // Quick presets
    const presets: Record<string, [number, number, number]> = {
      '种子 (5节点)': [5, 2, 0.35],
      '萌芽 (20节点)': [20, 3, 0.6],
      '生长 (100节点)': [100, 4, 1.0],
      '繁茂 (500节点)': [500, 5, 1.8],
      '参天 (1000节点)': [1000, 6, 2.5],
    };
    f.add({ p: '种子 (5节点)' }, 'p', Object.keys(presets)).name('快速预设').onChange((v: string) => {
      const [n, d, g] = presets[v] ?? [5, 2, 0.35];
      this.simObj.nodeCount = n;
      this.simObj.maxDepth = d;
      this.simObj.growth = g;
      for (const c of f.controllers) {
        c.updateDisplay();
      }
      this.applySim();
    });

    f.add({ reload: () => this.sm.reloadRealUserData() }, 'reload').name('重新加载真实数据');
  }

  private buildTreeFolder() {
    const f = this.gui.addFolder('树形参数');
    const presetNames = [
      'Ash Small', 'Ash Medium', 'Ash Large',
      'Aspen Small', 'Aspen Medium', 'Aspen Large',
      'Oak Small', 'Oak Medium', 'Oak Large',
      'Pine Small', 'Pine Medium', 'Pine Large',
      'Bush 1', 'Bush 2', 'Bush 3',
    ];
    f.add(this.presetObj, 'preset', presetNames).name('预设').onChange(() => {
      this.sm.loadEzTreePreset(this.presetObj.preset);
    });
  }

  private buildLeafFolder() {
    const f = this.gui.addFolder('树叶');
    f.add(this.texObj, 'texture', { 'Leaves 1': 0, 'Leaves 2': 1, 'Leaves 3': 2 }).name('纹理').onChange((v: number) => {
      this.sm.setLeafTexture(v);
    });
  }

  private buildLightFolder() {
    const f = this.gui.addFolder('光照');
    f.add(this.lightObj, 'azimuth', 0, 360, 1).name('方位角').onChange(() => this.updateLightPos());
    f.add(this.lightObj, 'elevation', 0, 90, 1).name('仰角').onChange(() => this.updateLightPos());
  }

  private buildThemeFolder() {
    const f = this.gui.addFolder('风格');
    const options: Record<string, string> = {};
    for (const s of THEME_STYLES) options[s] = s;
    f.add(this.themeObj, 'style', options).name('主题').onChange((v: string) => {
      this.sm.switchTheme(v);
    });
  }

  private buildPlatformFolder() {
    const f = this.gui.addFolder('前景平台 (Platform)');
    f.add(this.platformObj, 'type', PLATFORM_LABELS).name('平台类型').onChange((v: number) => {
      this.sm.setPlatformType(v);
    });
    f.add(this.platformObj, 'z', 2.0, 5.0, 0.1).name('平台距离').onChange((v: number) => {
      this.sm.setPlatformZ(v);
    });
  }

  private updateLightPos() {
    const az = THREE.MathUtils.degToRad(this.lightObj.azimuth);
    const el = THREE.MathUtils.degToRad(this.lightObj.elevation);
    const dist = 12;
    const x = Math.cos(el) * Math.cos(az) * dist;
    const y = Math.sin(el) * dist;
    const z = Math.cos(el) * Math.sin(az) * dist;
    this.sm.setMainLightPos(x, y, z);
  }

  dispose() {
    this.gui.destroy();
  }
}
