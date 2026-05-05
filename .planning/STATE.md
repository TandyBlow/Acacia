# Project State: Billboard Platform System

## Project Reference

See: .planning/PROJECT.md (updated 2025-05-05)

**Core value:** 平台视觉效果精确可控，且与背景 vista 自然融合
**Current focus:** Not started — run `/gsd-plan-phase 1` to begin

## Progress

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: SDF 删除 + 清理 | Not Started | |
| Phase 2: Billboard 合成管线 | Not Started | |
| Phase 3: AI 纹理生成 + 集成 | Not Started | |

## Working Branch

`phase/01-sdf-background-completion` (worktree at `.worktrees/phase-01-sdf-background/`)

## Key Context

- BackgroundRenderer 已有 TextureLoader + uCliffTexture 基础设施
- SDF_ARCHITECTURE（sdTorii）被 mapSakura.glsl 使用，不能删
- 应用层统一加载状态，shader 不需要 fallback
- 桶形畸变方案 B（不用抛物线近似）
- 先完整 raymarch 再覆盖 billboard（PERF-1）

---
*Last updated: 2025-05-05 after project initialization*
