# Phase 3: AI Texture Generation + Integration - Context

**Gathered:** 2025-05-05
**Status:** Ready for planning
**Source:** CEO review + eng review discussion

## Phase Boundary

生成真实的平台 billboard 图片，去背后接入 shader。Phase 2 完成后 shader 合成管线已就绪（用测试纹理验证过），本 phase 替换为真实 AI 生成图并调参。

## Implementation Decisions

### AI 图片生成
- 使用 gpt-image-1 API 生成
- Prompt 要点：wide-angle lens, looking down from balcony edge, curved perspective, natural stone/wood railing, lush vegetation below
- 输出尺寸：2048x682（3:1 宽图）
- 风格：与 Acacia 的插画风格一致（soft illustration, warm tones）

### 去背处理
- 使用 rembg（Python CLI）或 background-removal-js
- 输入：AI 生成的原始图
- 输出：带 alpha 通道的 PNG（主体保留，背景透明）
- 如果 rembg 效果不好，备选 BEN2

### 文件路径
- 输出文件：`/public/platform-billboard.png`
- BackgroundRenderer 加载路径已在 Phase 2 更新为此路径

### 调参
- uBarrelK：调整弧度（0.1~0.8 范围试验）
- uPlatformHeight：调整 billboard 占屏幕比例（0.08~0.2 范围）
- uPlatformFade：调整底部渐隐宽度（0.01~0.05 范围）
- 目标：弧形自然，两端向底部消失，与远景色调协调

### Claude's Discretion
- 具体 prompt 措辞的迭代
- 去背工具的选择（rembg vs background-removal-js vs BEN2）
- 调参的具体数值（视觉判断）

## Canonical References

### 现有纹理加载
- `frontend/src/components/tree/scene/BackgroundRenderer.ts` — TextureLoader 代码
- `frontend/public/` — 静态资源目录

## Deferred Ideas

- 多主题变体（每个主题不同的 billboard 图片）— v2
- 色调微调 uniform — v2

---

*Phase: 03-ai-texture-integration*
*Context gathered: 2025-05-05 via CEO + eng review*
