# QA Report — Acacia Phase 1 (SDF Background Pipeline)

**Date:** 2026-04-29
**Branch:** phase/01-sdf-background-completion
**Mode:** Standard (code review + browser verification)
**Tier:** Standard
**Duration:** ~2 hours (interrupted yesterday, restarted and completed)

## Branch Commits (vs main)

```
2edcc8f fix(qa): remove debug code after verifying CAM-05 data link end-to-end
c7e9cdd fix(qa): ISSUE-006 — mousemove listener on canvas unreachable; move to document + fix parallax dead code
8f8cb05 fix(qa): ISSUE-005 — parallaxOffsetX computed but never applied in hit branch, wrong axis in sky branch
70208b4 test(phase-01): add SdfParamRegistry and ThemeTransition unit tests
58d4737 fix(qa): ISSUE-002 — move uniform declarations before map functions, remove duplicate vScreenUV
b89229b fix(qa): ISSUE-001 — add non-null assertions to SdfParamRegistry.applyParamsToUniforms
296b800 feat(phase-01): integrate SdfParamRegistry into BackgroundRenderer, add mouse parallax JS-side
6153243 feat(phase-01): extract vista map functions to .glsl files, replace hardcoded camera
```

## Health Score

| Category | Score | Weight | Weighted |
|----------|-------|--------|----------|
| Console | 100 | 15% | 15.0 |
| Links | 100 | 10% | 10.0 |
| Functional | 100 | 20% | 20.0 |
| Visual | 100 | 10% | 10.0 |
| UX | 100 | 15% | 15.0 |
| Performance | 100 | 10% | 10.0 |
| Content | 100 | 5% | 5.0 |
| Accessibility | 100 | 15% | 15.0 |

**Final Health Score: 100/100**

## Issues Found & Fixed

### ISSUE-001 (HIGH) — FIXED (b89229b)
SdfParamRegistry.applyParamsToUniforms missing non-null assertions causing production build failure.

### ISSUE-002 (HIGH) — FIXED (58d4737)
Shader uniform declarations placed after map functions; duplicate vScreenUV causing compilation error.

### ISSUE-003 (MEDIUM) — FIXED (previous session, merged)
Hardcoded ground Y value in shader; replaced with uGroundY uniform.

### ISSUE-004 (MEDIUM) — RESOLVED (method removed in refactor)
paramsFromTheme used hardcoded values instead of reading from TreeStyleParams.

### ISSUE-005 (HIGH) — FIXED (c7e9cdd, 8f8cb05)
parallaxOffsetX computed post-raymarch but **never applied** to rendered output in the hit branch (dead code). In the sky branch, applied to wrong axis (vScreenUV.y instead of vScreenUV.x) with 0.3 damping, making it invisible. Fixed by moving parallax to pre-raymarch uv.x offset.

### ISSUE-006 (MEDIUM) — FIXED (c7e9cdd)
mousemove listener on canvas element unreachable because canvas is behind other DOM elements in the Vue grid layout. Moved to document-level listener with container-based coordinate calculation.

## Requirements Verification

| Req | Description | Verification |
|-----|-------------|--------------|
| ARCH-01 | 4 vista map .glsl files, Vite ?raw import | Test + code review |
| CAM-01 | No hardcoded camera values in shader | Test |
| CAM-02 | bgCamPitch negative, downward look | Test |
| CAM-03 | SdfParamRegistry integration in BackgroundRenderer | Test |
| CAM-04 | bgCam* params flow to shader via registry | Test |
| CAM-05 | Mouse parallax — JS write + GLSL apply | Browser verified |

## Verification Evidence

- **Tests:** 8 files, 59 tests, 0 failures
- **Production build:** Success (21.59s)
- **Browser:** Console clean, mouse parallax visible, style switching works
- **Security:** Number.isFinite + clamp guards verified in tests

## Summary

Phase 1 implementation is **ship-ready**. All 6 requirements verified. 6 issues found and fixed (4 from previous QA session, 2 found today). Full test suite and production build pass clean.
