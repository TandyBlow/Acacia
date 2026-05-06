# Phase 2: Billboard Compositing Pipeline - Context

**Gathered:** 2025-05-05
**Status:** Ready for planning
**Source:** CEO review + eng review discussion

## Phase Boundary

在 shader 底部区域实现 billboard 纹理合成，带桶形畸变弧形边界和视差分离。Phase 1 完成后，shader 只渲染 vista + sky，本 phase 在 main() 末尾加入 billboard 合成逻辑。

## Implementation Decisions

### Uniform 重命名
- uCliffTexture → uPlatformTexture（全局替换，包括 shader 声明、BackgroundRenderer uniform 对象、TextureLoader 回调）

### 新 Uniforms 注册
- uBarrelK: float, default 0.3 — 桶形畸变系数
- uPlatformHeight: float, default 0.12 — billboard 占屏幕高度比例
- uPlatformFade: float, default 0.03 — 底部渐隐宽度
- uPlatformTexWidth: float, default 2048.0 — 纹理像素宽度

### Shader 合成逻辑（锁定规格）
```glsl
// 在 main() 最后，gl_FragColor 输出前：

// 1. 桶形畸变：计算 billboard 边界
vec2 c = vScreenUV - 0.5;
float r2 = dot(c, c);
float distort = 1.0 + uBarrelK * r2;
vec2 distortedUV = 0.5 + c * distort;

// 2. billboard 区域判断
bool inBillboard = distortedUV.y < uPlatformHeight;

// 3. 纹理采样（用原始 vScreenUV，不用视差偏移 UV）
float uvX = 0.5 + (vScreenUV.x - 0.5) * uResolution.x / uPlatformTexWidth;
float uvY = distortedUV.y / uPlatformHeight;
vec4 platformSample = texture2D(uPlatformTexture, vec2(uvX, uvY));

// 4. 底部渐隐
float edgeFade = smoothstep(0.0, uPlatformFade, distortedUV.y);
float alpha = platformSample.a * edgeFade * float(inBillboard) * float(uvX >= 0.0 && uvX <= 1.0);

// 5. 合成
gl_FragColor = vec4(mix(col, platformSample.rgb, alpha), 1.0);
```

### 视差分离（EXP-1）
- billboard 采样用原始 `vScreenUV`（不加 uMouseUV 偏移）
- 背景 vista 继续用偏移后的 UV（现有行为不变）
- 效果：鼠标移动时远景浮动，billboard 固定

### 渲染顺序（PERF-1）
- 先完整 raymarch 得到 `col`
- 再在 main() 末尾对底部区域覆盖 billboard
- 不做 early exit（底部边缘需要透明展示远景）

### Claude's Discretion
- 新 uniforms 是否通过 SdfParamRegistry 注册还是直接在 material 里声明
- 测试纹理的具体内容（用于验证 UV 映射正确性）

## Canonical References

### Shader 系统（Phase 1 清理后的状态）
- `frontend/src/components/tree/shaders/backgroundRaymarch.ts` — 主 fragment shader
- `frontend/src/components/tree/scene/BackgroundRenderer.ts` — 渲染器类
- `frontend/src/components/tree/scene/SdfParamRegistry.ts` — uniform 注册

## Deferred Ideas

- Crossfade 过渡（v2）
- 色调微调 uniform（v2）

---

*Phase: 02-billboard-compositing*
*Context gathered: 2025-05-05 via CEO + eng review*
