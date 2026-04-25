export const sky2dVertexShader = /* glsl */ `
varying vec2 vScreenUV;

void main() {
  vScreenUV = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const sky2dFragmentShader = /* glsl */ `
uniform vec3 uSkyTopColor;
uniform vec3 uSkyBottomColor;

varying vec2 vScreenUV;

void main() {
  vec3 color = mix(uSkyBottomColor, uSkyTopColor, vScreenUV.y);
  gl_FragColor = vec4(color, 1.0);
}
`;
