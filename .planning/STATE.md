# Project State: Acacia -- SDF 背景风格视觉引擎

**Last updated:** 2026-04-28
**Current phase:** 1 (planned, ready to execute)
**Overall status:** Ready to execute

## Phase Status

| # | Phase | Status | Started | Completed |
|---|-------|--------|---------|-----------|
| 1 | Camera System & Shader Foundation | Ready to execute | 2026-04-28 | -- |
| 2 | Foreground Platform SDF | Pending | -- | -- |
| 3 | Style Template System | Pending | -- | -- |
| 4 | Style Transition Engine | Pending | -- | -- |
| 5 | Knowledge-Driven Style Triggering | Pending | -- | -- |
| 6 | Time-of-Day System & Particles | Pending | -- | -- |
| 7 | LLM Style Generation | Pending | -- | -- |
| 8 | Error Handling & Performance Hardening | Pending | -- | -- |

## Progress

```
Phase 1 [██████████] 0/6 reqs  Ready to execute (2 plans, 2 waves)
Phase 2 [··········] 0/5 reqs  Pending
Phase 3 [··········] 0/6 reqs  Pending
Phase 4 [··········] 0/7 reqs  Pending
Phase 5 [··········] 0/7 reqs  Pending
Phase 6 [··········] 0/6 reqs  Pending
Phase 7 [··········] 0/4 reqs  Pending
Phase 8 [··········] 0/6 reqs  Pending

Overall: 0/47 requirements complete
```

## Current Position

**Phase:** 1 — Camera System & Shader Foundation (planned)
**Plans:** 2 (01-01, 01-02) in 2 waves
**Status:** Ready to execute — `/gsd-execute-phase 1`

## Accumulated Context

### Key Decisions (from PROJECT.md)
- Styles generated from dimension combinations (not 100 manual configs)
- Style switching driven by knowledge data (not user manual selection)
- Midpoint atomic switch + fog masking for transitions (not SDF mixing or dual raymarch)
- Camera 4-parameter model (yaw fixed at 0, look-distance from pitch)
- Time-of-day based on system real-time clock (not node updated_at)
- Shader files split per vista map function for LLM generation support
- ThemeTransition and shader transition run in parallel on different param domains

### Current Codebase State
- 4 prototype styles (default/sakura/cyberpunk/ink) with working raymarch pipeline
- BackgroundRenderer.ts functional but uses hardcoded camera values (QA ISSUE-001 through 004 pending fix)
- SdfParamRegistry.ts defined but camera params not yet connected to shader uniforms
- ThemeTransition.ts manages tree parameter interpolation (800ms duration)
- Particle system (particle.ts) exists but is commented out in SceneManager.ts
- SDF primitives (sdfPrimitives.ts) and architecture SDFs (sdfArchitecture.ts) exist with torii/pagoda/machiya/skyscraper/hill
- Debug GUI (lil-gui) functional in dev mode
- SceneManager.ts is monolithic (1030 lines) with ~260 lines commented-out ground/particle code
- No automated tests for any scene/background code

### TODOs / Open Items
- Verify fog masking effectiveness for near-field platform (z=2-5) -- may need linear fog instead of exponential
- Content authoring: 2 new vista SDF map functions (mountain + lake, ~20 min each with CC), 5 platform SDFs (~10 min each), 10-15 detail SDFs (~5 min each)
- ~100 template style parameter tuning (~1 min each)
- Mobile progressive degradation implementation details to be decided during Phase 8
- Verify particles don't regress below 60fps after re-enable

### Blockers
- None currently

## Session Continuity

**Last command:** `/gsd-roadmap` (roadmap creation)
**Next command:** User approves roadmap, then `/gsd-plan-phase 1`
**Unfinished work:** None -- roadmap creation is the current task

---

*State initialized: 2026-04-28*
