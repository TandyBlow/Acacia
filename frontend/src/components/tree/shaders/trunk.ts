import { NOISE_ALL, SIMPLEX_3D } from './glslNoise';

export const trunkVertexShader = SIMPLEX_3D + /* glsl */ `
uniform float uDisplacementIntensity;
uniform float uNoiseScale;
uniform float uCreationDensity;
uniform float uTime;

varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  vNormal = normalize(normalMatrix * normal);

  float noise = snoise(position * uNoiseScale + vec3(0.0, uTime * 0.01, 0.0));
  float densityFactor = 0.3 + 0.7 * uCreationDensity;
  vec3 displaced = position + normal * noise * uDisplacementIntensity * densityFactor;

  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
  vWorldPos = worldPos.xyz;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

export const trunkFragmentShader = NOISE_ALL + /* glsl */ `
uniform vec3 uBaseColor;
uniform vec3 uMidColor;
uniform vec3 uTipColor;
uniform float uNoiseContrast;
uniform float uNoiseScaleLow;
uniform float uNoiseScaleHigh;
uniform float uCreationDensity;
uniform vec3 uMainLightDir;
uniform vec3 uMainLightColor;
uniform float uMainLightIntensity;
uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;
uniform float uMinY;
uniform float uMaxY;

varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  float normalizedY = clamp((vWorldPos.y - uMinY) / max(uMaxY - uMinY, 1.0), 0.0, 1.0);

  vec3 baseColor = mix(uBaseColor, uMidColor, smoothstep(0.0, 0.5, normalizedY));
  baseColor = mix(baseColor, uTipColor, smoothstep(0.7, 1.0, normalizedY));

  float grain1 = snoise(vec2(vWorldPos.x * uNoiseScaleLow, vWorldPos.y * uNoiseScaleLow * 0.3));
  float grain2 = snoise(vec2(vWorldPos.x * uNoiseScaleHigh, vWorldPos.y * uNoiseScaleHigh * 0.5));

  float densityFactor = 0.5 + 0.5 * uCreationDensity;
  float grain = grain1 * 0.7 + grain2 * 0.3;
  vec3 color = baseColor * (1.0 - uNoiseContrast * densityFactor + uNoiseContrast * densityFactor * (0.5 + 0.5 * grain));

  vec3 normal = normalize(vNormal);
  float diffuse = max(dot(normal, normalize(uMainLightDir)), 0.0);

  // Cel shading: 3-step quantization
  float cel = diffuse < 0.3 ? 0.4 : (diffuse < 0.7 ? 0.7 : 1.0);
  vec3 lit = color * uAmbientColor * uAmbientIntensity + color * uMainLightColor * uMainLightIntensity * cel;

  gl_FragColor = vec4(lit, 1.0);
}
`;
