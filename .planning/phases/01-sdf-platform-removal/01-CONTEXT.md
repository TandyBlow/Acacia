# Phase 1: SDF Platform Removal + Dead Code Cleanup - Context

**Gathered:** 2025-05-05
**Status:** Ready for planning
**Source:** CEO review + eng review discussion

## Phase Boundary

移除所有平台 SDF 代码和相关死代码，使背景只渲染 vista + sky。这是 billboard 方案的前置清理工作。

## Implementation Decisions

### SDF 代码移除
- backgroundRaymarch.ts 的 map() 函数：移除 mapPlatform() 调用，只保留 mapVista()
- map() 返回值从 vec2（distance + materialID）改回 float（只有 distance）
- 所有引用 hitMaterialID / isPlatform 的分支逻辑移除
- SDF_PLATFORMS import 从 backgroundRaymarch.ts 移除

### 文件删除
- sdfPlatforms.ts — 整个文件删除
- triplanarMapping.ts — 整个文件删除（从未被调用的死代码）
- sdfPlatforms.spec.ts — 整个测试文件删除

### BackgroundRenderer 清理
- testFragmentShader 块（行 81-156）— 死代码，从未被使用
- setPlatformType() 方法 — uniform 将不存在
- setPlatformZ() 方法 — uniform 将不存在
- SDF_PLATFORMS import 从 BackgroundRenderer.ts 移除
- TRIPLANAR_MAPPING import 从 BackgroundRenderer.ts 移除

### SdfParamRegistry 清理
- 移除 uPlatformType 条目
- 移除 uPlatformZ 条目

### 保留项（不能删）
- SDF_ARCHITECTURE（sdfArchitecture.ts）— 被 mapSakura.glsl 的 sdTorii 使用
- SDF_PRIMITIVES（sdfPrimitives.ts）— 被所有 vista map 使用
- uCliffTexture uniform — Phase 2 会重命名为 uPlatformTexture

### Claude's Discretion
- map() 返回值类型变更的具体实现方式
- calcNormal/calcAO/softShadow 中对 map() 返回值的适配
- 平台相关着色逻辑（isPlatform 分支）移除后的代码简化

## Canonical References

### Shader 系统
- `.worktrees/phase-01-sdf-background/frontend/src/components/tree/shaders/backgroundRaymarch.ts` — 主 fragment shader
- `.worktrees/phase-01-sdf-background/frontend/src/components/tree/scene/BackgroundRenderer.ts` — 渲染器类
- `.worktrees/phase-01-sdf-background/frontend/src/components/tree/scene/SdfParamRegistry.ts` — uniform 注册

### 测试
- `.worktrees/phase-01-sdf-background/frontend/src/components/tree/__tests__/backgroundRenderer.spec.ts` — 需要更新
- `.worktrees/phase-01-sdf-background/frontend/src/components/tree/__tests__/sdfPlatforms.spec.ts` — 需要删除

## Deferred Ideas

None — Phase 1 是纯删除/清理，无新功能。

---

*Phase: 01-sdf-platform-removal*
*Context gathered: 2025-05-05 via CEO + eng review*
