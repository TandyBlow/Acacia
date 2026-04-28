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

**Plans**: TBD

---

### Phase 2: Foreground Platform SDF
**Goal**: A solid foreground platform renders at the bottom ~5% of the screen with a distinct visual silhouette per platform type (cliff, observation deck, rooftop, temple base, boulder), including decorative detail objects at deterministic positions. The platform anchors the 3-layer depth composition -- the tree stands on this platform.

**Depends on**: Phase 1 (platform placement relies on camera params flowing to shader)

**Requirements**:
- PLAT-01: New sdCliff(p, width, height, edgeRound) SDF primitive for cliff/ledge geometry
- PLAT-02: New sdPlatform(p, type) dispatch function routing to the correct platform SDF by type
- PLAT-03: Platform placed at camera-forward z=2-5 distance, occupying screen bottom ~5%
- PLAT-04: 5 complete platform SDF types -- cliff (山崖), observation deck (观景台), rooftop (天台), temple base (寺庙台基), boulder (巨石)
- PLAT-05: Each platform type has 2-3 small detail SDFs (railing, rock debris, AC unit, grass cluster, stone lantern, etc.) placed at deterministic positions via hash11

**Success Criteria**:
1. Open the app at 1920x1080 resolution -- the platform is clearly visible at the very bottom of the screen as a solid foreground element. Resize the browser to 1366x768 and then to 375x667 (mobile width) -- the platform still occupies approximately bottom 5% of the viewport in each case
2. Using the debug GUI to cycle through platformType values (0-4) -- five distinctly recognizable silhouettes render: a rugged cliff edge, a flat railed observation deck, a building rooftop with parapet, a temple base with stone steps, and a rounded boulder outcrop
3. Observe the platform edge at close range -- small detail objects are visible at fixed positions that do not move or flicker between frames. The detail objects are appropriate to the platform type (e.g., railing + gravel on observation deck, AC unit + exhaust pipe on rooftop)
4. Switch between all 4 existing styles -- the platform is visible in each style's background. The platform color/material shifts match the style's groundColor parameter

**Plans**: TBD

---

### Phase 3: Style Template System
**Goal**: A template engine generates ~100 valid background styles from dimension combinations (5 platform types x 6 vista types x 5 sky palettes, minus invalid pairings). Each template expands to a complete TreeStyleParams via the pure function templateToParams(), and all generated params pass validateStyleParams() validation.

**Depends on**: Phase 2 (platform types must be defined before templates can reference them)

**Requirements**:
- TMPL-01: StyleTemplate interface defined as { platformType, vistaType, skyPalette, detailSet, timeOfDayBias }
- TMPL-02: templateToParams(t: StyleTemplate): TreeStyleParams -- pure function using lookup tables + dimension overlay to derive all params
- TMPL-03: Dimension mappings cover all TreeStyleParams (not just bg* fields) -- trunk/leaf/bloom/outline/particle params also derived from dimension combinations
- TMPL-04: ~100 valid templates in THEME_TEMPLATES: StyleTemplate[] array
- TMPL-05: Invalid combinations (e.g., city skyline + cliff platform) automatically filtered -- city skyline defaults to rooftop platform instead
- TMPL-06: validateStyleParams() runs on both templateToParams and LLM generation paths, checking all values are within valid ranges

**Success Criteria**:
1. In a browser console or test script, call `templateToParams({ platformType: 0, vistaType: 0, skyPalette: 0, detailSet: 0, timeOfDayBias: 0 })` -- it returns a complete TreeStyleParams object where all bg* fields are populated, no field is undefined or NaN, and the returned values differ meaningfully from calling templateToParams with different dimension values (e.g., platformType: 1)
2. Count THEME_TEMPLATES.length in the console -- it is between 90 and 110 (approximately 100 valid templates). Inspect the array -- no template has both city-vista AND cliff-platform (invalid pairings are absent)
3. Call `validateStyleParams(params)` with a deliberately broken params object (e.g., bgCamY: -5, bgFovZoom: 20) -- it returns false. Call it with any params from templateToParams() -- it returns true
4. Compare two templates that differ only in skyPalette (e.g., sunny vs sunset) -- the trunk/leaf/bloom/outline/particle parameters differ in meaningful ways (e.g., sunset has warmer mainLightColor, higher bloomStrength). Compare templates that differ in platformType -- windStrength varies (higher on rooftop, lower on temple base)
5. THEME_PRESETS Map (currently 4 entries for default/sakura/cyberpunk/ink) is replaced by `new Map(THEME_TEMPLATES.map(t => [t.name, templateToParams(t)]))` and the app boots without errors using this new preset source

**Plans**: TBD

---

### Phase 4: Style Transition Engine
**Goal**: Style changes produce a smooth 3-second visual transition where camera params, sky colors, and fog lerp continuously while the geometry map function atomically switches at the midpoint under dense fog coverage, producing no visible popping. The BackgroundRenderer manages a transition state machine, and ThemeTransition continues handling tree rendering parameters independently without conflict.

**Depends on**: Phase 3 (transitions interpolate between TreeStyleParams produced by the template system)

**Requirements**:
- TRAN-01: Shader holds both uStyleType (current) and uStyleTypeTarget (target), both int uniforms
- TRAN-02: Continuous lerp over 3 seconds with easeInOutCubic: camera params, sky colors, fog distance, particle color
- TRAN-03: Discrete switch at t=0.5: uStyleType (map function), particle shape
- TRAN-04: Fog masking curve: t in [0.3, 0.5] uFogDistance drops to 40% of target value; t in [0.5, 0.7] recovers to 100%
- TRAN-05: BackgroundRenderer manages transition state machine: idle -> transitioning -> idle
- TRAN-06: If a new trigger arrives during transition, immediately start a new transition from current interpolated state to new target (no queueing)
- TRAN-07: ThemeTransition continues managing tree rendering params (trunk/leaf/wind/lighting); shader transition manages background params (bg* + sky + fog + particles); both run in parallel without conflict

**Success Criteria**:
1. Trigger a style change (via debug GUI or programmatic call) -- observe the background for 3 seconds. Camera height/angle, sky colors, and fog distance change smoothly and continuously with no visual jumps or stutters (easeInOutCubic curve visible as slow start, faster middle, slow end)
2. Watch the exact midpoint of the transition (around 1.5 seconds) -- the background geometry changes from the old style's vista to the new style's. The fog is dense enough at this moment that the geometry pop is not visually jarring (dense fog fully obscures the horizon during the switch)
3. Trigger a second style change 1 second into the first transition -- the transition immediately reverses direction from the current in-between state toward the new target, with no visual glitch, flash, or frame where the wrong style renders
4. During a background transition, observe the 3D tree itself -- the trunk/leaf colors, wind animation, and lighting parameters transition smoothly on their own timeline managed by ThemeTransition, without any interference or conflict with the background transition
5. Trigger 10 rapid style changes in succession (faster than 3 seconds apart) -- the BackgroundRenderer never enters a broken state (no frozen animation, no infinite transition, no crash). After the rapid-fire stops, the final transition completes and the state machine returns to idle

**Plans**: TBD

---

### Phase 5: Knowledge-Driven Style Triggering
**Goal**: The background style changes automatically when the user's knowledge domain distribution, average mastery score, or content composition crosses defined thresholds. The system detects these changes via a Pinia nodeStore watcher, debounces triggers to 60-second intervals, and selects an appropriate target style from the template table.

**Depends on**: Phase 4 (triggers initiate style transitions through the transition engine)

**Requirements**:
- TRIG-01: New `frontend/src/composables/useStyleTrigger.ts` composable as the trigger subsystem
- TRIG-02: Trigger condition -- primary domain switch: the most common domain_tag across all nodes changes (mode changes)
- TRIG-03: Trigger condition -- mastery threshold crossing: average mastery_score crosses a 0.25 integer multiple boundary (0.25, 0.50, 0.75)
- TRIG-04: Trigger condition -- new domain emergence: a new domain_tag appears in >20% of all nodes
- TRIG-05: Debounce: minimum 60 seconds between two triggers
- TRIG-06: Trigger detection runs in a Pinia nodeStore watcher after each CRUD operation, non-blocking
- TRIG-07: Backend `GET /api/nodes/style-context` returns domain distribution and average mastery_score for the authenticated user (with frontend local computation as fallback)

**Success Criteria**:
1. Create 10 nodes all tagged with domain_tag "mathematics" and mastery_score ~0.3, then create 15 nodes tagged "history" -- within 60 seconds, the background style automatically transitions to a style matching the new dominant domain "history"
2. Edit node mastery scores to push the average from 0.24 to 0.26 (crossing the 0.25 boundary) -- the background style transitions to a higher-mastery style within 60 seconds
3. Create 8 nodes in a brand new domain "physics" (where total nodes were 30, so 8/38 > 20%) -- the background style transitions within 60 seconds
4. Perform 5 rapid CRUD operations (create, edit, delete nodes) within 10 seconds -- at most one style change occurs, not five (the 60-second debounce is active)
5. Open browser devtools Network tab -- a request to `GET /api/nodes/style-context` returns JSON with fields `domainDistribution` (object mapping domain_tag to count) and `averageMastery` (number between 0 and 1) for the current authenticated user

**Plans**: TBD

---

### Phase 6: Time-of-Day System & Particles
**Goal**: Sky colors and atmospheric tones shift through a natural dawn-noon-dusk-night cycle driven by the system real-time clock. Each style defines four time-of-day color palettes with smooth lerp between adjacent periods and a per-style time offset. Particle effects (leaves/petals) render in the sky layer with color and shape varying per style template.

**Depends on**: Phase 4 (time-of-day uses the transition engine's lerp mechanism for palette blending; particles need template system colors from Phase 3)

**Requirements**:
- TOD-01: Shader adds uniform float uTimeOfDay (0.0-1.0, 24-hour normalized)
- TOD-02: uTimeOfDay computed from system clock: `new Date().getHours() / 24`
- TOD-03: Each style defines dawn/noon/dusk/night four-group color overrides
- TOD-04: Smooth lerp between adjacent time period palettes
- TOD-05: Each style can define a timeOfDayOffset (0.0-0.5) to shift its base time
- ARCH-02: Re-enable the existing but commented-out particle system (particle.ts) as sky-layer visual life

**Success Criteria**:
1. Set system clock to 06:00 and open the app -- the sky shows dawn colors (warm orange/pink tones). Set to 12:00 -- sky is bright midday. Set to 18:00 -- warm dusk tones. Set to 00:00 -- dark night sky. All four time periods are visibly distinct
2. Watch the app at 07:30 (between dawn and noon) -- the sky colors are a smooth blend between the dawn palette and noon palette, with no visible color banding or abrupt shift
3. Compare two styles at the same clock time where one has timeOfDayOffset: 0.25 -- the offset style shows its dusk palette when the non-offset style shows its noon palette (6-hour shift)
4. Particles are visible in the sky layer -- small leaf/petal/diamond/circle shapes drift downward, with color matching the active style's particleColor. Switching styles changes particle color and shape
5. Open the browser performance profiler while particles are actively rendering -- the frame rate on desktop remains at 60fps, with no observable frame time spike attributable to the particle system

**Plans**: TBD

---

### Phase 7: LLM Style Generation
**Goal**: A backend REST endpoint accepts a knowledge data summary and returns an AI-generated TreeStyleParams object validated through the same validateStyleParams() used by the template system. The feature is backend-initiated, not user-triggered, and failures are handled silently.

**Depends on**: Phase 3 (needs StyleTemplate interface, templateToParams, and validateStyleParams from the template system)

**Requirements**:
- LLM-01: `POST /api/styles/generate` endpoint accepting a knowledge data summary, returning TreeStyleParams JSON
- LLM-02: Uses SiliconFlow API with existing SILICONFLOW_API_KEY environment variable
- LLM-03: Generated result validated through validateStyleParams(); failures are silently discarded with console.warn
- LLM-04: System-initiated calls, not user-triggered (no UI for style generation)

**Success Criteria**:
1. Send a curl request to `POST /api/styles/generate` with a valid JSON body containing domain distribution and mastery data -- the response is HTTP 200 with a JSON object containing all fields of TreeStyleParams (trunkBaseColor, bgCamY, skyTopColor, etc.) and each value passes validateStyleParams()
2. Send a curl request with missing or malformed fields -- the response is HTTP 400 with an error detail message, and the server does not crash or enter an error state
3. Temporarily unset SILICONFLOW_API_KEY or use an invalid key, then call the endpoint -- the response is HTTP 502 with an appropriate error message. The server logs the failure but continues serving other endpoints
4. Generated styles are returned to the caller but do NOT automatically replace the current active style -- the system decides when to apply generated styles through the triggering system (Phase 5)

**Plans**: TBD

---

### Phase 8: Error Handling & Performance Hardening
**Goal**: The background system meets its performance budget (60fps desktop, 30fps mobile) with all features active, degrades gracefully to a 2D sky gradient when the shader cannot compile, and optimizes raymarch step distribution so the platform SDF stops participating in distant calculations.

**Depends on**: Phase 6 (all rendering features must be in place before final performance validation and hardening)

**Requirements**:
- ERR-01: Shader compilation failure falls back to existing 2D sky gradient (sky2d.ts), logs compilation error
- ERR-02: WebGL context loss handled by existing SceneManager context loss handler (no changes needed, verify existing handler works)
- ERR-03: Mobile shader compilation failure triggers progressive degradation: detect failure -> reduce map functions -> fall back to sky2d
- ERR-04: templateToParams and LLM generation paths both run through validateStyleParams(), ensuring all values stay within valid ranges
- ARCH-03: Performance budget met -- desktop 60fps, mobile 30fps, 80-step raymarch cap
- ARCH-04: Near-far geometry step optimization -- platform SDF bounding sphere exits map calculation for t > 5

**Success Criteria**:
1. Open the app in Chrome/Firefox/Edge on a desktop with the full SDF background pipeline active (platform + vista + particles + transition) -- the frame rate counter (browser devtools or debug GUI) shows a stable 60fps with no sustained drops below 55fps during normal operation including style transitions
2. Open the app in Chrome on a mid-range Android phone or in Chrome DevTools mobile emulation with CPU throttling (4x slowdown) -- the frame rate maintains at least 30fps with all features enabled. Particles, platform details, and transitions all render without causing the page to become unresponsive
3. Deliberately introduce a syntax error into one of the vista .glsl files and reload the app -- instead of a white screen, the app renders a 2D sky gradient background (the existing sky2d.ts fallback). The browser console contains a warning message with the shader compilation error details
4. Measure raymarch performance by toggling the near-far optimization on and off (via a debug flag) -- with optimization enabled, steps spent inside the platform SDF for t > 5 are eliminated, resulting in measurably lower GPU time per frame (5-15% improvement depending on camera angle)
5. Trigger a WebGL context loss (in Chrome: type `chrome://gpuclean` in a separate tab, or use the WebGL Inspector extension) -- the app recovers by reinitializing the scene without requiring a page refresh, and the background renders correctly after recovery

**Plans**: TBD

---

## Dependencies

```
Phase 1: Camera System & Shader Foundation
  |
  v
Phase 2: Foreground Platform SDF ──────────────┐
  |                                              │
  v                                              │
Phase 3: Style Template System ────────────┐    │
  |                                         │    │
  v                                         │    │
Phase 4: Style Transition Engine ──────┐    │    │
  |                                    │    │    │
  v                                    │    │    │
Phase 5: Knowledge-Driven Triggering   │    │    │
  |                                    │    │    │
  v                                    │    │    │
Phase 6: Time-of-Day & Particles       │    │    │
  |                                    │    │    │
  v                                    v    v    v
Phase 8: Error Handling & Performance Hardening
                              ^
                              |
Phase 7: LLM Style Generation ┘ (independent backend feature, depends on Phase 3 templates)
```

**Key dependency notes:**
- Phase 2 needs Phase 1 because platform placement uses camera params flowing through the shader
- Phase 3 needs Phase 2 because template dimensions reference platform types that must be defined
- Phase 4 needs Phase 3 because transitions interpolate between TreeStyleParams produced by the template system
- Phase 5 needs Phase 4 because triggers initiate style transitions through the transition engine
- Phase 6 needs Phase 4 (transition engine's lerp mechanism) and Phase 3 (template colors for palettes)
- Phase 7 needs Phase 3 only (template interface, validateStyleParams) -- LLM generation is backend-independent of rendering
- Phase 8 needs Phase 6 because all rendering features must be active before final performance validation

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Shader compilation fails on mobile GPUs with 6+ vista maps + 5 platforms + detail SDFs in one shader | Medium | High | Phase 1 shader file splitting enables modular compilation. Phase 8 includes progressive mobile degradation. ERR-03 provides sky2d fallback |
| Fog masking at t=0.5 is insufficient to hide geometry pop for near-field platform objects (z=2-5) | Medium | Medium | TRAN-04 fog curve drops to 40% distance. If near-field pop is visible during implementation, increase fog density or add a brief opacity fade on the platform during the switch window |
| templateToParams produces visually unpleasant combinations that pass validation but look bad | Medium | Low | ~100 templates is manageable for visual review. Invalid combinations are filtered (TMPL-05). Content authoring effort (~1 min per template for tuning) is budgeted |
| SiliconFlow API instability causes LLM style generation failures | Low | Medium | LLM-03: failures are silently discarded with console.warn. No impact on rendering -- the template system provides ~100 styles without LLM dependency |
| 80-step raymarch budget insufficient after adding platform + detail SDFs | Low | High | ARCH-04: platform bounding sphere optimization eliminates platform from distant steps. Priority: 65+ steps for vista search after ~15 for near-field |
| Knowledge data triggering fires too frequently during bulk node import, causing distracting style changes | Medium | Low | TRIG-05: 60-second debounce. If still too frequent during implementation, increase debounce to 120 seconds or add a "significant change" threshold |
| ThemeTransition and shader background transition stepping on each other's uniforms | Low | Medium | TRAN-07: explicit parameter domain separation -- ThemeTransition controls trunk/leaf/wind/lighting uniforms; shader transition controls bg*/sky/fog/particle uniforms. They write to different uniform keys |
| Particle system re-enable (ARCH-02) regresses performance below 60fps budget | Low | Medium | Phase 8 validates performance after all features. If particles cause fps drop, reduce particle count or simplify fragment shader. Particle system already existed and ran at acceptable fps before being commented out |

---

*Roadmap created: 2026-04-28*
