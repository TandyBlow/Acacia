---
phase: 01
slug: camera-system-shader-foundation
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-28
completed: 2026-04-29
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.4 |
| **Config file** | vite.config.ts (vitest 集成) |
| **Quick run command** | `cd frontend && npx vitest run` |
| **Full suite command** | `cd frontend && npx vitest run` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npx vitest run`
- **After every plan wave:** Run `cd frontend && npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | CAM-01 | — | N/A | unit | `npx vitest run src/components/tree/__tests__/sdfParamRegistry.spec.ts` | ✅ | ✅ green |
| 01-01-02 | 01 | 1 | CAM-01 | — | N/A | unit | `npx vitest run src/components/tree/__tests__/backgroundLayers.spec.ts` | ✅ | ✅ green |
| 01-01-03 | 01 | 1 | CAM-02 | — | N/A | unit | `npx vitest run src/constants/__tests__/theme.spec.ts` | ✅ | ✅ green |
| 01-01-04 | 01 | 1 | CAM-03 | T-1-01 | uMouseUV clamped to [0,1], Number.isFinite guard | unit | `npx vitest run src/components/tree/__tests__/sdfParamRegistry.spec.ts` | ✅ | ✅ green |
| 01-02-01 | 01 | 2 | CAM-03 | T-1-01 | uMouseUV clamped to [0,1], Number.isFinite guard | unit | `npx vitest run src/components/tree/__tests__/backgroundRenderer.spec.ts` | ✅ | ✅ green |
| 01-02-02 | 01 | 2 | CAM-04 | — | N/A | unit | `npx vitest run src/constants/__tests__/theme.spec.ts` | ✅ | ✅ green |
| 01-03-01 | 01 | 2 | CAM-05 | T-1-01 | uMouseUV clamped to [0,1], Number.isFinite guard | unit | `npx vitest run src/components/tree/__tests__/backgroundRenderer.spec.ts` | ✅ | ✅ green |
| 01-04-01 | 01 | 3 | ARCH-01 | — | N/A | unit | `npx vitest run src/components/tree/__tests__/vistaMaps.spec.ts` | ✅ | ✅ green |
| 01-04-02 | 01 | 3 | ARCH-01 | — | N/A | unit | `npx vitest run src/components/tree/__tests__/backgroundLayers.spec.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `frontend/src/components/tree/__tests__/backgroundRenderer.spec.ts` — 覆盖 CAM-03、CAM-05（BackgroundRenderer 集成测试）
- [x] `frontend/src/components/tree/__tests__/vistaMaps.spec.ts` — 覆盖 ARCH-01（.glsl 文件可导入 + 内容验证）
- [x] 扩展 `backgroundLayers.spec.ts` — 添加 CAM-01 断言（无硬编码 ro/lookAt/zoom）
- [x] 扩展 `theme.spec.ts` — 添加 CAM-02 断言（bgCamPitch 必须为负）
- [x] 无需框架安装 — Vitest 已配置

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 相机俯视视觉正确性 | CAM-02 | 视觉输出无法自动化 | 打开 app，检查默认视角是否呈现向下俯瞰（地平线在上部1/2处） |
| 鼠标视差深度效果 | CAM-05 | 鼠标交互效果需视觉确认 | 左右移动鼠标，观察远景层是否有可见的水平偏移 |
| Shader 编译无错误 | ARCH-01 | 编译结果需浏览器验证 | 浏览器 console 无 shader 编译错误 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 2s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved — 2026-04-29 (QA passed, 59/59 tests green, production build clean)
