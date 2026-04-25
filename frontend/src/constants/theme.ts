import type { ThemeStyle } from '../stores/styleStore';

export interface TreeStyleParams {
  // --- Trunk ---
  trunkBaseColor: [number, number, number];
  trunkMidColor: [number, number, number];
  trunkTipColor: [number, number, number];

  // --- Leaf (soft toon shader) ---
  leafMidColor: [number, number, number];
  leafLightColor: [number, number, number];
  leafDarkColor: [number, number, number];
  leafShadowSize: number;
  leafShadowSoftness: number;
  leafHighlightSize: number;
  leafHighlightSoftness: number;
  leafAlphaClipping: number;
  leafTextureIndex: number;

  // --- Wind ---
  windStrength: number;
  windFrequency: number;
  windScale: number;

  // --- Sky ---
  skyTopColor: [number, number, number];
  skyBottomColor: [number, number, number];

  // --- Ground ---
  groundColor: [number, number, number];
  groundUndulation: number;

  // --- Particles ---
  particleColor: [number, number, number];
  particleShape: number;
  particleSpeed: number;
  particleDirection: number;
  particleSpawnRate: number;
  particleSize: number;

  // --- Lighting ---
  mainLightColor: [number, number, number];
  mainLightIntensity: number;
  ambientLightColor: [number, number, number];
  ambientLightIntensity: number;

  // --- Post-processing ---
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;

  // --- Outline ---
  outlineColor: [number, number, number];
  outlineWidth: number;
}

export const THEME_DEFAULT: TreeStyleParams = {
  trunkBaseColor: [0.35, 0.20, 0.10],
  trunkMidColor: [0.55, 0.35, 0.18],
  trunkTipColor: [0.35, 0.45, 0.25],

  leafMidColor: [0.20, 0.60, 0.40],
  leafLightColor: [0.52, 0.77, 0.32],
  leafDarkColor: [0.05, 0.36, 0.49],
  leafShadowSize: -0.25,
  leafShadowSoftness: 1.0,
  leafHighlightSize: -0.25,
  leafHighlightSoftness: 1.0,
  leafAlphaClipping: 0.5,
  leafTextureIndex: 0,

  windStrength: 0.3,
  windFrequency: 0.4,
  windScale: 0.5,

  skyTopColor: [0.53, 0.81, 0.92],
  skyBottomColor: [0.96, 0.94, 0.92],

  groundColor: [0.36, 0.23, 0.12],
  groundUndulation: 0.3,

  particleColor: [0.4, 0.8, 0.25],
  particleShape: 0,
  particleSpeed: 0.4,
  particleDirection: 1,
  particleSpawnRate: 8,
  particleSize: 1.0,

  mainLightColor: [1.0, 0.95, 0.85],
  mainLightIntensity: 2.5,
  ambientLightColor: [0.6, 0.65, 0.55],
  ambientLightIntensity: 0.5,

  bloomStrength: 0.075,
  bloomRadius: 0.4,
  bloomThreshold: 0.7,

  outlineColor: [0.17, 0.10, 0.05],
  outlineWidth: 0.3,
};

export const THEME_SAKURA: TreeStyleParams = {
  trunkBaseColor: [0.25, 0.18, 0.12],
  trunkMidColor: [0.35, 0.25, 0.18],
  trunkTipColor: [0.40, 0.30, 0.25],

  leafMidColor: [1.0, 0.72, 0.77],
  leafLightColor: [1.0, 0.88, 0.90],
  leafDarkColor: [0.50, 0.20, 0.35],
  leafShadowSize: -0.20,
  leafShadowSoftness: 0.9,
  leafHighlightSize: -0.30,
  leafHighlightSoftness: 0.8,
  leafAlphaClipping: 0.5,
  leafTextureIndex: 2,

  windStrength: 0.25,
  windFrequency: 0.35,
  windScale: 0.45,

  skyTopColor: [1.0, 0.78, 0.84],
  skyBottomColor: [1.0, 0.96, 0.97],

  groundColor: [0.30, 0.20, 0.15],
  groundUndulation: 0.25,

  particleColor: [1.0, 0.72, 0.77],
  particleShape: 1,
  particleSpeed: 0.3,
  particleDirection: 2,
  particleSpawnRate: 12,
  particleSize: 1.25,

  mainLightColor: [1.0, 0.90, 0.80],
  mainLightIntensity: 2.8,
  ambientLightColor: [1.0, 0.85, 0.88],
  ambientLightIntensity: 0.55,

  bloomStrength: 0.15,
  bloomRadius: 0.6,
  bloomThreshold: 0.7,

  outlineColor: [0.20, 0.12, 0.10],
  outlineWidth: 0.25,
};

export const THEME_CYBERPUNK: TreeStyleParams = {
  trunkBaseColor: [0.08, 0.06, 0.15],
  trunkMidColor: [0.12, 0.08, 0.22],
  trunkTipColor: [0.05, 0.20, 0.18],

  leafMidColor: [0.0, 1.0, 0.88],
  leafLightColor: [0.4, 0.0, 1.0],
  leafDarkColor: [0.05, 0.10, 0.30],
  leafShadowSize: -0.30,
  leafShadowSoftness: 0.7,
  leafHighlightSize: -0.15,
  leafHighlightSoftness: 1.2,
  leafAlphaClipping: 0.5,
  leafTextureIndex: 1,

  windStrength: 0.4,
  windFrequency: 0.5,
  windScale: 0.6,

  skyTopColor: [0.04, 0.04, 0.10],
  skyBottomColor: [0.05, 0.10, 0.17],

  groundColor: [0.04, 0.03, 0.08],
  groundUndulation: 0.15,

  particleColor: [0.0, 0.8, 1.0],
  particleShape: 2,
  particleSpeed: 0.6,
  particleDirection: 0,
  particleSpawnRate: 15,
  particleSize: 0.7,

  mainLightColor: [0.5, 0.5, 1.0],
  mainLightIntensity: 2.0,
  ambientLightColor: [0.1, 0.1, 0.4],
  ambientLightIntensity: 0.4,

  bloomStrength: 0.125,
  bloomRadius: 0.2,
  bloomThreshold: 0.7,

  outlineColor: [0.0, 0.3, 0.5],
  outlineWidth: 0.35,
};

export const THEME_INK: TreeStyleParams = {
  trunkBaseColor: [0.15, 0.12, 0.10],
  trunkMidColor: [0.20, 0.18, 0.15],
  trunkTipColor: [0.25, 0.22, 0.18],

  leafMidColor: [0.30, 0.38, 0.25],
  leafLightColor: [0.50, 0.58, 0.45],
  leafDarkColor: [0.10, 0.15, 0.10],
  leafShadowSize: -0.35,
  leafShadowSoftness: 0.8,
  leafHighlightSize: -0.20,
  leafHighlightSoftness: 0.9,
  leafAlphaClipping: 0.5,
  leafTextureIndex: 0,

  windStrength: 0.15,
  windFrequency: 0.3,
  windScale: 0.35,

  skyTopColor: [0.92, 0.90, 0.85],
  skyBottomColor: [0.85, 0.82, 0.75],

  groundColor: [0.55, 0.50, 0.40],
  groundUndulation: 0.35,

  particleColor: [0.15, 0.12, 0.10],
  particleShape: 3,
  particleSpeed: 0.15,
  particleDirection: 3,
  particleSpawnRate: 3,
  particleSize: 0.8,

  mainLightColor: [0.9, 0.88, 0.82],
  mainLightIntensity: 2.2,
  ambientLightColor: [0.6, 0.58, 0.55],
  ambientLightIntensity: 0.6,

  bloomStrength: 0.0125,
  bloomRadius: 0.1,
  bloomThreshold: 0.85,

  outlineColor: [0.10, 0.08, 0.06],
  outlineWidth: 0.4,
};

export const THEME_PRESETS: Record<ThemeStyle, TreeStyleParams> = {
  default: THEME_DEFAULT,
  sakura: THEME_SAKURA,
  cyberpunk: THEME_CYBERPUNK,
  ink: THEME_INK,
};
