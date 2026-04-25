import type { TreeStyleParams } from '../../../constants/theme';
import { THEME_PRESETS } from '../../../constants/theme';
import type { ThemeStyle } from '../../../stores/styleStore';

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const TUPLE_KEYS = new Set<string>([
  'trunkBaseColor', 'trunkMidColor', 'trunkTipColor',
  'leafMidColor', 'leafLightColor', 'leafDarkColor',
  'skyTopColor', 'skyBottomColor',
  'groundColor',
  'particleColor',
  'mainLightColor', 'ambientLightColor',
  'outlineColor',
]);

function lerpStyleParams(a: TreeStyleParams, b: TreeStyleParams, t: number): TreeStyleParams {
  const result = {} as Record<string, unknown>;
  for (const key of Object.keys(a)) {
    const va = a[key as keyof TreeStyleParams];
    const vb = b[key as keyof TreeStyleParams];
    if (TUPLE_KEYS.has(key) && Array.isArray(va) && Array.isArray(vb)) {
      result[key] = (va as number[]).map((v, i) => v + ((vb as number[])[i]! - v) * t);
    } else if (typeof va === 'number' && typeof vb === 'number') {
      result[key] = va + (vb - va) * t;
    } else {
      result[key] = va;
    }
  }
  return result as unknown as TreeStyleParams;
}

export class ThemeTransition {
  private current: TreeStyleParams;
  private target: TreeStyleParams;
  private t = 1;
  private startTime = 0;
  private duration = 800;
  private isTransitioning = false;

  constructor(initialStyle: ThemeStyle) {
    this.current = { ...THEME_PRESETS[initialStyle] };
    this.target = { ...THEME_PRESETS[initialStyle] };
  }

  startTransition(newStyle: ThemeStyle) {
    this.current = this.getCurrentInterpolated();
    this.target = { ...THEME_PRESETS[newStyle] };
    this.t = 0;
    this.startTime = performance.now();
    this.isTransitioning = true;
  }

  update(now: number): TreeStyleParams | null {
    if (!this.isTransitioning) return null;
    this.t = Math.min(1, (now - this.startTime) / this.duration);
    const eased = easeInOutCubic(this.t);
    const result = lerpStyleParams(this.current, this.target, eased);
    if (this.t >= 1) this.isTransitioning = false;
    return result;
  }

  getCurrentInterpolated(): TreeStyleParams {
    if (!this.isTransitioning) return { ...this.target };
    const eased = easeInOutCubic(this.t);
    return lerpStyleParams(this.current, this.target, eased);
  }

  get isRunning(): boolean {
    return this.isTransitioning;
  }
}
