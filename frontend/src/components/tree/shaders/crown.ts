import { SIMPLEX_3D } from './glslNoise';

export const crownVertexShader = SIMPLEX_3D + /* glsl */ `
uniform float uTime;
uniform float uWindStrength;
uniform float uWindFrequency;
uniform float uWindScale;

varying vec2 vUv;
varying vec3 vNormal;

void main() {
  vUv = uv;
  vec3 pos = position;

  // Wind sway: top of leaf (uv.y=1) sways more than base (uv.y=0)
  float windNoise = snoise(vec3(
    pos.x * uWindFrequency + uTime * uWindScale,
    pos.y * uWindFrequency,
    pos.z * uWindFrequency + uTime * uWindScale * 0.7
  ));
  pos.x += windNoise * uv.y * uWindStrength;
  pos.z += windNoise * 0.5 * uv.y * uWindStrength;

  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const crownFragmentShader = /* glsl */ `
uniform vec3 uBasisColor;
uniform vec3 uShadowColor;
uniform vec3 uHighlightColor;
uniform sampler2D uAlphaMask;
uniform float uAlphaClipping;
uniform float uShadowSize;
uniform float uShadowSoftness;
uniform float uHighlightSize;
uniform float uHighlightSoftness;
uniform vec3 uLightDir;

varying vec2 vUv;
varying vec3 vNormal;

void main() {
  vec3 normal = normalize(vNormal);

  // Lighting from directional light
  float lighting = dot(normal, normalize(uLightDir));

  // Soft 3-color toon: smoothstep blending (coretoon approach)
  float shadowMask = smoothstep(0.0, uShadowSoftness,
    clamp(-lighting, 0.0, 1.0) + uShadowSize);
  float highlightMask = smoothstep(0.0, uHighlightSoftness,
    clamp(clamp(lighting, 0.0, 1.0) + uHighlightSize, 0.0, 1.0));

  vec3 mixedColor = mix(
    mix(uBasisColor, uShadowColor, shadowMask),
    uHighlightColor, highlightMask
  );

  // Alpha from texture
  float alpha = texture2D(uAlphaMask, vUv).r;
  if (alpha < uAlphaClipping) discard;

  gl_FragColor = vec4(mixedColor, 1.0);
}
`;
