# Roadmap: Acacia -- SDF 背景风格视觉引擎

**Created:** 2026-04-28
**Granularity:** Fine (8 phases)
**Total requirements:** 47 v1
**Project context:** Brownfield -- existing Vue 3 + FastAPI hierarchical note-taking app. The SDF background system is a WIP with 4 prototype styles and basic raymarch pipeline already functional.

---

## Phase Overview

| # | Phase | Goal | REQ-IDs | Success Criteria |
|---|-------|------|---------|------------------|
| 1 | Camera System & Shader Foundation | SDF background renders from camera parameters flowing through the pipeline, with correct downward pitch, mouse-driven parallax, and modular shader files | CAM-01..05, ARCH-01 | 5 |
| 2 | Foreground Platform SDF | A solid foreground platform renders at screen bottom with distinct visual identity per platform type, anchoring the 3-layer depth composition | PLAT-01..05 | 5 |
| 3 | Style Template System | ~100 valid background styles are auto-generated from dimension combinations, each producing a complete TreeStyleParams object ready for shader consumption | TMPL-01..06 | 5 |
| 4 | Style Transition Engine | Style changes produce a smooth 3-second visual transition with fog-masked geometry handoff and no visible popping | TRAN-01..07 | 5 |
| 5 | Knowledge-Driven Style Triggering | Background style changes automatically when user knowledge data crosses defined thresholds, without user interaction | TRIG-01..07 | 5 |
| 6 | Time-of-Day System & Particles | Sky colors and atmosphere shift through a natural dawn-noon-dusk-night cycle based on system clock, with particle effects adding visual life | TOD-01..05, ARCH-02 | 5 |
| 7 | LLM Style Generation | Backend endpoint accepts knowledge data summaries and returns AI-generated, validated TreeStyleParams suitable for the template system | LLM-01..04 | 4 |
| 8 | Error Handling & Performance Hardening | Background system degrades gracefully on all device tiers, meeting frame rate targets while providing usable fallbacks under error conditions | ERR-01..04, ARCH-03, ARCH-04 | 5 |

---

## Phase Details

### Phase 1: Camera System & Shader Foundation
**Goal**: The SDF background renders from camera parameters (uCamY/uCamPitch/uCamZ/uFovZoom uniforms) flowing through the rendering pipeline, with correct downward pitch producing an oblique vista view, and mouse-driven parallax depth on the vista layer. Each vista map function lives in its own .glsl file.

**Depends on**: Nothing (first phase -- builds on existing BackgroundRenderer and SdfParamRegistry)

**Requirements**:
- CAM-01: Shader declares uCamY/uCamPitch/uCamZ/uFovZoom uniforms, replacing hardcoded ro/lookAt/zoom values
- CAM-02: Camera looks downward -- lookAt.y < ro.y, pitch is negative, main view is oblique vista downward
- CAM-03: BackgroundRenderer passes camera params through SdfParamRegistry.applyParamsToUniforms
- CAM-04: Each of the 4 existing styles (default/sakura/cyberpunk/ink) defines bgCam* baseline values with subtle differences in height and pitch
- CAM-05: Shader adds uniform vec2 uMouseUV; vista layer offsets by up to 3% based on mouse position; platform layer unaffected
- ARCH-01: Each vista map function (default/sakura/cyberpunk/ink, plus new ones) lives in its own .glsl file; Vite raw import dynamically combines them into a single shader at build time

**Success Criteria**:
1. Open the app in a browser with debug GUI (lil-gui) visible -- adjusting camera params (height, pitch, Z position, FOV) in realtime produces immediate visible changes in the background composition (sky/vista boundaries shift, zoom level changes)
2. Look at the default view -- the screen shows sky in the upper 45-50%, vista/ground in the middle 40-50%, and the composition looks like a downward-angled view (horizon line is visible near the upper-middle, not centered)
3. Switch between the 4 existing styles (default/sakura/cyberpunk/ink) via the debug GUI or style selector -- each shows a noticeably different camera position (e.g., cyberpunk is lower and closer, ink is higher and further)
4. Move the mouse slowly from left edge to right edge of the screen -- the distant vista layer (hills/buildings) shifts horizontally by a small but visible amount (up to 3%), while the foreground platform area remains completely stationary
5. Inspect the shader source tree -- each vista map function (mapDefault, mapSakura, mapCyberpunk, mapInk) is in its own .glsl file under `frontend/src/components/tree/shaders/vistas/`, and the final shader compiles without errors

**Plans**: 2 plans (Wave 1: Plan 01; Wave 2: Plan 02)

Plans:
- [ ] 01-01-PLAN.md -- Shader Camera Reform + Parallax GLSL: extract vista map functions to .glsl files (ARCH-01), replace hardcoded camera with uniform-driven 4-parameter model (CAM-01), fix pitch direction for downward look (CAM-02), add shader-side parallax GLSL code reading uMouseUV for vista-layer horizontal offset (CAM-05 GLSL side)
- [ ] 01-02-PLAN.md -- SdfParamRegistry Integration + Mouse Parallax JS: refactor BackgroundRenderer to use registry (CAM-03), wire bgCam* data flow from theme to shader (CAM-04), add mouse-driven parallax JS-side uniform writer with security guards (CAM-05 JS side)

---

### Phase 2: Foreground Platform SDF
**Goal**: A solid foreground platform renders at screen bottom with distinct visual identity per platform type, anchoring the 3-layer depth composition (platform foreground / vista midground / sky background). The platform SDF evaluates alongside the vista SDF via `min()` in the main `map()` function.

**Depends on**: Phase 1 (Camera System & Shader Foundation) -- uses uCamY/uCamPitch/uCamZ uniforms for camera-relative platform placement

**Requirements**:
- PLAT-01: Add sdCliff(p, width, height, edgeRound) SDF primitive -- round box + FBM noise on top edge
- PLAT-02: Add sdPlatform(p, type) dispatch function -- routes to 5 platform SDFs by int type
- PLAT-03: Platform placed at camera-relative z≈2-5, occupies screen bottom ~5%
- PLAT-04: 5 platform types: cliff (山崖), viewing-deck (观景台), rooftop (天台), temple-base (寺庙台基), megalith (巨石)
- PLAT-05: 2-3 detail SDFs per platform type placed by hash11 grid-cell hashing

**Success Criteria**:
1. Open the app in a browser -- the default view shows a solid platform (cliff) occupying approximately 5% of the screen bottom, visually distinct from the vista midground
2. Each theme preset shows its mapped platform type (default→cliff, sakura→temple-base, cyberpunk→rooftop, ink→megalith) with visually distinct shapes
3. Detail SDFs (gravel, railings, AC units, stone lanterns, moss patches, etc.) are visible on the platform surface without flickering as the camera moves
4. No visible gap between the platform foreground and the vista background ground -- the 3-layer depth composition reads as continuous
5. Production build (`npm run build`) completes without errors, full test suite passes

**Plans**: 4 plans in 3 waves (Wave 1: Plan 01; Wave 2: Plan 02; Wave 3: Plans 03 + 04 parallel)

Plans:
- [ ] 02-01-PLAN.md -- sdCliff SDF Primitive + Test Foundation: add sdCliff GLSL function to SDF_PRIMITIVES (sdRoundBox + FBM noise displacement), create sdfPrimitives.spec.ts test file (PLAT-01)
- [ ] 02-02-PLAN.md -- Platform SDF Types + Dispatch: create sdfPlatforms.ts with sdPlatform dispatch + 5 platform type SDFs (cliff/viewing-deck/rooftop/temple-base/megalith), create sdfPlatforms.spec.ts test file (PLAT-02, PLAT-04)
- [ ] 02-03-PLAN.md -- Detail SDFs: add 11 detail SDF primitives with hash11 grid-cell placement to sdfPlatforms.ts, extend tests for deterministic placement (PLAT-05)
- [ ] 02-04-PLAN.md -- Map Integration + Uniforms + Visual Checkpoint: import SDF_PLATFORMS into backgroundRaymarch.ts, composite platform into map() via min(vistaD, platformD), register uPlatformType/uPlatformZ in SdfParamRegistry, extend TreeStyleParams + theme presets, human-verify checkpoint for visual verification (PLAT-03)

---
