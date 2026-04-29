import { SDF_PRIMITIVES } from './sdfPrimitives';
import { SDF_ARCHITECTURE } from './sdfArchitecture';
import { SDF_PLATFORMS } from './sdfPlatforms';
import mapDefault from './vista/mapDefault.glsl?raw';
import mapSakura from './vista/mapSakura.glsl?raw';
import mapCyberpunk from './vista/mapCyberpunk.glsl?raw';
import mapInk from './vista/mapInk.glsl?raw';
import { generateGlslUniforms } from '../scene/SdfParamRegistry';

export const backgroundVertexShader = /* glsl */ `
varying vec2 vScreenUV;

void main() {
  vScreenUV = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const backgroundFragmentShader = /* glsl */ `
${SDF_PRIMITIVES}
${SDF_ARCHITECTURE}
${generateGlslUniforms()}
uniform vec3 uFogColor;
uniform float uTime;
uniform float uSeed;
uniform float uStyleType;
uniform vec2 uResolution;
uniform vec2 uMouseUV;
${SDF_PLATFORMS}

varying vec2 vScreenUV;

${mapDefault}
${mapSakura}
${mapCyberpunk}
${mapInk}

// --- Main scene map (dispatches to style-specific map + platform SDF) ---
float map(vec3 p) {
  int style = int(uStyleType + 0.5);

  // Vista SDF dispatch (existing Phase 1 behavior)
  float vistaD;
  if (style == 1) vistaD = mapSakura(p);
  else if (style == 2) vistaD = mapCyberpunk(p);
  else if (style == 3) vistaD = mapInk(p);
  else vistaD = mapDefault(p);

  // Platform SDF (PLAT-03) — only for points well below the camera
  float platformD = 1e10;
  if (p.y < uCamY - 0.5) {
    vec3 ro = vec3(0.0, uCamY, uCamZ);
    vec3 forward = normalize(vec3(0.0, sin(uCamPitch), cos(uCamPitch)));
    vec3 platformOrigin = ro + forward * uPlatformZ;
    platformOrigin.y -= 2.5;
    platformD = sdPlatform(p - platformOrigin, uPlatformType);
  }

  return min(vistaD, platformD);
}

// --- Normal computation from SDF gradient ---
vec3 calcNormal(vec3 p) {
  const float eps = 0.005;
  vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * map(p + k.xyy * eps) +
    k.yyx * map(p + k.yyx * eps) +
    k.yxy * map(p + k.yxy * eps) +
    k.xxx * map(p + k.xxx * eps)
  );
}

// --- Toon shading ---
vec3 applyToonLighting(vec3 p, vec3 normal, vec3 baseColor, vec3 shadowColor) {
  // Light direction — slightly above and to the right
  vec3 lightDir = normalize(vec3(0.6, 0.8, 0.4));

  float NdotL = dot(normal, lightDir);

  // Two-level toon: bright side and shadow side
  float shade = smoothstep(-0.05, 0.05, NdotL);

  // Soft ambient term so shadows aren't pure black
  float ambient = 0.35;

  return mix(shadowColor * ambient, baseColor, shade + ambient * 0.3);
}

// --- Soft shadow ---
float softShadow(vec3 ro, vec3 rd, float maxDist) {
  float res = 1.0;
  float t = 0.05;
  for (int i = 0; i < 20; i++) {
    float h = map(ro + rd * t);
    if (h < 0.001) return 0.2;
    res = min(res, 8.0 * h / t);
    t += h;
    if (t > maxDist) break;
  }
  return clamp(res, 0.2, 1.0);
}

// --- Main ---
void main() {
  // Camera position from uniforms
  vec3 ro = vec3(0.0, uCamY, uCamZ);

  // Forward direction from pitch (yaw fixed at 0)
  // uCamPitch < 0 → sin(uCamPitch) < 0 → forward.y < 0 → looking downward (CAM-02)
  vec3 forward = normalize(vec3(0.0, sin(uCamPitch), cos(uCamPitch)));

  // Camera basis vectors
  vec3 worldUp = vec3(0.0, 1.0, 0.0);
  vec3 right = normalize(cross(forward, worldUp));
  vec3 up = cross(right, forward);

  float aspect = uResolution.x / uResolution.y;
  vec2 uv = vScreenUV * 2.0 - 1.0;
  uv.x *= aspect;

  // CAM-05: Mouse parallax — horizontal view shift for background
  uv.x += (uMouseUV.x - 0.5) * 0.06;

  // Ray direction with FOV zoom
  vec3 rd = normalize(forward + right * uv.x * uFovZoom + up * uv.y * uFovZoom);

  // Raymarch
  float t = 0.0;
  float tMax = uFogDistance + 10.0;
  vec3 col = vec3(0.0);
  bool hit = false;
  vec3 hitPos = vec3(0.0);
  vec3 hitNormal = vec3(0.0, 1.0, 0.0);

  for (int i = 0; i < 80; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);

    if (d < 0.001) {
      hit = true;
      hitPos = p;
      hitNormal = calcNormal(p);
      break;
    }

    t += max(d * 0.8, 0.02);

    if (t > tMax) break;
  }

  if (hit) {
    // Compute platform origin (same as map()) to detect platform hits
    vec3 platformOrigin = ro + forward * uPlatformZ;
    platformOrigin.y -= 2.5;
    float platformDist = sdPlatform(hitPos - platformOrigin, uPlatformType);
    bool isPlatform = platformDist < 0.05;

    vec3 baseColor;
    vec3 shadowColor;

    if (isPlatform) {
      // DEBUG: Bright magenta for platform visibility
      baseColor = vec3(0.9, 0.15, 0.7);
      shadowColor = vec3(0.5, 0.05, 0.35);
    } else if (abs(hitNormal.y) > 0.6) {
      baseColor = uGroundColor;
      shadowColor = uFogColor * 0.7;
    } else {
      baseColor = uGroundColor * 0.9;
      shadowColor = uFogColor * 0.6;
    }

    // Apply toon lighting
    col = applyToonLighting(hitPos, hitNormal, baseColor, shadowColor);

    // Apply soft shadow
    vec3 shadowRd = normalize(vec3(0.6, 0.8, 0.4));
    float shadow = softShadow(hitPos + hitNormal * 0.02, shadowRd, 10.0);
    col *= shadow;
  } else {
    // Sky — vertical gradient
    col = mix(uSkyBottomColor, uSkyTopColor, vScreenUV.y);
  }

  // Exponential fog
  float fog = 1.0 - exp(-t / uFogDistance);
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`;
