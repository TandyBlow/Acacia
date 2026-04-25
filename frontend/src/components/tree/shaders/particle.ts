import { NOISE_ALL } from './glslNoise';

export const particleVertexShader = NOISE_ALL + /* glsl */ `
// Per-instance attributes (set once, never updated)
attribute vec4 aRandomSeeds;   // x=drift seed, y=tumble seed, z=birth seed, w=misc seed
attribute float aDriftScale;   // per-instance drift magnitude

// Global uniforms
uniform float uTime;
uniform float uSpawnMinY;
uniform float uSpawnMaxY;
uniform float uGroundY;
uniform float uSpawnCenterX;
uniform float uSpawnHalfWidth;
uniform float uParticleSpeed;
uniform float uParticleDirection;
uniform float uParticleSpawnRate;
uniform float uParticleSize;
uniform float uParticleShape;
uniform float uWindStrength;
uniform float uWindFrequency;
uniform float uWindScale;

// Varyings
varying vec2 vUv;
varying vec3 vNormal;
varying float vAlphaFade;

// Shape-dependent modifiers
void getShapeModifiers(float shape, out float fallSpeedMod, out float tumbleAmount, out float swayAmount) {
  if (shape < 0.5) {
    fallSpeedMod = 1.0;
    tumbleAmount = 1.0;
    swayAmount = 1.0;
  } else if (shape < 1.5) {
    fallSpeedMod = 0.7;
    tumbleAmount = 0.5;
    swayAmount = 1.5;
  } else if (shape < 2.5) {
    fallSpeedMod = 1.4;
    tumbleAmount = 0.2;
    swayAmount = 0.3;
  } else {
    fallSpeedMod = 0.5;
    tumbleAmount = 0.1;
    swayAmount = 0.2;
  }
}

void main() {
  vUv = uv;

  // --- 1. Per-instance constants ---
  float driftSeed  = aRandomSeeds.x;
  float tumbleSeed = aRandomSeeds.y;
  float birthSeed  = aRandomSeeds.z;
  float miscSeed   = aRandomSeeds.w;

  float sizeFactor  = 0.7 + 0.6 * fract(miscSeed * 13.7);
  float speedFactor = 0.7 + 0.6 * fract(miscSeed * 7.31);

  // --- 2. Visibility culling by spawn rate ---
  float visibilityThreshold = uParticleSpawnRate / 15.0;
  if (birthSeed > visibilityThreshold) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // --- 3. Shape modifiers ---
  float fallSpeedMod, tumbleAmount, swayAmount;
  getShapeModifiers(uParticleShape, fallSpeedMod, tumbleAmount, swayAmount);

  // --- 4. Lifecycle phase ---
  float fallDistance = uSpawnMaxY - uGroundY;
  float baseFallSpeed = uParticleSpeed * fallDistance * 0.15;
  float effectiveFallSpeed = baseFallSpeed * speedFactor * fallSpeedMod;
  float effectiveDuration = fallDistance / max(effectiveFallSpeed, 0.001);

  // Stagger births across one full cycle
  float birthOffset = birthSeed * effectiveDuration;
  float age = mod(uTime + birthOffset, effectiveDuration);
  float phase = age / effectiveDuration;

  // --- 5. World Y — linear descent ---
  float worldY = uSpawnMaxY - phase * fallDistance;

  // --- 6. World X — base + direction bias + noise drift ---
  float baseX = uSpawnCenterX + (driftSeed - 0.5) * 2.0 * uSpawnHalfWidth;

  // Direction-dependent horizontal bias
  float dirBiasX = 0.0;
  if (uParticleDirection < 0.5) {
    dirBiasX = (driftSeed - 0.5) * 0.3 * fallDistance * phase;
  } else if (uParticleDirection < 1.5) {
    dirBiasX = -0.15 * fallDistance * phase;
  } else if (uParticleDirection < 2.5) {
    dirBiasX = 0.15 * fallDistance * phase;
  } else {
    dirBiasX = (driftSeed - 0.5) * 0.05 * fallDistance * phase;
  }

  // Noise-driven organic drift
  float driftNoise = snoise(vec2(
    driftSeed * 10.0 + uTime * uWindScale * 0.5,
    phase * 3.0
  ));
  float driftAmount = driftNoise * uWindStrength * aDriftScale * fallDistance * 0.1;

  // Petal shape: add sinusoidal figure-8 drift
  float shapeDrift = 0.0;
  if (uParticleShape > 0.5 && uParticleShape < 1.5) {
    shapeDrift = 0.05 * fallDistance * sin(phase * 6.2832 + driftSeed * 10.0);
  }

  float worldX = baseX + dirBiasX + driftAmount * swayAmount + shapeDrift;

  // --- 7. World Z — small constant random depth ---
  float worldZ = (fract(tumbleSeed * 3.7) - 0.5) * 2.0;

  // --- 8. 3D rotation (tumble) ---
  float tumbleSpeed = 2.0 * tumbleAmount;
  float rotX = snoise(vec3(tumbleSeed * 5.0, uTime * tumbleSpeed * 0.8, 0.0)) * 3.14159;
  float rotY = snoise(vec3(tumbleSeed * 7.0, uTime * tumbleSpeed * 0.6, 1.0)) * 3.14159;
  float rotZ = snoise(vec3(tumbleSeed * 11.0, uTime * tumbleSpeed * 0.4, 2.0)) * 1.5708;

  // Rotation matrices
  float cx = cos(rotX), sx = sin(rotX);
  float cy = cos(rotY), sy = sin(rotY);
  float cz = cos(rotZ), sz = sin(rotZ);

  mat3 rotMX = mat3(1,0,0, 0,cx,sx, 0,-sx,cx);
  mat3 rotMY = mat3(cy,0,-sy, 0,1,0, sy,0,cy);
  mat3 rotMZ = mat3(cz,sz,0, -sz,cz,0, 0,0,1);
  mat3 rotMat = rotMZ * rotMY * rotMX;

  // Scale and rotate the quad
  vec3 localPos = position - vec3(0.5);
  float particleScale = uParticleSize * sizeFactor * 0.15 * fallDistance;
  localPos *= particleScale;
  vec3 rotatedPos = rotMat * localPos;
  vec3 rotatedNormal = rotMat * vec3(0.0, 0.0, 1.0);

  // Final world position
  vec3 worldPos = vec3(worldX, worldY, worldZ) + rotatedPos;

  vNormal = rotatedNormal;

  // --- 9. Fade in/out ---
  float fadeIn = smoothstep(0.0, 0.1, phase);
  float fadeOut = smoothstep(1.0, 0.9, phase);
  vAlphaFade = fadeIn * fadeOut;

  // Cyberpunk shimmer
  if (uParticleShape > 1.5 && uParticleShape < 2.5) {
    vAlphaFade *= 0.7 + 0.3 * (0.5 + 0.5 * sin(uTime * 8.0 + driftSeed * 20.0));
  }

  gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
}
`;

export const particleFragmentShader = /* glsl */ `
uniform vec3 uParticleColor;
uniform vec3 uLightDir;
uniform float uParticleShape;

varying vec2 vUv;
varying vec3 vNormal;
varying float vAlphaFade;

// --- Procedural shape SDFs (centered at p=0, range ~-0.5 to 0.5) ---

float leafSDF(vec2 p) {
  p.y *= 2.0; // elongate
  float t = clamp(p.y + 0.5, 0.0, 1.0);
  float profile = sin(3.14159 * t);
  float width = 0.18 * profile;
  return abs(p.x) - width;
}

float petalSDF(vec2 p) {
  p.y *= 1.8;
  float t = clamp(p.y + 0.5, 0.0, 1.0);
  float profile = sin(3.14159 * t);
  profile *= smoothstep(-0.35, -0.05, p.y); // notch at base
  float width = 0.22 * profile;
  return abs(p.x) - width;
}

float diamondSDF(vec2 p) {
  p *= 1.5;
  return (abs(p.x) + abs(p.y)) - 0.35;
}

float circleSDF(vec2 p) {
  return length(p * vec2(1.0, 1.2)) - 0.22;
}

void main() {
  vec2 p = vUv - 0.5;

  // Select shape by SDF
  float d;
  if (uParticleShape < 0.5) {
    d = leafSDF(p);
  } else if (uParticleShape < 1.5) {
    d = petalSDF(p);
  } else if (uParticleShape < 2.5) {
    d = diamondSDF(p);
  } else {
    d = circleSDF(p);
  }

  // Anti-aliased edge
  float alpha = 1.0 - smoothstep(-0.02, 0.02, d);
  alpha *= vAlphaFade;
  if (alpha < 0.01) discard;

  // 2-tone toon shading
  vec3 normal = normalize(vNormal);
  float lighting = dot(normal, normalize(uLightDir));
  float shadowMask = smoothstep(-0.3, 0.3, lighting);
  vec3 color = uParticleColor * (0.6 + 0.4 * shadowMask);

  // Leaf: center vein line
  if (uParticleShape < 0.5) {
    float vein = 1.0 - smoothstep(0.0, 0.015, abs(p.x));
    float veinMask = smoothstep(-0.4, 0.0, p.y) * smoothstep(0.45, 0.15, p.y);
    color = mix(color, color * 0.45, vein * veinMask * 0.8);
  }

  // Cyberpunk: edge glow
  if (uParticleShape > 1.5 && uParticleShape < 2.5) {
    float edge = 1.0 - smoothstep(-0.01, 0.03, abs(d));
    color += uParticleColor * edge * 1.5;
  }

  // Ink: soft vignette + desaturate
  if (uParticleShape > 2.5) {
    float vignette = smoothstep(0.0, -0.15, d);
    alpha *= 0.6 + 0.4 * vignette;
    float lum = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(color, vec3(lum), 0.3);
  }

  gl_FragColor = vec4(color, alpha);
}
`;
