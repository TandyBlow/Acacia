# Requirements: Billboard Platform System

**Defined:** 2025-05-05
**Core Value:** 平台视觉效果精确可控，且与背景 vista 自然融合

## v1 Requirements

### Cleanup (CLN)

- [ ] **CLN-01**: 从 backgroundRaymarch.ts 的 map() 移除平台 SDF 调用
- [ ] **CLN-02**: 删除 sdfPlatforms.ts 文件
- [ ] **CLN-03**: 删除 triplanarMapping.ts 文件
- [ ] **CLN-04**: 删除 BackgroundRenderer.ts 里的 testFragmentShader 死代码块
- [ ] **CLN-05**: 删除 setPlatformType() 和 setPlatformZ() 方法
- [ ] **CLN-06**: 删除 sdfPlatforms.spec.ts 测试文件
- [ ] **CLN-07**: 清理 SdfParamRegistry 中 uPlatformType/uPlatformZ 条目

### Billboard Compositing (BIL)

- [ ] **BIL-01**: uCliffTexture 重命名为 uPlatformTexture（全局替换）
- [ ] **BIL-02**: 注册新 uniforms：uBarrelK、uPlatformHeight、uPlatformFade、uPlatformTexWidth
- [ ] **BIL-03**: shader main() 末尾实现桶形畸变边界计算
- [ ] **BIL-04**: shader 实现纹理采样（居中裁剪，基于 uResolution.x / uPlatformTexWidth）
- [ ] **BIL-05**: shader 实现 alpha 混合（底部渐隐 + 边界外透明）
- [ ] **BIL-06**: 视差分离：billboard 采样用原始 vScreenUV，不加 uMouseUV 偏移
- [ ] **BIL-07**: 补充新 uniform 的单元测试（uPlatformTexture 存在、uBarrelK 默认值等）

### AI Texture Pipeline (TEX)

- [ ] **TEX-01**: 使用 gpt-image-1 生成平台图片（wide-angle curved balcony/cliff prompt）
- [ ] **TEX-02**: rembg 去背处理，输出带 alpha 通道的 PNG
- [ ] **TEX-03**: 替换 /public/generated-cliff-texture.png → /public/platform-billboard.png
- [ ] **TEX-04**: BackgroundRenderer 加载路径更新为新文件名
- [ ] **TEX-05**: 视觉验证：billboard 在浏览器中正确显示弧形效果

## v2 Requirements

### Enhanced Transitions

- **TRN-01**: 切换平台变体时 crossfade 过渡（两张纹理 lerp）
- **TRN-02**: 色调微调 uniform（uPlatformTint + uPlatformBrightness）
- **TRN-03**: 多主题平台变体（每个主题对应不同 billboard 图片）

## Out of Scope

| Feature | Reason |
|---------|--------|
| Crossfade 过渡 | 基础管线跑通后再加，不阻塞 v1 |
| 色调 uniform | 先看 AI 生成图原始效果，有问题再迭代 |
| 假树影叠加 | 依赖 AI 生成图自带光照 |
| 多主题变体切换 | 属于后续迭代，v1 只需一张图 |
| Early exit 优化 | 需要底部边缘透明展示远景，不能跳过 raymarch |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CLN-01~07 | Phase 1 | Pending |
| BIL-01~07 | Phase 2 | Pending |
| TEX-01~05 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0

---
*Requirements defined: 2025-05-05*
*Last updated: 2025-05-05 after CEO review + eng review*
