# QA Report — Acacia Phase 1 (SDF Background Pipeline)

**Date:** 2026-04-29
**Branch:** phase/01-sdf-background-completion
**Mode:** Code-level (diff-aware, no running dev server)
**Tier:** Standard
**Duration:** ~15 min

## Branch Changes (vs main)

```
70208b4 test(phase-01): add SdfParamRegistry and ThemeTransition unit tests
58d4737 fix(qa): ISSUE-002 — move uniform declarations before map functions, remove duplicate vScreenUV
b89229b fix(qa): ISSUE-001 — add non-null assertions to SdfParamRegistry.applyParamsToUniforms
296b800 feat(phase-01): integrate SdfParamRegistry into BackgroundRenderer, add mouse parallax JS-side
6153243 feat(phase-01): extract vista map functions to .glsl files, replace hardcoded camera
0489fdb docs(01): create phase plan — 2 plans in 2 waves
```

## Health Score

| Category | Score | Weight | Weighted |
|----------|-------|--------|----------|
| Console | 100 (no errors, build clean) | 15% | 15.0 |
| Links | 100 (N/A — shader code) | 10% | 10.0 |
| Functional | 100 (all 59 tests pass) | 20% | 20.0 |
| Visual | 95 (minor hash seed overlap in GLSL) | 10% | 9.5 |
| UX | 100 (mouse parallax clamped + guarded) | 15% | 15.0 |
| Performance | 95 (per-frame uniform writes during transition) | 10% | 9.5 |
| Content | 100 | 5% | 5.0 |
| Accessibility | 100 (N/A — shader code) | 15% | 15.0 |

**Overall Health Score: 99/100**

## Issues Found

### ISSUE-005 (LOW): GLSL hash seed ranges overlap within map functions

- **Severity:** Low (cosmetic)
- **Category:** Visual
- **Files:** `vista/mapCyberpunk.glsl:7-30`, `vista/mapSakura.glsl:22-30`
- **Description:** The hash11 seed offsets used for different attributes (x position, z position, height) within the same loop intentionally overlap ranges (e.g., `40+fi` for x, `50+fi` for z where fi ranges 0-24 creates overlap at 50-64). This creates minor correlation between position and height jitter — visually imperceptible but technically imprecise.
- **Fix Status:** Deferred (cosmetic, no user-visible impact)
- **Recommendation:** If refactoring, assign non-overlapping seed bands: x=100+fi, z=200+fi, h=300+fi, etc.

### ISSUE-006 (LOW): `#define` directives inside `main()` function body

- **Severity:** Low (cosmetic)
- **Category:** Content
- **Files:** `shaders/backgroundRaymarch.ts:137-138`
- **Description:** `PARALLAX_THRESHOLD` and `PARALLAX_MAX_OFFSET` are defined inside `main()` rather than at the top of the shader. Valid in GLSL but unusual — a reader might miss these definitions when scanning the file top-down.
- **Fix Status:** Deferred (cosmetic, no compilation impact)
- **Recommendation:** Move to file header alongside other constants for readability.

## Requirements Verification

### Plan 01-01 (Shader Side)

| Req | Description | Status |
|-----|-------------|--------|
| ARCH-01 | 4 vista map functions in independent .glsl files | PASS |
| ARCH-01 | backgroundRaymarch.ts imports via `?raw` and assembles | PASS |
| CAM-01 | No hardcoded `ro`, `lookAt`, `zoom` in shader | PASS (verified by test) |
| CAM-02 | Camera pitch negative, `sin(uCamPitch)` downward | PASS |
| CAM-05 | GLSL parallax: PARALLAX_THRESHOLD + smoothstep | PASS |

### Plan 01-02 (JS Side)

| Req | Description | Status |
|-----|-------------|--------|
| CAM-03 | BackgroundRenderer uses `createUniforms()` + `applyParamsToUniforms()` | PASS |
| CAM-04 | bgCam* → shader uniforms data link via SdfParamRegistry | PASS |
| CAM-05 | SceneManager mousemove → updateMouseUV with clamp+isFinite | PASS |
| CAM-05 | Event listener cleanup in disposeScene | PASS |

### Security Verification

| Threat | Mitigation | Status |
|--------|-----------|--------|
| uMouseUV NaN/Infinity injection | `Number.isFinite()` guard, keeps previous valid value | PASS |
| uMouseUV out-of-range values | `Math.max(0, Math.min(1, v))` clamp to [0,1] | PASS |
| Registry parameter tampering | Values from TreeStyleParams (compile-time) | ACCEPT (design) |

### Production Build

```
frontend: vite build — success (21.59s)
PWA service worker: success
No type errors, no shader compilation errors
```

### Test Suite

```
8 test files, 59 tests — all passing
  backgroundLayers.spec.ts     - CAM-01
  backgroundRenderer.spec.ts   - CAM-03, CAM-05
  sdfParamRegistry.spec.ts     - Registry unit tests
  themeTransition.spec.ts      - Transition interpolation
  vistaMaps.spec.ts            - ARCH-01 .glsl import verification
  theme.spec.ts                - CAM-02 bgCamPitch negative
  authStore.spec.ts            - Auth (existing)
  nodeStore.spec.ts            - Node store (existing)
```

## Deferred Issues (from previous QA session, already fixed)

- ISSUE-001: Missing non-null assertions in applyParamsToUniforms → FIXED (`b89229b`)
- ISSUE-002: Duplicate vScreenUV, uniform order → FIXED (`58d4737`)
- ISSUE-003: Hardcoded ground Y in shader → FIXED (merged from previous branch)
- ISSUE-004: paramsFromTheme hardcoded values → RESOLVED (method removed in refactor)

## Summary

Phase 1 implementation is **production-ready**. All 6 requirements (ARCH-01, CAM-01 through CAM-05) verified. Security guards in place. Two new LOW-severity cosmetic findings deferred. Production build and full test suite pass clean.

Health Score: **99/100** (baseline)
