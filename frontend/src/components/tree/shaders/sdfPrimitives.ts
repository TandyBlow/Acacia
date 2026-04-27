// SDF primitives for raymarching — based on Inigo Quilez's reference implementations
// https://iquilezles.org/articles/distfunctions/

export const SDF_PRIMITIVES = /* glsl */ `

// --- Basic 3D primitives ---

float sdPlane(vec3 p, vec3 n, float h) {
  return dot(p, n) + h;
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdCylinder(vec3 p, float r, float h) {
  float d = length(p.xz) - r;
  return max(d, abs(p.y) - h);
}

float sdCone(vec3 p, float r1, float r2, float h) {
  vec2 q = vec2(length(p.xz), p.y);
  vec2 k1 = vec2(r2, h);
  vec2 k2 = vec2(r2 - r1, 2.0 * h);
  vec2 ca = vec2(q.x - min(q.x, (q.y < 0.0) ? r1 : r2), abs(q.y) - h);
  vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}

float sdCappedCylinder(vec3 p, float r, float h) {
  float d = length(p.xz) - r;
  return max(d, abs(p.y) - h);
}

float sdTorus(vec3 p, float r1, float r2) {
  vec2 q = vec2(length(p.xz) - r1, p.y);
  return length(q) - r2;
}

// --- Boolean operations ---

float opU(float d1, float d2) {
  return min(d1, d2);
}

float opS(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

float opSU(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

// --- Domain repetition ---

vec3 pMod3(vec3 p, vec3 c) {
  return mod(p + 0.5 * c, c) - 0.5 * c;
}

vec3 pModInterval(vec3 p, float spacing) {
  return pMod3(p, vec3(spacing));
}

// --- Transformations ---

vec3 pR(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
}

// --- Hash (for per-instance variation) ---

float hash11(float n) {
  return fract(sin(n) * 43758.5453123);
}

float hash12(vec2 p) {
  float h = dot(p, vec2(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

float hash13(vec3 p) {
  float h = dot(p, vec3(127.1, 311.7, 74.7));
  return fract(sin(h) * 43758.5453123);
}

// Smooth hash returning a full vec2
vec2 hash22(vec2 p) {
  vec2 h = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(h) * 43758.5453123);
}

// --- FBM noise for organic shapes ---

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  const int octaves = 4;

  for (int i = 0; i < octaves; i++) {
    value += amplitude * hash12(p * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}
`;
