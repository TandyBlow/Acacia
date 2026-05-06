import { SDF_PRIMITIVES } from './sdfPrimitives';
import { SDF_ARCHITECTURE } from './sdfArchitecture';
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
uniform sampler2D uPlatformTexture;

varying vec2 vScreenUV;

${mapDefault}
${mapSakura}
${mapCyberpunk}
${mapInk}

float map(vec3 p) {
  int style = int(uStyleType + 0.5);
  if (style == 1) return mapSakura(p);
  else if (style == 2) return mapCyberpunk(p);
  else if (style == 3) return mapInk(p);
  else return mapDefault(p);
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

// --- Ambient Occlusion (AO) for depth perception ---
// Samples nearby SDF values to detect crevices and concave areas
float calcAO(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.01 + 0.12 * float(i) / 4.0;
    float d = map(p + h * n);
    occ += (h - d) * sca;
    sca *= 0.95;
  }
  return clamp(1.0 - 0.8 * occ, 0.3, 1.0);
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

  // Early sky check: if ray points significantly upward, skip raymarch
  bool isSky = rd.y > 0.25;
  vec3 col;

  if (isSky) {
    col = mix(uSkyBottomColor, uSkyTopColor, vScreenUV.y);
  } else {
    // Raymarch
    float t = 0.0;
    float tMax = uFogDistance + 10.0;
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
      vec3 baseColor;
      vec3 shadowColor;

      if (abs(hitNormal.y) > 0.6) {
        baseColor = uGroundColor;
        shadowColor = uFogColor * 0.7;
      } else {
        baseColor = uGroundColor * 0.9;
        shadowColor = uFogColor * 0.6;
      }

      col = applyToonLighting(hitPos, hitNormal, baseColor, shadowColor);

      float fog = 1.0 - exp(-t * t / (uFogDistance * uFogDistance * 0.5));
      col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
    } else {
      col = mix(uSkyBottomColor, uSkyTopColor, vScreenUV.y);
    }
  }

  // Billboard compositing (barrel distortion arc, uses original vScreenUV — no parallax)
  vec2 bc = vScreenUV - 0.5;
  float br2 = dot(bc, bc);
  vec2 distortedUV = 0.5 + bc * (1.0 + uBarrelK * br2);

  if (distortedUV.y < uPlatformHeight) {
    float uvX = 0.5 + (vScreenUV.x - 0.5) * uResolution.x / uPlatformTexWidth;
    if (uvX >= 0.0 && uvX <= 1.0) {
      float uvY = distortedUV.y / uPlatformHeight;
      vec4 platformSample = texture2D(uPlatformTexture, vec2(uvX, uvY));
      // Fade from top edge of billboard region (not from bottom)
      float distFromTop = uPlatformHeight - distortedUV.y;
      float edgeFade = smoothstep(0.0, uPlatformFade, distFromTop);
      col = mix(col, platformSample.rgb, platformSample.a * edgeFade);
    }
  }

  gl_FragColor = vec4(col, 1.0);
}
`;
