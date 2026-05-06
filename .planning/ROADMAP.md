# Roadmap: Billboard Platform System

**Created:** 2025-05-05
**Phases:** 3 (coarse granularity)
**Parallelization:** Phase 1 and 2 are sequential (2 depends on 1's cleanup); Phase 3 can partially overlap with Phase 2 (AI 图片生成可以提前做)

## Phase 1: SDF Platform Removal + Dead Code Cleanup

**Goal:** 移除所有平台 SDF 代码和死代码，背景 vista 正常渲染无平台
**Requirements:** CLN-01 ~ CLN-07
**Verification:** `npm run dev` 启动后背景只显示 vista + sky，无平台，无 console error

### Plans

1. **01-01**: 从 map() 移除平台 SDF 调用 + 删除 sdfPlatforms.ts + triplanarMapping.ts
2. **01-02**: 清理 BackgroundRenderer（删除 testFragmentShader、setPlatformType/Z、SdfParamRegistry 条目）+ 删除 sdfPlatforms.spec.ts

### Exit Criteria

- backgroundRaymarch.ts 的 map() 只返回 vistaD
- BackgroundRenderer 无 SDF_PLATFORMS import
- `npx vitest run` 通过（无引用已删除文件的测试）
- 浏览器中背景正常渲染（vista + sky）

---

## Phase 2: Billboard Compositing Pipeline

**Goal:** 在 shader 底部区域实现 billboard 纹理合成，带桶形畸变弧形边界和视差分离
**Requirements:** BIL-01 ~ BIL-07
**Verification:** 用测试纹理（纯色或渐变）验证 UV 映射、弧形边界、视差分离正确

### Plans

1. **02-01**: uCliffTexture → uPlatformTexture 重命名 + 注册新 uniforms（uBarrelK、uPlatformHeight、uPlatformFade、uPlatformTexWidth）
2. **02-02**: shader 合成逻辑实现（桶形畸变边界 + 纹理采样 + alpha 混合 + 视差分离）+ 单元测试

### Shader Spec (locked from eng review)

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

### New Uniforms

| Name | Type | Default | Purpose |
|------|------|---------|---------|
| uBarrelK | float | 0.3 | 桶形畸变系数 |
| uPlatformHeight | float | 0.12 | billboard 占屏幕高度比例 |
| uPlatformFade | float | 0.03 | 底部渐隐宽度 |
| uPlatformTexWidth | float | 2048.0 | 纹理像素宽度 |

### Exit Criteria

- 用测试纹理（红绿渐变）验证 billboard 区域正确显示
- 弧形边界可见（中心高、两端低）
- 鼠标移动时 billboard 固定、远景浮动
- `npx vitest run` 通过

---

## Phase 3: AI Texture Generation + Integration

**Goal:** 生成真实的平台 billboard 图片，去背后接入 shader
**Requirements:** TEX-01 ~ TEX-05
**Verification:** 浏览器中 billboard 显示 AI 生成的弧形阳台/悬崖图片，边缘自然融入背景

### Plans

1. **03-01**: AI 图片生成（gpt-image-1 prompt 设计 + 生成 + rembg 去背）+ 文件替换 + 路径更新
2. **03-02**: 视觉调参（uBarrelK、uPlatformHeight、uPlatformFade 微调）+ 最终验证

### Exit Criteria

- /public/platform-billboard.png 存在且有 alpha 通道
- 浏览器中 billboard 显示真实图片
- 弧形效果自然，两端向底部消失
- 与背景 vista 色调协调

---

## Summary

| Phase | Focus | Plans | Dependencies |
|-------|-------|-------|--------------|
| 1 | SDF 删除 + 清理 | 2 | None |
| 2 | Billboard 合成管线 | 2 | Phase 1 |
| 3 | AI 纹理生成 + 集成 | 2 | Phase 2 |

**Total plans:** 6
**Estimated effort:** Phase 1 (~15min CC), Phase 2 (~20min CC), Phase 3 (~15min CC)

---
*Roadmap created: 2025-05-05*
*Last updated: 2025-05-05 after CEO review + eng review*
