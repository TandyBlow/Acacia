
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

  // --- Text (UI typography, independent from leaf colors) ---
  textPrimaryColor: [number, number, number];
  textHintColor: [number, number, number];

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

  // --- Background (SDF raymarch) ---
  bgCamY: number;
  bgCamPitch: number;
  bgCamZ: number;
  bgFovZoom: number;
  bgGroundY: number;
  bgHillFreq: number;
  bgHillAmp: number;
  bgHillDepth: number;
  bgBldgDepth: number;
  bgBuildingDensity: number;
  bgBuildingHeight: number;
  bgFogDistance: number;
  bgBarrelK: number;
  bgPlatformHeight: number;
  bgPlatformFade: number;
  bgPlatformTexWidth: number;
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

  textPrimaryColor: [0.40, 0.50, 1.00],
  textHintColor: [0.40, 1.00, 0.90],

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

  bgCamY: 2.8,
  bgCamPitch: -0.20,
  bgCamZ: -5.0,
  bgFovZoom: 2.0,
  bgGroundY: -2.0, // Dialed back from -3.5 (invisible) to find the halfway point
  bgHillFreq: 0.3,
  bgHillAmp: 5.0,
  bgHillDepth: 40.0,
  bgBldgDepth: 40.0,
  bgBuildingDensity: 0.5,
  bgBuildingHeight: 4.0,
  bgFogDistance: 60.0,
  bgBarrelK: 0.3,
  bgPlatformHeight: 0.12,
  bgPlatformFade: 0.03,
  bgPlatformTexWidth: 1536.0,
};

export const THEME_PRESETS: Record<string, TreeStyleParams> = {
  default: THEME_DEFAULT,
};
