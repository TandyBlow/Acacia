# Billboard Platform System

## What This Is

将 Acacia 树可视化的 SDF 噪声平台替换为 AI 预生成的 billboard 纹理方案。解决 SDF 平台无法精确控制视觉效果的根本问题（10+ 次 fix commit 仍无法达到设计意图），实现"站在阳台俯瞰"的美学效果。

## Core Value

平台视觉效果精确可控，且与背景 vista 自然融合。

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] 移除 SDF 平台代码，背景 vista 正常渲染
- [ ] Billboard 纹理在 shader 底部区域正确合成
- [ ] 桶形畸变公式产生弧形边界效果
- [ ] 视差分离：billboard 固定，远景随鼠标浮动
- [ ] 纹理宽高比按屏幕像素宽度居中裁剪
- [ ] AI 生成图去背后作为 billboard 纹理加载
- [ ] 死代码清理完成（testFragmentShader、TRIPLANAR_MAPPING、setPlatformType/Z）

### Out of Scope

- Crossfade 过渡（EXP-4）— 基础管线跑通后再加
- 色调 uniform（EXP-5）— 先看 AI 生成图原始效果
- 假树影叠加（EXP-3）— 依赖 AI 生成图自带光照
- 多主题平台变体切换 — 属于后续迭代

## Context

- 工作在 worktree `phase/01-sdf-background-completion` 分支
- BackgroundRenderer 已有 `uCliffTexture` uniform 和 TextureLoader 基础设施
- `backgroundRaymarch.ts` 的 `map()` 函数当前合并 vista SDF 和 platform SDF
- `SDF_ARCHITECTURE`（sdTorii）被 mapSakura.glsl 使用，不能删
- `TRIPLANAR_MAPPING` 从未被调用，是死代码
- 应用层会设计统一加载状态，shader 不需要 fallback

## Constraints

- **Tech stack**: Three.js + GLSL fragment shader，WebGL 1.0 兼容
- **Performance**: billboard 合成在 raymarch 之后覆盖，不做 early exit（需要底部边缘透明展示远景）
- **UV mapping**: 桶形畸变方案 B（`distort = 1.0 + k * r^2`），不用抛物线近似
- **Texture**: AI 生成图 3:1 宽图（~2048x682），rembg 去背

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Billboard in background shader（方案 A） | 架构最自然，性能最好，与现有系统契合度最高 | — Pending |
| 桶形畸变（方案 B） | 比抛物线近似更精确地模拟广角镜头效果 | — Pending |
| 视差分离（EXP-1） | 平台应感觉"固定"，远景才随视差浮动 | — Pending |
| 底部弧形渐隐（EXP-2 修正） | 两端向画面底部消失，模拟广角弧形 | — Pending |
| 先 raymarch 再覆盖（PERF-1） | 底部边缘需要透明展示远景背景 | — Pending |
| uCliffTexture → uPlatformTexture | 语义更准确 | — Pending |

---
*Last updated: 2025-05-05 after CEO review + eng review*
