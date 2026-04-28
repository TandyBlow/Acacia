# Phase 1: Camera System & Shader Foundation - Research

**Researched:** 2026-04-28
**Domain:** Three.js ShaderMaterial + GLSL raymarch SDF pipeline + Vite raw asset import
**Confidence:** HIGH

## Summary

Phase 1 的核心任务是将 SDF 背景渲染管线中硬编码的相机参数替换为从 `TreeStyleParams` 传入的 4-parameter 相机模型（uCamY/uCamPitch/uCamZ/uFovZoom），同时完成 shader 文件拆分（ARCH-01），并添加鼠标视差深度效果（CAM-05）。

当前代码库状态：`SdfParamRegistry.ts` 已定义相机参数的 registry entries 和三个辅助函数（`generateGlslUniforms`、`createUniforms`、`applyParamsToUniforms`），但**三者均未被 BackgroundRenderer 或 shader 调用**。shader 的 `main()` 函数使用硬编码值（`ro = vec3(0.0, 2.8, -6.0)`、`lookAt = vec3(0.0, 3.5, 30.0)`、`zoom = 1.8`）。`TreeStyleParams` 接口已包含全部 bg* 参数（通过 ISSUE-001 修复），四个主题预设已各配置独特相机值，但数据从未流入 shader。

**Primary recommendation:** 改造 BackgroundRenderer 使用 SdfParamRegistry 统一管理 uniforms，shader 接收 uCamY/uCamPitch/uCamZ/uFovZoom 并替换硬编码的 ro/lookAt/zoom 计算。vista map 函数提取为独立 .glsl 文件通过 Vite `?raw` 导入。

## User Constraints (from CONTEXT.md)

> 无 CONTEXT.md — 此阶段为绿色地带（greenfield），无锁定决策约束。所有设计选择由研究推荐。

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAM-01 | Shader 声明 uCamY/uCamPitch/uCamZ/uFovZoom uniform，替换硬编码的 ro/lookAt/zoom 值 | 见第5节：相机参数模型，shader 需要新增 uniform 声明并重写 main() 中的相机计算 |
| CAM-02 | 相机向下俯视——lookAt.y < ro.y，pitch 为负值，画面主体为斜向下俯瞰的远景 | 当前代码 lookAt.y(3.5) > ro.y(2.8) ——实际上是仰视。修复后 forward.y=sin(负pitch) < 0 确保俯视 |
| CAM-03 | BackgroundRenderer 通过 SdfParamRegistry.applyParamsToUniforms 传入相机参数 | 见第4节：BackgroundRenderer 需重构以使用 createUniforms() 和 applyParamsToUniforms() |
| CAM-04 | 每风格定义 bgCam* 基准值，不同风格相机高度和俯角有微妙差异但结构性不变 | 已就绪——四个主题各配置了独特的 bgCamY/bgCamPitch/bgCamZ/bgFovZoom 值，仅需打通数据流 |
| CAM-05 | 鼠标视差深度——shader 添加 uniform vec2 uMouseUV，远景层偏移量最大 3%，平台层不受影响 | 见第6节：需要在 shader 中添加距离阈值判断，远景层根据 uMouseUV 偏移采样坐标 |
| ARCH-01 | Shader 文件拆分——每 vista map 函数独立 .glsl 文件，Vite raw import 动态组合 | 见第7节：4个 map 函数提取为独立 .glsl，Vite `?raw` 原生支持 |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 相机参数存储与定义 | Frontend Constants (TreeStyleParams) | — | bgCam* 参数是风格数据的一部分，存储在 theme.ts 的 THEME_PRESETS 中 |
| 相机参数 → shader uniform 传输 | Frontend Scene (BackgroundRenderer) | — | BackgroundRenderer 持有 ShaderMaterial 引用，直接写入 uniform value |
| 4-parameter → ro/lookAt/zoom 转换 | Fragment Shader (GLSL) | — | 相机计算在 GPU 上每个像素执行，属于 shader 职责 |
| 鼠标位置捕获 | Browser DOM | Frontend Scene | 监听 mousemove 事件，归一化到 [0,1] UV 空间 |
| uMouseUV → shader uniform | Frontend Scene (SceneManager) | BackgroundRenderer | SceneManager 持有容器引用，计算 mouseUV 后更新 shader uniform |
| Shader 文件拆分与组合 | Vite 构建系统 | Frontend Shader 模块 | .glsl 文件通过 Vite `?raw` 导入为字符串，在 TS 中拼接组合 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| three | 0.184.0 [VERIFIED: npm registry] | WebGL rendering, ShaderMaterial, full-screen quad | 已有依赖，项目 SDF 管线构建其上 |
| Vite | 7.2.4 [VERIFIED: npm registry] | 构建工具，原生 `?raw` 后缀支持字符串导入 | 不需要额外插件即可导入 .glsl 文件 |
| TypeScript | 5.9.3 [VERIFIED: npm registry] | 类型安全，`vite/client` 类型已包含 `?raw` 导入签名 | 项目已有 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.1.4 [VERIFIED: npm registry] | 单元/集成测试 | 所有 Phase 1 组件测试 |
| lil-gui | 0.21.0 [VERIFIED: npm registry] | 开发环境调试面板 | 调试相机参数和视差效果 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vite `?raw` native import | `vite-plugin-glsl` | 插件提供 `#include` 支持和压缩，但当前场景不需要跨文件 `#include`（map 函数独立完整），原生方案零依赖 |
| 手动声明 camera uniforms | 使用 THREE.ShaderMaterial 内置 `cameraPosition` | 内置 uniform 只有相机世界位置，无法传递 pitch/zoom 等自定义参数，不适用全屏 quad 的 raymarch 场景 |

**Installation:** 无需额外安装（所有依赖已在项目中）

**Version verification:**
```
three: 0.184.0 [npm view three version]
vitest: 4.1.4 [npm view vitest version]
typescript: 5.9.3 [package.json]
vite: 7.2.4 [package.json]
```

## Architecture Patterns

### System Architecture Diagram

```
+------------------------------------------------------------------+
|                     BROWSER DOM (MainLayout)                       |
|  mousemove event                                                  |
|    |                                                              |
|    v                                                              |
|  SceneManager.handleMouseMove(event)                              |
|    | 计算 mouseUV = (clientX/w, 1-clientY/h) 归一化到 [0,1]      |
|    |                                                              |
|    v                                                              |
|  BackgroundRenderer.updateMouseUV(mouseUV)                        |
|    | 写入 material.uniforms.uMouseUV.value                        |
|    |                                                              |
+----|--------------------------------------------------------------+
     |
     v  GPU: Fragment Shader (backgroundRaymarch)
+------------------------------------------------------------------+
|                          UNIFORM INPUTS                            |
|  uCamY ──────┐   uCamPitch ─────┐   uCamZ ───┐   uFovZoom ──┐   |
|  uStyleType ─┤   uMouseUV ──────┤            │              │   |
|  uSkyTopColor┤   uFogDistance ──┤            │              │   |
|  ...         │                  │            │              │   |
|              v                  v            v              v   |
|  +-----------------------------------------------------------+  |
|  |              CAMERA MATH (main() entry)                    |  |
|  |  ro = vec3(0.0, uCamY, uCamZ)                             |  |
|  |  forward = normalize(vec3(0, sin(uCamPitch), cos(uCamPitch))) |
|  |  right = normalize(cross(forward, worldUp))                |  |
|  |  up = cross(right, forward)                                |  |
|  |  rd = normalize(forward + right*uv.x*uFovZoom + up*uv.y*uFovZoom) |
|  +-----------------------------------------------------------+  |
|              |                                                  |
|              v                                                  |
|  +-----------------------------------------------------------+  |
|  |              RAYMARCH LOOP (max 80 steps)                  |  |
|  |  for each step:                                            |  |
|  |    p = ro + rd * t                                         |  |
|  |    d = map(p)  <── dispatches to map{Style}(p)             |  |
|  |    if d < 0.001: HIT → shading                             |  |
|  |    t += max(d * 0.8, 0.02)                                 |  |
|  +-----------------------------------------------------------+  |
|              |                    |                              |
|         HIT: toon shading    MISS: sky gradient                  |
|              |                    |                              |
|              v                    v                              |
|  +-----------------------------------------------------------+  |
|  |         PARALLAX (CAM-05): applied AFTER hit/miss          |  |
|  |  if t > PARALLAX_THRESHOLD (20.0):                         |  |
|  |    screenUV += (uMouseUV - 0.5) * PARALLAX_STRENGTH *      |  |
|  |                 clamp((t - 20.0) / 20.0, 0.0, 1.0)         |  |
|  |  else: 无偏移 (平台层不受影响)                              |  |
|  +-----------------------------------------------------------+  |
|              |                                                  |
|              v                                                  |
|  +-----------------------------------------------------------+  |
|  |         EXPONENTIAL FOG + OUTPUT                           |  |
|  |  fog = 1.0 - exp(-t / uFogDistance)                        |  |
|  |  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0))          |  |
|  |  gl_FragColor = vec4(col, 1.0)                             |  |
|  +-----------------------------------------------------------+  |
+------------------------------------------------------------------+
     ^
     |  IMPORTED AT BUILD TIME (Vite ?raw)
     |
+------------------------------------------------------------------+
|                    SHADER SOURCE COMPOSITION                       |
|                                                                   |
|  backgroundRaymarch.ts (main shader assembly):                    |
|    import mapDefault from './vista/mapDefault.glsl?raw'           |
|    import mapSakura from './vista/mapSakura.glsl?raw'             |
|    import mapCyberpunk from './vista/mapCyberpunk.glsl?raw'       |
|    import mapInk from './vista/mapInk.glsl?raw'                   |
|                                                                   |
|  exported fragmentShader = /* glsl */ `                            |
|    ${SDF_PRIMITIVES}         // 从 sdfPrimitives.ts              |
|    ${SDF_ARCHITECTURE}       // 从 sdfArchitecture.ts            |
|    ${mapDefault}             // 从 mapDefault.glsl?raw           |
|    ${mapSakura}              // 从 mapSakura.glsl?raw            |
|    ${mapCyberpunk}           // 从 mapCyberpunk.glsl?raw         |
|    ${mapInk}                 // 从 mapInk.glsl?raw               |
|    // ... uniform declarations (from generateGlslUniforms())     |
|    // ... main() + raymarch + lighting                           |
|  `                                                                |
+------------------------------------------------------------------+
```

### Recommended Project Structure

```
frontend/src/components/tree/
├── shaders/
│   ├── sdfPrimitives.ts          # SDF 基础原语（不变）
│   ├── sdfArchitecture.ts        # 建筑 SDF 组合（不变）
│   ├── glslNoise.ts              # 噪声函数（备用）
│   ├── backgroundRaymarch.ts     # 主 shader 组装文件（重构）
│   ├── crown.ts / trunk.ts / ... # 树渲染 shader（不变）
│   └── vista/                    # 新增：vista map 函数目录
│       ├── mapDefault.glsl       # 提取自 backgroundRaymarch.ts
│       ├── mapSakura.glsl        # 提取自 backgroundRaymarch.ts
│       ├── mapCyberpunk.glsl     # 提取自 backgroundRaymarch.ts
│       └── mapInk.glsl           # 提取自 backgroundRaymarch.ts
└── scene/
    ├── SdfParamRegistry.ts       # 参数注册表（已存在，将被集成使用）
    ├── BackgroundRenderer.ts     # 重构：使用 SdfParamRegistry + 新增相机/鼠标支持
    ├── SceneManager.ts           # 修改：添加鼠标事件监听 + mouseUV 计算
    ├── ThemeTransition.ts        # 不变
    ├── DebugGUI.ts               # 扩展：debug 面板添加相机/视差控制
    └── ...
```

### Pattern 1: 全屏 Quad + ShaderMaterial Raymarch（已有模式，延续）

**What:** 使用 `PlaneGeometry(2,2)` 覆盖整个屏幕空间，在 fragment shader 中对每个像素进行 raymarch。顶点 shader 仅透传屏幕 UV 坐标。

**When to use:** 全屏后处理效果、不需要 3D 几何的场景。

**Current implementation (backgroundRaymarch.ts):**
```glsl
// Source: existing codebase frontend/src/components/tree/shaders/backgroundRaymarch.ts
// Vertex
varying vec2 vScreenUV;
void main() {
  vScreenUV = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}

// Fragment — raymarch loop
for (int i = 0; i < 80; i++) {
  vec3 p = ro + rd * t;
  float d = map(p);
  if (d < 0.001) { hit = true; hitPos = p; hitNormal = calcNormal(p); break; }
  t += max(d * 0.8, 0.02);
  if (t > tMax) break;
}
```

### Pattern 2: SdfParamRegistry-Driven Uniform Management（新集成模式）

**What:** 所有 shader uniform 的声明、创建、值更新均由 `SdfParamRegistry` 集中管理，BackgroundRenderer 不再硬编码 uniform 列表。

**When to use:** Phase 1 开始全面应用，后续 Phase（Platform、Transition、TimeOfDay）新增参数均通过 Registry 注册。

**Data flow:**
```
TreeStyleParams (theme.ts)
    |
    v
[SdfParamRegistry] ── tsKey 映射 ──> [applyParamsToUniforms()] ──> THREE.ShaderMaterial.uniforms
    |
    v
[generateGlslUniforms()] ──> GLSL uniform 声明字符串 ──> fragment shader 源码
    |
    v
[createUniforms()] ──> THREE.IUniform 对象 ──> ShaderMaterial 构造函数
```

### Pattern 3: Vite Raw Import for GLSL Files（ARCH-01）

**What:** 每个 vista map 函数独立为 `.glsl` 文件，通过 Vite 的 `?raw` 后缀导入为字符串，在 TS 模块中拼接组合成完整 shader。

**When to use:** 所有独立可替换的 shader 代码块——vista map 函数、未来可能增加的平台 SDF、粒子 SDF。

**TypeScript 导入代码:**
```typescript
// Source: Vite documentation — native ?raw import
// frontend/src/components/tree/shaders/backgroundRaymarch.ts
import mapDefault from './vista/mapDefault.glsl?raw';
import mapSakura from './vista/mapSakura.glsl?raw';
import mapCyberpunk from './vista/mapCyberpunk.glsl?raw';
import mapInk from './vista/mapInk.glsl?raw';

export const backgroundFragmentShader = /* glsl */ `
${SDF_PRIMITIVES}
${SDF_ARCHITECTURE}
${mapDefault}
${mapSakura}
${mapCyberpunk}
${mapInk}

// ... uniform declarations + main() ...
`;
```

**注意:** `vite/client` 类型已通过 `tsconfig.app.json` 引入，包含 `*?raw` 模块签名，无需额外声明文件。

### Pattern 4: Event-Driven Mouse Parallax（CAM-05）

**What:** SceneManager 监听容器 `mousemove` 事件，计算归一化 mouseUV，通过 BackgroundRenderer 写入 shader uniform。Shader 根据 raymarch 距离判断是否为远景层并应用 UV 偏移。

**When to use:** 仅Phase 1 需要实现，后续 Phase 不改变此机制。

**External dependency:** DOM `mousemove` 事件 → `performance.now()` 不影响帧率。

### Anti-Patterns to Avoid

- **手动维护 uniform 列表:** 当前 `BackgroundRenderer` 构造函数硬编码 11 个 uniforms，新增参数需要修改 3 处（shader 声明、构造函数、`update()` 方法）。使用 SdfParamRegistry 后，新增参数仅需在 Registry 中添加一个 entry。
- **在 shader 中硬编码相机值:** 当前 `ro = vec3(0.0, 2.8, -6.0)` 和 `lookAt = vec3(0.0, 3.5, 30.0)` 硬编码。CAM-01 要求全部替换为参数驱动。
- **忽视 pitch 方向:** 当前 `lookAt.y = 3.5 > ro.y = 2.8` 导致实际上是仰视，违反了 CAM-02 的向下俯视设计意图。
- **在 TypeScript 中做 camera→ro/lookAt 转换:** 相机计算属于 shader 职责（每个像素共享同一相机参数），不应在 TypeScript 中预计算 ro/lookAt 再传入 shader。保持 TS 只传原始参数（uCamY/uCamPitch/uCamZ/uFovZoom），shader 自行计算。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| .glsl 文件导入为字符串 | 手写 FileReader + fetch 加载 | Vite `?raw` suffix | Vite 原生支持，零运行时开销，构建时内联，支持 HMR [VERIFIED: Vite 文档] |
| GLSL uniform 声明生成 | 手动逐个写 `uniform float ...` | `generateGlslUniforms()` | 已存在于 SdfParamRegistry，自动从 registry entries 生成所有声明 |
| GLSL map 函数动态组合 | 运行时条件包含 | Vite 构建时字符串拼接 | 所有 map 函数编译时静态组合，shader 内通过 `uStyleType` 分支选择（已有模式） |
| 鼠标坐标归一化 | 手写 clientX/clientWidth 计算 | 标准 `(clientX / width, 1 - clientY / height)` | 单行公式，无需额外库 |
| 相机基础向量计算 | 在 TS 中预计算 | Shader 中直接用均匀变量计算 | 避免 CPU→GPU 传输冗余中间值，shader 内计算更快且减少 uniform 数量 |

**Key insight:** SdfParamRegistry 的基础设施已经存在（注册表 + 3 个辅助函数），Phase 1 的核心工作是**集成**而非重写。当前 BackgroundRenderer 手动管理 uniforms 导致新参数添加需要多处修改，集成 Registry 后新增参数只需在注册表中加一行 entry。

## Common Pitfalls

### Pitfall 1: GLSL `?raw` 导入与 `/* glsl */` 标记冲突

**What goes wrong:** `.glsl` 文件是纯 GLSL 源码（无 TypeScript 语法），但项目现有的 shader 文件（如 `sdfPrimitives.ts`）使用 `/* glsl */` 标记的模板字面量。如果 `.glsl` 文件中残留 TypeScript 语法（如 `export const`），会导致编译错误。

**Why it happens:** 从 `.ts` 模板字面量迁移到 `.glsl?raw` 时，容易忘记移除 TypeScript 包装。

**How to avoid:**
1. 创建 `.glsl` 文件时直接写纯 GLSL 代码，不包含任何 TypeScript
2. `.glsl` 文件不需要 `export` 关键字——导入侧（`.ts` 文件）获得整个文件内容作为字符串
3. 保留现有的注释风格（`//` 和 `/* */`）因为它们也是合法的 GLSL 注释

**Warning signs:** Vite 构建时报 `Unexpected token` 或 `export` 在 `.glsl` 文件中的错误。

### Pitfall 2: 相机参数的物理语义错误

**What goes wrong:** 将 `uCamPitch` 的符号定义搞反——正 pitch = 向上看，但需求要求负 pitch = 向下看。如果 shader 计算 `forward.y = sin(uCamPitch)` 时 pitch 为正，会导致相机仰视。

**Why it happens:** 不同引擎/规范的 pitch 符号约定不同。需求明确规定负 pitch 为向下俯视（CAM-02: lookAt.y < ro.y）。

**How to avoid:**
- forward.y = sin(uCamPitch)（pitch 为负 → sin 为负 → forward.y < 0 → 向下看）
- 在主题预设中确保所有 bgCamPitch 值为负
- 添加单元测试验证 `sin(uCamPitch) < 0` 对所有主题预设成立

**Verified:** 当前所有主题预设 bgCamPitch 均为负值（-0.12 到 -0.2），正确。

### Pitfall 3: Parallax 距离阈值与平台层冲突

**What goes wrong:** 后续 Phase 2 添加的前景平台（z≈2-5）位于相机前方近距离，视差效果可能意外应用到平台上。

**Why it happens:** Phase 1 定义视差阈值时未考虑未来新增的近距离几何。

**How to avoid:**
- 设定 `PARALLAX_THRESHOLD = 20.0`（远大于平台 z≈5 的距离）
- 视差过渡区间设为 `t ∈ [20.0, 40.0]`：平台层 (z≈2-5) 完全不受影响
- Shader 中用 `smoothstep(PARALLAX_THRESHOLD, PARALLAX_THRESHOLD + 20.0, t)` 实现平滑过渡
- 注释中明确标注阈值与平台距离的关系

### Pitfall 4: SdfParamRegistry 的 Three.js Color 类型区分

**What goes wrong:** `applyParamsToUniforms` 对 `vec3` 类型使用 `THREE.Color.set()`，但对 `float` 类型直接赋值 `.value`。如果 Registry entry 的 `glslType` 与实际 uniform 类型不匹配，会导致静默错误。

**Why it happens:** `three@0.184` 的 `THREE.Color.set()` 期望 0-1 range 的 RGB 值，如果传入 0-255 range 会导致过曝。

**How to avoid:**
- 所有 color 参数在 TreeStyleParams 中定义为 `[number, number, number]`（0-1 range）
- 现有主题预设已验证所有颜色通道在 [0, 1] 范围内（theme.spec.ts 测试通过）
- 新增参数时遵循同一约定

**Verified:** `theme.spec.ts` 已测试所有颜色值在 [0, 1] 范围。

## Code Examples

Verified patterns from official sources and codebase:

### Camera Parameter Computation in GLSL (CAM-01, CAM-02)

```glsl
// Source: codebase analysis + camera math derivation
// Uniforms (generated by generateGlslUniforms() from SDF_PARAM_REGISTRY)
uniform float uCamY;       // 相机高度 (ro.y)
uniform float uCamPitch;   // 俯视角度，负值 = 向下看
uniform float uCamZ;       // 相机 Z 坐标 (ro.z)
uniform float uFovZoom;    // 视场缩放
uniform vec2 uMouseUV;     // 鼠标归一化坐标 [0,1] (CAM-05)

// In main():
// Camera position
vec3 ro = vec3(0.0, uCamY, uCamZ);

// Forward direction from pitch (yaw fixed at 0)
// uCamPitch < 0 → forward.y < 0 → looking downward
vec3 forward = normalize(vec3(0.0, sin(uCamPitch), cos(uCamPitch)));

// Camera basis vectors
vec3 worldUp = vec3(0.0, 1.0, 0.0);
vec3 right = normalize(cross(forward, worldUp));
vec3 up = cross(right, forward);

// Ray direction with FOV zoom
vec3 rd = normalize(forward + right * uv.x * uFovZoom + up * uv.y * uFovZoom);
```

### Vite Raw Import + Shader Assembly (ARCH-01)

```typescript
// Source: Vite documentation — native ?raw suffix
// frontend/src/components/tree/shaders/vista/mapDefault.glsl
// (纯 GLSL，无 TypeScript 包装)
// float mapDefault(vec3 p) {
//   float ground = sdPlane(p, vec3(0.0, 1.0, 0.0), uGroundY);
//   // ... hill elements ...
//   return d;
// }

// frontend/src/components/tree/shaders/backgroundRaymarch.ts
import mapDefault from './vista/mapDefault.glsl?raw';
import mapSakura from './vista/mapSakura.glsl?raw';
import mapCyberpunk from './vista/mapCyberpunk.glsl?raw';
import mapInk from './vista/mapInk.glsl?raw';
import { generateGlslUniforms } from '../scene/SdfParamRegistry';
import { SDF_PRIMITIVES } from './sdfPrimitives';
import { SDF_ARCHITECTURE } from './sdfArchitecture';

export const backgroundFragmentShader = /* glsl */ `
${SDF_PRIMITIVES}
${SDF_ARCHITECTURE}

// Vista map functions (one per style)
${mapDefault}
${mapSakura}
${mapCyberpunk}
${mapInk}

// Uniform declarations (auto-generated from registry)
${generateGlslUniforms()}

// Additional runtime uniforms (not in registry)
uniform float uTime;
uniform float uSeed;
uniform float uStyleType;
uniform vec2 uResolution;
uniform vec2 uMouseUV;  // CAM-05

varying vec2 vScreenUV;

// ... map() dispatch, calcNormal, applyToonLighting, softShadow, main() ...
`;
```

### BackgroundRenderer Integration with SdfParamRegistry (CAM-03)

```typescript
// Source: adapted from existing BackgroundRenderer.ts + SdfParamRegistry.ts
// frontend/src/components/tree/scene/BackgroundRenderer.ts
import * as THREE from 'three';
import { backgroundVertexShader, backgroundFragmentShader } from '../shaders/backgroundRaymarch';
import { createUniforms, applyParamsToUniforms } from './SdfParamRegistry';
import type { TreeStyleParams } from '../../../constants/theme';

export class BackgroundRenderer {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(styleType: number, seed: number) {
    const geo = new THREE.PlaneGeometry(2, 2);

    // 使用 SdfParamRegistry 创建所有注册的 uniforms
    const registryUniforms = createUniforms();

    this.material = new THREE.ShaderMaterial({
      vertexShader: backgroundVertexShader,
      fragmentShader: backgroundFragmentShader,
      uniforms: {
        ...registryUniforms,
        // 非注册的动态 uniforms
        uTime: { value: 0 },
        uSeed: { value: seed },
        uStyleType: { value: styleType },
        uResolution: { value: new THREE.Vector2(1024, 1024) },
        uMouseUV: { value: new THREE.Vector2(0.5, 0.5) }, // 初始居中
      },
      depthWrite: false,
      depthTest: false,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'background';
    this.mesh.renderOrder = -2;
    this.mesh.frustumCulled = false;
  }

  /** Update all registry-managed params from TreeStyleParams */
  updateParams(params: TreeStyleParams): void {
    applyParamsToUniforms(this.material.uniforms, params);
    // 非注册参数单独更新
    this.material.uniforms.uSeed!.value = this.seed;
    this.material.uniforms.uStyleType!.value = this.styleType;
  }

  /** Update mouse UV for parallax */
  updateMouseUV(mouseUV: { x: number; y: number }): void {
    this.material.uniforms.uMouseUV!.value.set(mouseUV.x, mouseUV.y);
  }

  // ... getMesh(), getMaterial(), updateTime(), updateSize(), dispose() 保持不变 ...
}
```

### Mouse Parallax in GLSL (CAM-05)

```glsl
// Source: requirement CAM-05 specification
// 在 main() 的 raymarch 循环之后，颜色计算之前：

#define PARALLAX_THRESHOLD 20.0   // 视差起始距离（远大于平台 z≈5）
#define PARALLAX_MAX_OFFSET 0.03  // 最大偏移 3%

// 根据命中距离计算视差偏移
float parallaxFactor = smoothstep(PARALLAX_THRESHOLD, PARALLAX_THRESHOLD + 20.0, t);
vec2 parallaxOffset = (uMouseUV - 0.5) * PARALLAX_MAX_OFFSET * 2.0 * parallaxFactor;

// 修正：对 sky（未命中）也应用微小的视差偏移
// 未命中时 t = tMax，parallaxFactor = 1.0，远景全部偏移
if (!hit) {
  parallaxFactor = 1.0;
  parallaxOffset = (uMouseUV - 0.5) * PARALLAX_MAX_OFFSET * 2.0;
}

// 将视差偏移应用到屏幕 UV（影响 sky gradient 的采样和后续处理）
// 注意：这是在 t 已计算之后应用——不影响 raymarch 本身，
// 只影响最终像素的色彩采样位置
float parallaxUV = vScreenUV.y + parallaxOffset.y * 0.5;  // 仅垂直方向
// 用于重新采样 sky gradient（可选，取决于效果需求）
```

### SceneManager Mouse Event Handler (CAM-05 wiring)

```typescript
// Source: adapted from SceneManager.ts existing event pattern
// frontend/src/components/tree/scene/SceneManager.ts

private mouseUV = { x: 0.5, y: 0.5 };  // 初始居中

private onMouseMove = (event: MouseEvent) => {
  const rect = this.container.getBoundingClientRect();
  this.mouseUV.x = (event.clientX - rect.left) / rect.width;
  this.mouseUV.y = 1.0 - (event.clientY - rect.top) / rect.height;

  if (this.backgroundRenderer) {
    this.backgroundRenderer.updateMouseUV(this.mouseUV);
  }
};

// 在 buildScene() 中添加：
this.renderer.domElement.addEventListener('mousemove', this.onMouseMove);

// 在 disposeScene() 中移除：
this.renderer.domElement.removeEventListener('mousemove', this.onMouseMove);
```

## State of the Art

| Old Approach | Current Approach (Phase 1) | When Changed | Impact |
|--------------|---------------------------|--------------|--------|
| 硬编码 `ro = vec3(0.0, 2.8, -6.0)` | `ro = vec3(0.0, uCamY, uCamZ)` | Phase 1 | 相机高度和前后位置可由风格参数控制 |
| 硬编码 `lookAt = vec3(0.0, 3.5, 30.0)` | `forward = normalize(vec3(0, sin(uCamPitch), cos(uCamPitch)))` | Phase 1 | 俯仰角度可调，负 pitch = 向下俯视 |
| 硬编码 `zoom = 1.8` | `uFovZoom` uniform | Phase 1 | 视场宽度可调 |
| 手动维护 uniform 列表 (11个) | SdfParamRegistry 集中管理 (15 entries) | Phase 1 | 新增参数只需加 registry entry |
| 所有 map 函数内联于 .ts 文件 | 独立 .glsl 文件 + Vite raw import | Phase 1 | 便于 LLM 生成新 vista、独立编辑 |
| 无鼠标交互 | uMouseUV + 远景视差偏移 | Phase 1 | 增加纵深感，提升沉浸体验 |
| 相机仰视 (lookAt.y > ro.y) | 相机俯视 (pitch < 0) | Phase 1 | 满足 CAM-02 设计意图 |

**Deprecated/outdated:**
- `BackgroundRenderer.paramsFromTheme()` 当前从 TreeStyleParams 中读取 7 个参数（不包含 bgCam*），Phase 1 之后此函数将被弃用，改为直接调用 `applyParamsToUniforms()`。
- `BackgroundRenderer.update(params: BackgroundUniformParams)` 的 `BackgroundUniformParams` 接口将被弃用，参数类型改为直接使用 `TreeStyleParams`。
- 硬编码的 `ro`/`lookAt`/`zoom` 值将从 shader 中完全移除。

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Vite `?raw` 后缀不需要额外插件即可导入 `.glsl` 文件 | Architecture Patterns → Pattern 3 | 如果 Vite 版本行为变化，可能需要安装 `vite-plugin-glsl`。fallback: 使用 `.ts` 模板字面量（当前模式） |
| A2 | `vite/client` 类型已包含 `*?raw` 的模块签名声明 | Architecture Patterns → Pattern 3 | 如果缺少类型声明，TypeScript 编译器会报 `Cannot find module`。修复：添加 `declare module "*.glsl?raw"` 到 `env.d.ts` |
| A3 | 当前相机实际为仰视（lookAt.y=3.5 > ro.y=2.8）而非向下俯视 | Common Pitfalls → Pitfall 2 | 如果分析错误，意味着 shader 已经在做俯视——但从几何上看 y=3.5 > y=2.8 是仰视无疑 |
| A4 | uFovZoom 改变 UV→世界空间的射线方向缩放 | Code Examples → Camera Parameter | 如果 FOV 的正确映射是改变投影而非射线缩放，需要调整实现。当前 `forward + right*uv.x*zoom + up*uv.y*zoom` 模式是 raymarch 全屏 quad 的标准做法 |
| A5 | 平台层距离 z≈2-5 远小于 PARALLAX_THRESHOLD=20.0 | Common Pitfalls → Pitfall 3 | 如果 Phase 2 平台距离设计变更超过 20，视差效果会误应用到平台。Phase 2 实现时需验证阈值 |

## Open Questions

1. **uFovZoom 是否需要映射为非线性的 FOV 角度？**
   - What we know: 当前 `zoom = 1.8` 在线性缩放射线方向。标准 FOV 角度通过 `tan(fov/2)` 控制。线性缩放近似正确，但对于极端 FOV 值（接近 180 度）会有扭曲。
   - What's unclear: 是否需要一个映射函数 `uFovZoom = tan(fovRad/2)` 还是维持直观的线性缩放。
   - Recommendation: 保持线性缩放（与当前行为一致），在计划中标注此决策点供 discuss-phase 确认。当前参数范围 0.5-5.0 内线性缩放工作良好。

2. **鼠标视差偏移应该应用在哪个阶段？**
   - What we know: CAM-05 要求"远景层偏移量最大 3%"。视差偏移可以在 raymarch 前（偏移 UV）、raymarch 后（偏移颜色采样）、或偏移射线原点来实现。
   - What's unclear: 需求未指定实现方式——改变 UV 再 raymarch 会产生几何视差（3D 感），仅偏移最终屏幕 UV 会产生图像视差（2D 位移）。
   - Recommendation: 在 raymarch 循环入口处对 `uv` 做微调（`uv += parallaxOffset`），产生真实的 3D 视差效果。这比后期位移更自然。计划中标注此决策供用户确认。

3. **未来新增 vista map 时 .glsl 文件的注册机制？**
   - What we know: Phase 1 只有 4 种风格，Phase 3 的模板系统可能产生更多 vista 类型。
   - What's unclear: 是否需要自动发现 .glsl 文件（如 `import.meta.glob`），还是手动注册新 map。
   - Recommendation: Phase 1 采用显式导入（手动 import），Phase 3 可演进为 `import.meta.glob('./vista/*.glsl', { query: '?raw', import: 'default', eager: true })` 自动发现。当前阶段简单显式即可。

4. **Camera pitch 的 "look-distance" 是否应该作为独立的显式参数？**
   - What we know: PROJECT.md 决策说 "look-distance from pitch (隐式派生)"。当前方案 forward 由 pitch 直接确定，没有独立的 look-distance 参数。
   - What's unclear: 是否需要在未来某些风格中控制"看的远近"。
   - Recommendation: 维持隐式派生（符合已有决策）。look-distance 实际上由 `tMax = uFogDistance + 10.0` 隐式控制——远景在雾中消失的距离。

## Environment Availability

> Step 2.6: SKIPPED (no external dependencies identified)

Phase 1 是纯前端代码+shader 修改，所有依赖已在项目中：
- Three.js 0.184.0 ✓
- Vite 7.2.4 ✓
- TypeScript 5.9.3 ✓
- Vitest 4.1.4 ✓

无需外部服务、数据库、或 CLI 工具。

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 |
| Config file | 无独立配置 — 使用 vite.config.ts 中的默认 vitest 集成 |
| Quick run command | `cd frontend && npx vitest run` |
| Full suite command | `cd frontend && npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CAM-01 | Shader 源码包含 uCamY/uCamPitch/uCamZ/uFovZoom uniform 声明 | unit | `npx vitest run src/components/tree/__tests__/sdfParamRegistry.spec.ts` | ✅ 已有 |
| CAM-01 | Shader 中不再包含硬编码的 ro/lookAt/zoom | unit | `npx vitest run src/components/tree/__tests__/backgroundLayers.spec.ts` | ✅ 已有（需扩展） |
| CAM-02 | 所有预设 bgCamPitch 值为负 | unit | `npx vitest run src/constants/__tests__/theme.spec.ts` | ✅ 已有（需扩展断言） |
| CAM-03 | applyParamsToUniforms 正确写入 bgCam* 到 uniforms | unit | `npx vitest run src/components/tree/__tests__/sdfParamRegistry.spec.ts` | ✅ 已有 |
| CAM-03 | BackgroundRenderer 使用 createUniforms() 创建 uniforms | unit | `npx vitest run src/components/tree/__tests__/backgroundRenderer.spec.ts` | ❌ Wave 0 |
| CAM-04 | 四个主题预设 bgCam* 值互不相同且有有效范围 | unit | `npx vitest run src/constants/__tests__/theme.spec.ts` | ✅ 已有 |
| CAM-05 | BackgroundRenderer.updateMouseUV() 写入 uMouseUV uniform | unit | `npx vitest run src/components/tree/__tests__/backgroundRenderer.spec.ts` | ❌ Wave 0 |
| ARCH-01 | 每个 .glsl 文件包含唯一的 map 函数定义 | unit | `npx vitest run src/components/tree/__tests__/vistaMaps.spec.ts` | ❌ Wave 0 |
| ARCH-01 | 组合后的 fragmentShader 包含所有 4 个 map 函数 | unit | `npx vitest run src/components/tree/__tests__/backgroundLayers.spec.ts` | ✅ 已有（需更新） |

### Sampling Rate
- **Per task commit:** `cd frontend && npx vitest run` （完整套件，<2秒）
- **Per wave merge:** `cd frontend && npx vitest run` （同上）
- **Phase gate:** 全部 40+ 测试通过（现有 40 个 + Wave 0 新增）

### Wave 0 Gaps
- [ ] `frontend/src/components/tree/__tests__/backgroundRenderer.spec.ts` — 覆盖 CAM-03、CAM-05（BackgroundRenderer 集成测试）
- [ ] `frontend/src/components/tree/__tests__/vistaMaps.spec.ts` — 覆盖 ARCH-01（.glsl 文件可导入 + 内容验证）
- [ ] 扩展现有 `backgroundLayers.spec.ts` — 添加 CAM-01 断言（无硬编码 ro/lookAt/zoom）
- [ ] 扩展现有 `theme.spec.ts` — 添加 CAM-02 断言（bgCamPitch 必须为负）
- [ ] 无需框架安装 — Vitest 已配置

## Security Domain

> Required: `security_enforcement` 默认启用（config.json 中无显式 `false`）

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 1 仅修改前端渲染管线，不涉及认证 |
| V3 Session Management | no | 不涉及 |
| V4 Access Control | no | 不涉及 |
| V5 Input Validation | **yes (low priority)** | uMouseUV 从 DOM 事件计算，需 clamp 到 [0,1] 范围防止异常值传入 shader |
| V6 Cryptography | no | 不涉及 |

### Known Threat Patterns for GLSL Shader/Three.js

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| uMouseUV 注入异常值（NaN/Infinity） | Denial of Service | 在 `updateMouseUV()` 中 clamp x,y 到 [0,1]，使用 `Number.isFinite()` 守卫 |
| Shader 编译失败导致白屏 | Denial of Service | 已有 ERR-01 降级方案（fallback 到 sky2d）。Phase 1 不引入新风险点 |
| `?raw` 导入注入恶意 GLSL | Tampering | Vite 构建时静态导入，无运行时注入路径。攻击者需要修改源码 |

**Phase 1 安全风险极低** — 所有修改在客户端渲染管线内，无网络边界，无数据持久化。

## Sources

### Primary (HIGH confidence)
- [Context7: 未使用 — 此研究基于本地代码库分析]
- [Vite 官方文档] — `?raw` suffix native import: https://vite.dev/guide/assets.html#importing-asset-as-string [CITED]
- [Three.js 0.184 ShaderMaterial 源码] — 内置 uniform 注入机制 (projectionMatrix, viewMatrix) [VERIFIED: 项目依赖]
- 本地代码库分析：BackgroundRenderer.ts, SdfParamRegistry.ts, backgroundRaymarch.ts, SceneManager.ts, theme.ts [VERIFIED: 直接读取]

### Secondary (MEDIUM confidence)
- [WebSearch: Three.js ShaderMaterial raymarch pattern] — Three.js Discourse / Codrops texture projection pattern [CITED]
- [WebSearch: Vite GLSL import approaches] — `vite-plugin-glsl` 对比 `?raw` native import [CITED]

### Tertiary (LOW confidence)
- 无（所有主张均通过代码库分析或官方文档验证）

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Three.js 0.184.0 + Vite 7.2.4，已在项目中验证
- Architecture: HIGH — 通过代码库直接读取和 6 个测试文件的运行验证
- Pitfalls: MEDIUM — 基于代码审查和数学推导，Phase 1 实际执行时可能发现边缘情况
- Don't Hand-Roll: HIGH — Vite `?raw` 是成熟特性，SdfParamRegistry 已有实现

**Research date:** 2026-04-28
**Valid until:** 2026-05-28 (30 天：Three.js 和 Vite 版本稳定)

**Current test state (pre-research):**
```
Test Files  6 passed (6)
     Tests  40 passed (40)
  Duration  1.56s
```
