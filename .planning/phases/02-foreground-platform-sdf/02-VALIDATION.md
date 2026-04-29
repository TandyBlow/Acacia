---
phase: 2
slug: foreground-platform-sdf
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-29
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS logic) + manual visual (GLSL shader) |
| **Config file** | `frontend/vitest.config.ts` |
| **Quick run command** | `cd frontend && npx vitest run --reporter=verbose` |
| **Full suite command** | `cd frontend && npx vitest run && npm run build` |
| **Estimated runtime** | ~30 seconds (vitest) + ~15 seconds (build) |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npx vitest run`
- **After every plan wave:** Run `cd frontend && npx vitest run && npm run build`
- **Before `/gsd-verify-work`:** Full suite must be green + manual visual check on platform rendering
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | PLAT-01 | — | N/A | unit | `cd frontend && npx vitest run` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | PLAT-02 | — | N/A | unit | `cd frontend && npx vitest run` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | PLAT-03 | — | N/A | manual | Visual: platform at screen bottom ~5% | N/A | ⬜ pending |
| 02-02-02 | 02 | 1 | PLAT-04 | — | N/A | manual | Visual: 5 platform type switching | N/A | ⬜ pending |
| 02-02-03 | 02 | 2 | PLAT-05 | — | N/A | manual | Visual: detail SDFs on platform surface | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `frontend/src/components/tree/__tests__/sdfPlatforms.spec.ts` — stubs for sdCliff + sdPlatform dispatch
- [ ] `frontend/src/components/tree/__tests__/sdfPrimitives.spec.ts` — verify sdCliff is exported from sdfPrimitives

*Note: Shader GLSL code cannot be unit tested directly. Wave 0 covers TypeScript integration/logic layers only.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Platform rendering at screen bottom | PLAT-03 | GLSL shader output | Open app in browser, verify platform occupies bottom ~5% across all 4 styles |
| Platform type visual identity | PLAT-04 | GLSL shader output | Switch platform type via debug GUI, verify each of 5 types is visually distinct |
| Detail SDF placement | PLAT-05 | GLSL shader output | Verify 2-3 detail objects visible on platform surface per type, no clipping/floating |
| Platform-vista depth layering | PLAT-03 | GLSL shader output | Verify platform reads as foreground layer visually distinct from vista background |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
