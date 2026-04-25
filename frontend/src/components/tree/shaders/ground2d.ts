export const ground2dVertexShader = /* glsl */ `
varying vec2 vScreenUV;

void main() {
  vScreenUV = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const ground2dFragmentShader = /* glsl */ `
uniform vec3 uGroundColor;
uniform float uGroundLineY;
uniform float uUndulation;
uniform float uTime;

varying vec2 vScreenUV;

float hash(float n) { return fract(sin(n) * 43758.5453123); }

float noise1d(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), f) * 2.0 - 1.0;
}

void main() {
  float y = vScreenUV.y;
  float groundLine = uGroundLineY;

  float contour = groundLine
    + noise1d(vScreenUV.x * 8.0 + uTime * 0.05) * uUndulation * 0.03
    + noise1d(vScreenUV.x * 20.0 + 1.7) * uUndulation * 0.01;

  if (y > contour + 0.005) {
    discard;
  } else if (y > contour - 0.003) {
    gl_FragColor = vec4(uGroundColor * 0.6, 1.0);
  } else {
    gl_FragColor = vec4(uGroundColor, 1.0);
  }
}
`;
