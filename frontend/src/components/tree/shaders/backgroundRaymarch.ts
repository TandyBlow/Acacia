import { SDF_PRIMITIVES } from './sdfPrimitives';
import { SDF_ARCHITECTURE } from './sdfArchitecture';

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

uniform vec3 uSkyTopColor;
uniform vec3 uSkyBottomColor;
uniform vec3 uFogColor;
uniform vec3 uGroundColor;
uniform float uFogDistance;
uniform float uBuildingDensity;
uniform float uBuildingHeight;
uniform float uSeed;
uniform float uTime;
uniform float uStyleType;
uniform vec2 uResolution;

varying vec2 vScreenUV;

// --- Scene composition (style-dependent map function) ---

// Default style: hills + scattered trees
float mapDefault(vec3 p) {
  float ground = sdPlane(p, vec3(0.0, 1.0, 0.0), 0.5);

  // Rolling hills in the distance
  float hill1 = sdHill(
    p - vec3(-10.0, -5.5, 40.0),
    6.0 + hash11(uSeed + 1.0) * 4.0,
    18.0 + hash11(uSeed + 2.0) * 5.0
  );
  float hill2 = sdHill(
    p - vec3(15.0, -5.0, 50.0),
    4.5 + hash11(uSeed + 3.0) * 3.0,
    15.0 + hash11(uSeed + 4.0) * 4.0
  );
  float hill3 = sdHill(
    p - vec3(0.0, -4.5, 60.0),
    3.0 + hash11(uSeed + 5.0) * 2.5,
    20.0 + hash11(uSeed + 6.0) * 6.0
  );

  float d = ground;
  d = opS(d, hill1, 2.0);
  d = opS(d, hill2, 2.0);
  d = opS(d, hill3, 2.5);
  return d;
}

// Sakura style: Japanese town with torii gate + pagoda
float mapSakura(vec3 p) {
  float ground = sdPlane(p, vec3(0.0, 1.0, 0.0), 0.5);

  // Distant hills
  float hill = sdHill(
    p - vec3(0.0, -4.0, 55.0),
    4.0,
    22.0
  );

  // Torii gate — midground right
  vec3 toriiP = p - vec3(18.0, 0.0, 45.0);
  toriiP = pR(toriiP, -0.3);
  float torii = sdTorii(toriiP);

  // Pagoda — background left
  float pagoda = sdPagoda(p - vec3(-22.0, 0.0, 62.0), 5);

  // Machiya row — midground, repeated
  float townD = 1e10;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float x = -8.0 + fi * 3.5 + hash11(uSeed + 10.0 + fi) * 2.0;
    float z = 35.0 + hash11(uSeed + 20.0 + fi) * 10.0;
    float h = 2.0 + hash11(uSeed + 30.0 + fi) * 1.5;
    vec3 q = p - vec3(x, 0.0, z);
    float house = sdMachiya(q, h);
    townD = min(townD, house);
  }

  float d = ground;
  d = opS(d, hill, 2.0);
  d = min(d, torii);
  d = min(d, pagoda);
  d = min(d, townD);
  return d;
}

// Cyberpunk style: skyscraper city
float mapCyberpunk(vec3 p) {
  float ground = sdPlane(p, vec3(0.0, 1.0, 0.0), 0.5);

  // Ground-level city blocks
  float cityD = 1e10;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float x = -20.0 + fi * 3.8 + hash11(uSeed + 40.0 + fi) * 2.5;
    float z = 25.0 + hash11(uSeed + 50.0 + fi) * 40.0;
    float h = uBuildingHeight * (0.5 + hash11(uSeed + 60.0 + fi) * 0.5);
    float w = 0.8 + hash11(uSeed + 70.0 + fi) * 0.6;
    float ant = hash11(uSeed + 80.0 + fi) > 0.6 ? 1.0 : 0.0;
    vec3 q = p - vec3(x, 0.0, z);
    float bldg = sdSkyscraper(q, h * 7.0, w, ant);
    cityD = min(cityD, bldg);
  }

  // Background towers (taller, further)
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float x = -15.0 + fi * 4.5 + hash11(uSeed + 90.0 + fi) * 3.0;
    float z = 55.0 + hash11(uSeed + 100.0 + fi) * 20.0;
    float h = uBuildingHeight * (0.4 + hash11(uSeed + 110.0 + fi) * 0.6);
    float w = 0.6 + hash11(uSeed + 120.0 + fi) * 0.5;
    float ant = hash11(uSeed + 130.0 + fi) > 0.4 ? 1.0 : 0.0;
    vec3 q = p - vec3(x, 0.0, z);
    float bldg = sdSkyscraper(q, h * 9.0, w, ant);
    cityD = min(cityD, bldg);
  }

  float d = ground;
  d = min(d, cityD);
  return d;
}

// Ink style: minimal distant mountains
float mapInk(vec3 p) {
  float ground = sdPlane(p, vec3(0.0, 1.0, 0.0), 0.5);

  // Distant layered mountain silhouettes
  float mtn1 = sdHill(
    p - vec3(-5.0, -6.0, 40.0),
    7.0 + hash11(uSeed + 140.0) * 3.0,
    25.0 + hash11(uSeed + 141.0) * 5.0
  );
  float mtn2 = sdHill(
    p - vec3(8.0, -5.0, 48.0),
    5.0 + hash11(uSeed + 142.0) * 2.0,
    20.0 + hash11(uSeed + 143.0) * 4.0
  );
  float mtn3 = sdHill(
    p - vec3(-12.0, -5.5, 55.0),
    4.5 + hash11(uSeed + 144.0) * 2.5,
    18.0 + hash11(uSeed + 145.0) * 3.0
  );

  float d = ground;
  d = opS(d, mtn1, 1.5);
  d = opS(d, mtn2, 1.5);
  d = opS(d, mtn3, 2.0);
  return d;
}

// --- Main scene map (dispatches to style-specific map) ---
float map(vec3 p) {
  int style = int(uStyleType + 0.5);

  if (style == 1) return mapSakura(p);
  if (style == 2) return mapCyberpunk(p);
  if (style == 3) return mapInk(p);
  return mapDefault(p);
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
  // Virtual camera — elevated view looking forward
  vec3 ro = vec3(0.0, 2.8, -6.0);
  vec3 lookAt = vec3(0.0, 3.5, 30.0);

  vec3 forward = normalize(lookAt - ro);
  vec3 worldUp = vec3(0.0, 1.0, 0.0);
  vec3 right = normalize(cross(forward, worldUp));
  vec3 up = cross(right, forward);

  float aspect = uResolution.x / uResolution.y;
  vec2 uv = vScreenUV * 2.0 - 1.0;
  uv.x *= aspect;

  float zoom = 1.8;
  vec3 rd = normalize(forward + right * uv.x * zoom + up * uv.y * zoom);

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
    // Determine material color based on hit position and normal
    vec3 baseColor = uGroundColor;
    vec3 shadowColor = uFogColor;

    // Ground gets ground color
    if (abs(hitNormal.y) > 0.6) {
      baseColor = uGroundColor;
      shadowColor = uFogColor * 0.7;
    } else {
      // Vertical surfaces get slightly different treatment
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
