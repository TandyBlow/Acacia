# Phase 2: Foreground Platform SDF - Research

**Researched:** 2026-04-29
**Domain:** GLSL signed distance functions, raymarching, procedural geometry placement
**Confidence:** HIGH

## Summary

Phase 2 adds a foreground platform layer to the existing SDF raymarch pipeline. The platform renders at screen bottom with distinct visual identity per platform type (cliff, viewing-deck, rooftop, temple-base, megalith), anchoring the 3-layer depth composition (platform foreground / vista midground / sky background).

The core technical challenge is designing `sdCliff` -- a new SDF primitive that produces an organic, irregular cliff face. Since `sdCliff` does not exist as a canonical primitive in the Inigo Quilez distfunctions reference [VERIFIED: iquilezles.org/articles/distfunctions/ -- no `sdCliff` entry], we must design it from composable IQ techniques: a rounded box base + FBM noise displacement on the top edge to create irregular cliff profiles. The `edgeRound` parameter controls corner rounding (weathered look).

Platform integration follows the existing `map()` dispatch pattern. The platform SDF evaluates alongside the vista SDF via `min(vistaDist, platformDist)` in the main `map()` function. The platform is placed at camera-relative z=2-5 in world space, which naturally occupies the screen bottom when the camera looks downward (uCamPitch < 0). Detail SDFs (railing, gravel, ac-unit, grass, stone-lantern, etc.) are placed deterministically on the platform surface using `hash11` grid-cell hashing -- the standard GPU-side procedural placement technique [VERIFIED: IQ domain repetition patterns, Shadertoy community consensus].

**Primary recommendation:** Add `sdCliff` to `sdfPrimitives.ts` (as a new primitive), create `sdfPlatforms.ts` for platform type SDFs + detail SDFs, and integrate platform into the main `map()` function via `min(vistaDist, platformDist)` -- no changes to individual vista `.glsl` files. Defer ARCH-04 (platform early-termination optimization) to Phase 8 as planned.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SDF primitive (sdCliff) | GPU/Shader | -- | SDF evaluation happens in the GLSL fragment shader; CPU only supplies uniform parameters |
| Platform dispatch (sdPlatform) | GPU/Shader | -- | Type routing via `int uPlatformType` uniform, evaluated per raymarch step |
| Camera-relative platform placement | GPU/Shader | -- | World-space position derived from camera uniforms (uCamY, uCamPitch, uCamZ) |
| Platform type SDFs (5 types) | GPU/Shader | -- | Each type is a composite SDF in GLSL |
| Detail SDF placement | GPU/Shader | -- | hash11-based deterministic placement, entirely GPU-side |
| Uniform parameter management | Frontend/CPU | GPU/Shader | SdfParamRegistry on CPU feeds uniforms; shader consumes them |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAT-01 | Add sdCliff(p, width, height, edgeRound) SDF primitive | Designed as sdRoundBox base + FBM noise displacement on top edge. No canonical IQ primitive exists; must be synthesized. See Section: SDF Design |
| PLAT-02 | Add sdPlatform(p, type) dispatch function routing to specific SDF per platform type | if/else chain on int type uniform, following existing map() dispatch pattern. type 0=cliff, 1=viewing-deck, 2=rooftop, 3=temple-base, 4=megalith |
| PLAT-03 | Platform placed at camera-relative z≈2-5, occupying bottom ~5% of screen | Platform center at ro + forward * platformZ. Screen-bottom rays (uv.y < 0, pitch < 0) intersect the near-field platform before distant ground. See Section: Camera-Relative Placement |
| PLAT-04 | 5 platform types SDF: cliff/viewing-deck/rooftop/temple-base/megalith | Each type defined as composite SDF in sdfPlatforms.ts. sdCliff used directly by cliff type. Other types use sdBox/sdCylinder/sdRoundBox + detail composition |
| PLAT-05 | Each platform has 2-3 small detail SDFs placed with hash11 fixed positioning | Grid-cell hashing on platform surface coordinates. Details include: railing, gravel, ac-unit, grass, stone-lantern, rope-fence, moss-patch, prayer-flag, neon-strip, rubble |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Three.js (WebGL) | 0.157+ [VERIFIED: npm registry, package.json in repo] | WebGL context, shader material, uniform management | Already in project; SdfParamRegistry builds on THREE.IUniform |
| GLSL ES 1.00 | -- | Fragment shader for raymarch | WebGL 1.0 baseline for mobile compatibility |
| Vite (raw import) | 5.x [VERIFIED: npm registry] | `.glsl?raw` imports for shader fragment composition | ARCH-01 precedent: 4 vista .glsl files imported via `?raw` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vue 3 + TypeScript | 3.x | SdfParamRegistry, uniform generation | Compose shader strings, manage parameter registry entries |
| Pinia | 2.x | Theme store for platform type state | Future: uPlatformType driven by style store (Phase 3+) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| sdCliff as composite in sdfArchitecture.ts | Separate sdCliff in sdfPrimitives.ts | REQ calls it a "primitive"; placing in sdfPrimitives matches semantic intent and lets other SDFs reuse it |
| Platform in each vista .glsl file | Platform in main map() function | Central dispatch avoids 4x duplication; each vista map stays focused on its vista style |
| New color uniforms per platform type | Use uGroundColor + procedural tint | Avoids uniform proliferation in Phase 2; per-type color uniforms can be added in Phase 3 via StyleTemplate |

**Installation:**
No new npm packages required. This phase adds GLSL code only.

## Architecture Patterns

### System Architecture Diagram

```
[CPU: SdfParamRegistry]
    |
    | uniform int uPlatformType
    | (future: uniform vec3 uPlatformColor)
    v
[GPU: Fragment Shader]
    |
    | raymarch loop (80 steps)
    |   for each step at worldPos p:
    |     vistaDist = map{Style}(p)     // existing .glsl files
    |     platformDist = sdPlatform(p - platformOrigin, uPlatformType)  // NEW
    |     dist = min(vistaDist, platformDist)
    |     if dist < EPS: hit, break
    v
[Hit surface]
    |
    +--> Platform hit (t < 8): platform material/color
    +--> Vista hit (t >= 8): existing toon lighting
    +--> Miss: sky gradient
```

Data flow: Camera uniforms → compute platform world-space origin → evaluate platform SDF alongside vista SDF → min() combines them → raymarch finds nearest surface.

### Recommended Project Structure
```
frontend/src/components/tree/shaders/
├── sdfPrimitives.ts          # + sdCliff primitive (PLAT-01)
├── sdfArchitecture.ts        # unchanged
├── sdfPlatforms.ts           # NEW: sdPlatform + 5 type SDFs + detail SDFs (PLAT-02/04/05)
├── backgroundRaymarch.ts     # + import sdfPlatforms, + platform in map()
├── vista/
│   ├── mapDefault.glsl       # unchanged
│   ├── mapSakura.glsl        # unchanged
│   ├── mapCyberpunk.glsl     # unchanged
│   └── mapInk.glsl           # unchanged
└── ...
```

### Pattern 1: SDF Primitive Addition (sdfPrimitives.ts)
**What:** Add `sdCliff` as a new exported string constant alongside existing SDF_PRIMITIVES, or append to SDF_PRIMITIVES.
**When to use:** For genuinely reusable primitives that other SDFs depend on.
**Example:**
```glsl
// Source: Designed from IQ distfunctions + FBM techniques
// Appended to SDF_PRIMITIVES in sdfPrimitives.ts
float sdCliff(vec3 p, float width, float height, float edgeRound) {
  // Rounded box base — the cliff mass
  vec3 b = vec3(width * 0.5, height * 0.5, 0.6);
  float d = sdRoundBox(p, b, edgeRound);
  
  // FBM displacement on top edge for organic irregularity
  float noise = fbm(p.xz * 2.5 + p.y * 0.3) * height * 0.35;
  float topMask = smoothstep(-0.1, 0.4, p.y / (height * 0.5 + 0.01));
  d += noise * topMask;
  
  // Subtle face variation (cliff face texture)
  float faceNoise = fbm(p.xy * 1.8) * 0.12;
  d += faceNoise * (1.0 - topMask);
  
  return d;
}
```

### Pattern 2: Platform Dispatch + Type SDFs (sdfPlatforms.ts)
**What:** A single file containing `sdPlatform(p, type)` dispatch function plus all 5 platform type SDF implementations. Exported as a string constant for composition in backgroundRaymarch.ts.
**When to use:** For platform SDFs that share the same dispatch interface and are always used together.
**Example:**
```glsl
// Source: Designed per PLAT-04 requirements
// Exported as SDF_PLATFORMS from sdfPlatforms.ts

// --- Platform type SDFs ---
float sdCliffPlatform(vec3 p) {
  // Base cliff formation
  float cliff = sdCliff(p, 12.0, 3.5, 0.15);
  // Add boulders at base
  // ...
  return cliff;
}

float sdViewingDeck(vec3 p) {
  float platform = sdRoundBox(p, vec3(4.0, 0.2, 1.5), 0.05);
  // Railings, wooden surface texture
  // ...
  return platform;
}

// ... rooftop, templeBase, megalith ...

// --- Dispatch ---
float sdPlatform(vec3 p, int type) {
  if (type == 0) return sdCliffPlatform(p);
  if (type == 1) return sdViewingDeck(p);
  if (type == 2) return sdRooftop(p);
  if (type == 3) return sdTempleBase(p);
  if (type == 4) return sdMegalith(p);
  return 1e10; // no platform
}
```

### Pattern 3: Platform Integration in map()
**What:** The main `map()` function in backgroundRaymarch.ts composes vista SDF and platform SDF via `min()`.
**When to use:** Single point of integration -- no changes to individual vista `.glsl` files.
**Example:**
```glsl
// Source: backgroundRaymarch.ts main() scope
float map(vec3 p) {
  int style = int(uStyleType + 0.5);

  // Vista SDF dispatch (existing pattern)
  float vistaD;
  if (style == 1) vistaD = mapSakura(p);
  else if (style == 2) vistaD = mapCyberpunk(p);
  else if (style == 3) vistaD = mapInk(p);
  else vistaD = mapDefault(p);

  // Platform SDF (NEW) — evaluated at camera-relative position
  vec3 platformOrigin = vec3(0.0, uCamY + sin(uCamPitch) * uPlatformZ,
                                  uCamZ + cos(uCamPitch) * uPlatformZ);
  float platformD = sdPlatform(p - platformOrigin, int(uPlatformType + 0.5));

  return min(vistaD, platformD);
}
```

**Note on performance:** ARCH-04 (skip platform evaluation when t > 5) is deferred to Phase 8. In Phase 2, the platform SDF is evaluated every step but the cost is bounded: each platform type is O(1) SDF operations plus a few noise calls.

### Anti-Patterns to Avoid
- **Platform SDF in each vista .glsl file:** Duplicates platform code 4x, violates DRY, makes future style additions harder. Use main map() composition instead.
- **New uniform for every platform parameter:** Phase 2 should use minimal uniforms (uPlatformType, uPlatformZ). Per-type color/material parameters should be procedurally derived or deferred to Phase 3 StyleTemplate.
- **Hash-based detail placement without stable seeds:** Use fixed seed offsets (e.g., uSeed + 200.0 + detailIndex) to ensure details don't shift between frames.
- **Detail SDFs smaller than raymarch step size:** Details must be at least ~0.05 units in smallest dimension to be reliably hit by the raymarcher with 80 steps over tMax ~70.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hash-based deterministic placement | Custom RNG | Existing hash11/hash12/hash22 in sdfPrimitives.ts | Already battle-tested in the codebase; deterministic across frames |
| Organic noise for cliff edge | Custom noise function | Existing fbm() in sdfPrimitives.ts | 4-octave FBM already implemented and tuned; consistent with IQ reference |
| Smooth blending of detail SDFs | Sharp min() | opS() smooth union in sdfPrimitives.ts | Prevents raymarch artifacts at detail-platform boundaries |
| Coordinate transforms | Matrix math | pR() rotation helper in sdfPrimitives.ts | Already available for rotating detail SDF placements |

**Key insight:** The codebase already has the essential building blocks (hash functions, FBM noise, smooth union, rotation helpers) from Phase 1. Phase 2's work is composing them into platform shapes, not building new infrastructure.

## Runtime State Inventory

> Omitted -- this is a greenfield feature phase (new SDF code), not a rename/refactor/migration phase.

## Common Pitfalls

### Pitfall 1: Platform-Ground Gap
**What goes wrong:** A visible empty gap between the foreground platform and the background ground plane. The platform sits at z≈2-5, the vista ground plane at uGroundY (world y), and the gap between them creates an unnatural seam where the sky/fog shows through.
**Why it happens:** The platform is a discrete object in front of a continuous ground plane. If platform depth (z-extent) doesn't overlap with the visible ground plane depth, rays between them hit nothing.
**How to avoid:** 
1. Make the platform deep enough (z-extent of at least 2-3 units) so its rear face extends behind the nearest visible ground intersection.
2. Rely on fog: at uFogDistance=60, near-field fog is minimal (t=2-5), but if the gap is at z=10-20, fog will help blend.
3. Drop the platform rear edge slightly below the front edge (tilted platform) to create a visual "merge" with the ground.
**Warning signs:** Horizontal line of sky color visible between platform and distant ground during testing.

### Pitfall 2: Screen Coverage Instability with Camera Pitch
**What goes wrong:** The platform occupies different screen percentages at different uCamPitch values. At pitch=-0.05 (nearly flat), the platform may occupy <3% of screen. At pitch=-0.3, it may occupy >10%.
**Why it happens:** The platform is placed in world space at a fixed camera-relative depth. The screen-space projection of a fixed-size object varies with the camera's vertical FOV and pitch.
**How to avoid:**
1. Parameterize platform height and z-position per style (each style has its own bgCamPitch from CAM-04, so platform parameters can match).
2. Compute platform vertical extent so that at the style's nominal bgCamPitch, it covers ~5% of screen.
3. Accept ±2% variation across the pitch range; 5% is an approximate target.
**Warning signs:** Platform appearing too tall or too short when switching between vista styles with different pitch values.

### Pitfall 3: Hash Collision Causing Overlapping Details
**What goes wrong:** Two details placed by hash11 appear in the same location or overlap awkwardly.
**Why it happens:** Using the same hash seed for multiple detail properties without proper offsetting.
**How to avoid:** Use distinct seed offsets per detail instance and per property:
```glsl
float posX = hash11(seed + detailIndex * 7.0 + 0.0) * width;
float posZ = hash11(seed + detailIndex * 7.0 + 1.0) * depth;
float scale = 0.5 + hash11(seed + detailIndex * 7.0 + 2.0) * 0.5;
```
**Warning signs:** Two railings at the same position, or a stone lantern clipping through a railing.

### Pitfall 4: Raymarch Step Skipping Platform Detail
**What goes wrong:** Small detail SDFs (e.g., a thin railing post) are missed by the raymarcher because the step size jumps past them.
**Why it happens:** The raymarch advances by `max(d * 0.8, 0.02)`. If a thin object's SDF returns a small value in a narrow region, the step might overshoot.
**How to avoid:**
1. Ensure detail SDFs have a minimum thickness of at least 0.05 world units.
2. Use `opS()` smooth union with a small k value (0.02-0.05) for details so they "fatten" slightly into the platform surface.
3. The existing minimum step of 0.02 provides a safety net for objects thicker than that.
**Warning signs:** Flickering geometry at the edges of detail objects as the camera moves.

### Pitfall 5: Performance Regression from Per-Step Platform Evaluation
**What goes wrong:** Adding platform SDF evaluation to every raymarch step slows down the shader noticeably, especially on mobile.
**Why it happens:** Each platform type SDF involves 5-15 SDF primitive evaluations + noise. Evaluated 80 times per pixel, this adds up.
**How to avoid:**
1. Keep platform SDFs simple. Target <10 primitive evaluations + <3 noise calls per type.
2. Platform hit terminates the march early (t < ~8), reducing total steps for bottom-screen pixels.
3. Phase 8's ARCH-04 will add `if (t > uPlatformZ + 3.0) skip platform` for a major optimization.
4. Test on target hardware (desktop + mobile) after implementation.
**Warning signs:** Frame time increase >2ms on desktop, >5ms on mobile compared to Phase 1 baseline.

## Code Examples

Verified patterns from the existing codebase and IQ reference:

### Platform Type SDF: Cliff (山崖)
```glsl
// Source: Designed from IQ distfunctions + FBM noise techniques
// VERIFIED: sdRoundBox from sdfPrimitives.ts, fbm from sdfPrimitives.ts
float sdCliffPlatform(vec3 p) {
  // Main cliff formation using sdCliff primitive
  float cliff = sdCliff(p, 12.0, 3.5, 0.15);

  // Add base boulders
  float boulder1 = sdRoundBox(p - vec3(-4.0, -1.2, 0.3), vec3(1.2, 0.8, 0.8), 0.3);
  float boulder2 = sdRoundBox(p - vec3(4.5, -1.0, -0.2), vec3(1.0, 0.7, 0.9), 0.25);
  float boulder3 = sdRoundBox(p - vec3(0.0, -1.4, 0.6), vec3(1.5, 0.6, 0.7), 0.2);

  float d = cliff;
  d = opS(d, boulder1, 0.3);
  d = opS(d, boulder2, 0.3);
  d = opS(d, boulder3, 0.25);

  // Add detail SDFs (PLAT-05)
  d = min(d, cliffDetails(p));

  return d;
}
```

### Hash11 Detail Placement on Platform Surface
```glsl
// Source: hash11 from sdfPrimitives.ts, IQ domain repetition pattern
// VERIFIED: hash11 already exists and is tested in the codebase
float platformDetails(vec3 p, int platformType, float seed) {
  float d = 1e10;
  float cellSize = 1.5; // detail spacing
  vec3 cell = floor(p / cellSize);
  vec3 localP = mod(p, cellSize) - cellSize * 0.5;

  // Hash the cell to determine if this cell has a detail
  float h0 = hash11(seed + cell.x * 13.0 + cell.y * 7.0 + cell.z * 3.0);

  // Only ~40% of cells get a detail
  if (h0 > 0.4) {
    // Deterministic position offset within cell
    float offsetX = (hash11(seed + cell.x * 13.0 + cell.y * 7.0 + cell.z * 3.0 + 1.0) - 0.5) * cellSize * 0.7;
    float offsetZ = (hash11(seed + cell.x * 13.0 + cell.y * 7.0 + cell.z * 3.0 + 2.0) - 0.5) * cellSize * 0.7;
    vec3 detailP = localP - vec3(offsetX, 0.0, offsetZ);

    // Deterministic detail type selection
    float typeSelector = hash11(seed + cell.x * 13.0 + cell.y * 7.0 + cell.z * 3.0 + 3.0);

    if (platformType == 0) { // cliff details: gravel, small rocks
      if (typeSelector < 0.5) {
        d = sdRoundBox(detailP, vec3(0.12, 0.08, 0.12), 0.04);
      } else {
        d = sdRoundBox(detailP, vec3(0.15, 0.10, 0.10), 0.06);
      }
    }
    // ... other platform type detail switches
  }
  return d;
}
```

### Camera-Relative Platform Origin Computation
```glsl
// Source: Derived from existing camera model in backgroundRaymarch.ts
// Camera at ro = (0, uCamY, uCamZ), forward = normalize(0, sin(uCamPitch), cos(uCamPitch))
// Platform placed uPlatformZ units ahead of camera along forward vector
vec3 computePlatformOrigin() {
  vec3 forward = normalize(vec3(0.0, sin(uCamPitch), cos(uCamPitch)));
  vec3 ro = vec3(0.0, uCamY, uCamZ);
  // Platform center: uPlatformZ units ahead, slightly below eye level for screen-bottom placement
  float zOffset = uPlatformZ; // typically 3.0-5.0
  return ro + forward * zOffset;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded camera (ro, lookAt, zoom) | Uniform-driven 4-parameter camera | Phase 1 (CAM-01) | Platform placement adapts to camera parameters |
| Single monolithic map function | Per-vista .glsl files + main dispatch | Phase 1 (ARCH-01) | Platform integrates at dispatch level, not per-file |
| No foreground layer | 3-layer depth (platform/vista/sky) | Phase 2 | Visual depth composition requires fog + color treatment |

**Deprecated/outdated:**
- Hardcoded scene geometry positions: Now all placed relative to camera position/orientation via uniforms
- Single monolithic shader string: Now modular with Vite `?raw` imports

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | fdCliff is best implemented as sdRoundBox + FBM displacement, not as an IQ-style analytical SDF | SDF Design | If a simpler analytical formulation exists, implementation may be unnecessarily complex (LOW risk -- IQ distfunctions page has no cliff primitive) |
| A2 | Platform at camera-relative z=3-5 with height ~1.5-3.5 will occupy ~5% screen bottom at default pitch=-0.15 | Camera-Relative Placement | If exact 5% target is strict, parameters need iterative tuning (MEDIUM risk -- 5% is approximate, ±2% acceptable) |
| A3 | Using uGroundColor + procedural tinting provides sufficient visual distinction between platform types | Material/Color Strategy | If distinct colors per platform type are needed, Phase 3 StyleTemplate must add platform color uniforms (MEDIUM risk -- deferrable) |
| A4 | Detail SDFs can be grid-placed on the platform's top surface (xz plane) without needing the exact surface position | Detail System | If details need to sit exactly on irregular cliff surfaces, more sophisticated surface-snapping is needed (LOW risk -- cliff details are rocks/boulders that work on or near the surface) |
| A5 | Fog (exponential, uFogDistance ~60) will adequately mask the gap between platform rear and distant ground | Pitfalls | If fog is insufficient at z=5-15 for near-field occlusion, linear fog or a dark "shadow plane" may be needed (MEDIUM risk -- flagged in STATE.md TODO) |

## Open Questions

1. **Fog masking for near-field platform**
   - What we know: STATE.md flags "Verify fog masking effectiveness for near-field platform (z=2-5) -- may need linear fog instead of exponential." Exponential fog at uFogDistance=60 gives `fog = 1 - exp(-5/60)` ≈ 0.08 at t=5, meaning the platform is nearly fog-free while the gap behind it might also be clear.
   - What's unclear: How visible the platform-ground gap will be. Exponential fog is weakest near the camera, exactly where the gap might appear.
   - Recommendation: Implement with current exponential fog; if gap is visible, add a `uPlatformFogStart` parameter in the plan or use a dark occluder plane behind the platform. This is testable early in implementation.

2. **Platform type association with vista styles**
   - What we know: Phase 3's StyleTemplate system will map platform types to vista styles. Phase 2 needs a way to select the platform type (uPlatformType uniform).
   - What's unclear: Should Phase 2 hardcode a single platform type for testing, cycle through types, or add a simple config mechanism? How should each of the 4 prototype styles map to platform types?
   - Recommendation: Hardcode uPlatformType=0 (cliff) as the default for Phase 2 development. Provide a const mapping in TypeScript that associates each style with a platform type (default→cliff, sakura→temple-base, cyberpunk→rooftop, ink→megalith). This mapping can be refined in Phase 3.

3. **Platform interaction with mouse parallax**
   - What we know: CAM-05 requires the parallax offset to affect the vista layer (t > 20) but NOT the platform layer (t < 20). The current implementation applies `uv.x += (uMouseUV.x - 0.5) * 0.06` before raymarch.
   - What's unclear: The current parallax implementation shifts the entire ray direction before marching. Does this mean the platform also shifts? Required wording says "platform layer unaffected" -- must the platform be visually fixed on screen?
   - Recommendation: The current pre-raymarch UV offset applies to ALL geometry including platform. To achieve platform-fixed visual, either: (a) accept subtle platform parallax (it's near-field so the effect is minimal), (b) apply parallax as a post-raymarch screen-space offset for sky only. This needs a decision during planning.

4. **Detail SDF count and performance budget**
   - What we know: PLAT-05 requires 2-3 detail types per platform, placed with hash11. If each detail has multiple instances (e.g., 5-10 railings), the per-platform SDF evaluation could be substantial.
   - What's unclear: How many detail instances is reasonable without degrading to <60fps? The grid-cell hashing approach evaluates O(N_cells) = O(platform_area / cellSize^2) cells, each with a few SDF operations.
   - Recommendation: Use cellSize=1.5 for details, giving ~10-15 cells across the platform width. Only ~40% of cells have details. Total ~4-6 detail evaluations per platform SDF call. Test and adjust cell density based on performance measurements.

## Environment Availability

> Step 2.6: SKIPPED (no external dependencies identified). This phase adds GLSL shader code to existing build pipeline. The existing development environment (Node.js, npm, Vite) and runtime environment (WebGL browser) cover all needs.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (via Vite) + TypeScript |
| Config file | vitest.config.ts (project root) |
| Quick run command | `npx vitest run frontend/src/components/tree/__tests__/sdfPrimitives.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAT-01 | sdCliff returns valid SDF (negative inside, positive outside, zero on surface) | unit | `npx vitest run frontend/src/components/tree/__tests__/sdfPrimitives.test.ts -t "sdCliff"` | ❌ Wave 0 (need new test or extend existing) |
| PLAT-02 | sdPlatform dispatches correctly for each type (0-4): different SDF values for different types at same p | unit | `npx vitest run frontend/src/components/tree/__tests__/sdfPlatforms.test.ts -t "sdPlatform"` | ❌ Wave 0 |
| PLAT-03 | Platform occupies bottom ~5% of screen: verify platform SDF returns negative values for screen-bottom rays at z≈2-5 | integration | `npx vitest run frontend/src/components/tree/__tests__/platformPlacement.test.ts` | ❌ Wave 0 |
| PLAT-04 | Each of 5 platform types produces distinct SDF output (not identical) | unit | `npx vitest run frontend/src/components/tree/__tests__/sdfPlatforms.test.ts -t "platform types"` | ❌ Wave 0 |
| PLAT-05 | hash11 detail placement is deterministic: same seed + cell = same detail every time | unit | `npx vitest run frontend/src/components/tree/__tests__/sdfPlatforms.test.ts -t "detail placement"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run` (related test files)
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** Full suite green + manual visual check (shader output) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `frontend/src/components/tree/__tests__/sdfPlatforms.test.ts` -- new test file for PLAT-02/04/05
- [ ] `frontend/src/components/tree/__tests__/platformPlacement.test.ts` -- new test file for PLAT-03
- [ ] Extend `frontend/src/components/tree/__tests__/sdfPrimitives.test.ts` -- add sdCliff test cases (PLAT-01)
- [ ] All test files non-existent; entire test infrastructure for platform SDFs needs creation during Wave 0

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | -- (Phase 2 is GPU shader code only) |
| V3 Session Management | no | -- |
| V4 Access Control | no | -- |
| V5 Input Validation | yes | Shader uniform values (uPlatformType, uPlatformZ) must be clamped to valid ranges before upload to GPU. TypeScript layer validates int range 0-4. |
| V6 Cryptography | no | -- |

### Known Threat Patterns for GLSL Shader Code

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Uniform value out of bounds (uPlatformType > 4) | Tampering | Clamp in TypeScript before `uniforms[name].value = val`; in GLSL, default to cliff type 0 for unknown values |
| NaN/Inf in uniform values crashing shader | Denial of Service | SdfParamRegistry min/max bounds; THREE.js Uniform handles type safety |
| Shader compilation failure on mobile GPU | Denial of Service | ERR-01 fallback to sky2d.ts; deferred to Phase 8 |
| Integer division precision in GLSL (int/float mixing) | Tampering | Use explicit float casts (`float(uPlatformType)`) or add 0.5 before int cast as existing code does |

## Sources

### Primary (HIGH confidence)
- Inigo Quilez distfunctions reference (iquilezles.org/articles/distfunctions/) -- no `sdCliff` primitive exists; verified via multiple web searches and community sources
- Inigo Quilez terrain marching article (iquilezles.org/articles/terrainmarching/) -- FBM noise + raymarching patterns for terrain
- Existing codebase: sdfPrimitives.ts -- hash11, hash12, hash22, fbm, sdRoundBox, opS, pR all verified functional
- Existing codebase: backgroundRaymarch.ts -- camera model, map() dispatch, raymarch loop, fog verified from Phase 1
- Existing codebase: SdfParamRegistry.ts -- uniform generation, parameter bounds, Three.js integration verified
- Existing codebase: theme.ts -- TreeStyleParams interface, bgCam* parameters, THEME_PRESETS verified

### Secondary (MEDIUM confidence)
- hg_sdf library (github.com/mercury/hg_sdf) -- confirmed SDF primitive set does not include cliff; verified via web search
- Community Shadertoy consensus -- cliff/rock formations use composition of boxes + noise displacement; verified across multiple search results
- glsl-sdf-primitives npm package -- mirrors IQ distfunctions, no cliff primitive; verified via npm registry search

### Tertiary (LOW confidence)
- None. All claims are either verified against primary codebase sources or confirmed via multiple secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new npm packages needed; all infrastructure exists from Phase 1
- Architecture: HIGH -- pattern follows existing ARCH-01 precedent (modular .glsl files, main map() dispatch)
- Pitfalls: MEDIUM -- fog masking for near-field gap requires implementation-time validation; screen coverage percentage depends on camera pitch tuning

**Research date:** 2026-04-29
**Valid until:** 2026-05-29 (stable domain -- SDF raymarching fundamentals do not change rapidly)

---
*Research compiled from Inigo Quilez distfunctions reference, existing codebase analysis, and GLSL shader community sources.*
