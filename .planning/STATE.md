# Project State: Billboard Platform System

## Project Reference

See: .planning/PROJECT.md

**Core value:** 平台视觉效果精确可控，且与背景 vista 自然融合
**Current focus:** Phase 3 纹理加载已修复，待合并到 main 后进行视觉调参

## Progress

| Phase | Status | Branch Commit | Notes |
|-------|--------|---------------|-------|
| Phase 1: SDF 删除 + 清理 | ✅ Done | d61d714 | 移除 SDF 平台代码，替换为 billboard-ready shader |
| Phase 2: Billboard 合成管线 | ✅ Done | 1243cdf | 桶形畸变 + 视差分离 + alpha 混合 |
| Phase 3: AI 纹理生成 + 集成 | ✅ Done | 4f413b7 | AI 纹理 + 去背 + TextureLoader 接入 + texWidth 修正为 1536 |

## Working Branch

`feat/billboard-platform` (was `phase/01-sdf-background-completion`)

## Key Context

- BackgroundRenderer 使用 TextureLoader 异步加载 /platform-billboard.png
- 实际纹理尺寸 1536×1024，uPlatformTexWidth 已修正为 1536.0
- SDF_ARCHITECTURE（sdTorii）被 mapSakura.glsl 使用，不能删
- 桶形畸变方案 B（不用抛物线近似）
- 先完整 raymarch 再覆盖 billboard（PERF-1）

## Next Steps

- 合并 `feat/billboard-platform` 到 main
- 视觉调参（uBarrelK、uPlatformHeight、uPlatformFade 微调）— Plan 03-02
- 与背景 vista 色调协调验证

---
*Last updated: 2026-05-06*
