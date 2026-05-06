# QA Report — Code-Level QA

**分支**: `phase/01-sdf-background-completion`
**日期**: 2026-04-28
**模式**: 代码级 QA（标准层，无浏览器自动化）
**框架**: Vue 3 + TypeScript + Three.js (GLSL shaders)
**运行时长**: ~18 分钟

---

## 测试结果汇总

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| 测试文件 | 6 | 6 |
| 通过 | 32 | 40 |
| 失败 | 8 | 0 |
| 类型错误 | 0 | 0 |

---

## 发现的问题

### ISSUE-001 [HIGH] — TreeStyleParams 缺少 bg* 背景参数

**分类**: Functional
**文件**: `frontend/src/constants/theme.ts`

`SdfParamRegistry` 通过 `tsKey` 引用 `bgCamY`、`bgCamPitch`、`bgCamZ` 等 12 个背景参数，但 `TreeStyleParams` 接口未定义这些字段。所有 4 个主题预设也缺少对应值。导致 5 个测试失败。

**影响测试**:
- `theme.spec.ts`: "each theme preset has all required bg* parameters" (FAILED)
- `theme.spec.ts`: "each theme has unique visual identity" (FAILED)
- `sdfParamRegistry.spec.ts`: "all tsKey values exist in TreeStyleParams" (FAILED)
- `themeTransition.spec.ts`: 3 个测试因 `bgCamY` 缺失而失败

**修复** (commit `4c47a2b`):
- 在 `TreeStyleParams` 接口添加 12 个 `bg*` 字段
- 为 `THEME_DEFAULT`、`THEME_SAKURA`、`THEME_CYBERPUNK`、`THEME_INK` 提供各有区分度的值

**修复状态**: verified

---

### ISSUE-002 [MEDIUM] — Shader map 函数使用硬编码地面高度

**分类**: Functional
**文件**: `frontend/src/components/tree/shaders/backgroundRaymarch.ts`

所有 4 个 map 函数（`mapDefault`/`mapSakura`/`mapCyberpunk`/`mapInk`）调用 `sdPlane(p, vec3(0,1,0), 0.5)`，使用硬编码值 `0.5` 而非 `uGroundY` uniform。Shader 中未声明 `uGroundY` uniform。

**影响测试**:
- `backgroundLayers.spec.ts`: "mapDefault uses ground plane via sdPlane with uGroundY" (FAILED)

**修复** (commit `01e033e`):
- 在 shader 顶部添加 `uniform float uGroundY;`
- 将所有 4 个 `sdPlane` 调用中的 `0.5` 替换为 `uGroundY`

**修复状态**: verified

---

### ISSUE-003 [MEDIUM] — Shader 迭代密度不足

**分类**: Functional
**文件**: `frontend/src/components/tree/shaders/backgroundRaymarch.ts`

- `mapSakura` 中 machiya 循环仅 6 次迭代（要求 >= 20）
- `mapCyberpunk` 两轮摩天楼循环总计 12 + 8 = 20 次（要求 >= 45）

**影响测试**:
- `backgroundLayers.spec.ts`: "mapSakura has >= 20 machiya in loop" (FAILED)
- `backgroundLayers.spec.ts`: "mapCyberpunk has >= 45 total skyscraper iterations" (FAILED)

**修复** (commit `01e033e`):
- mapSakura: `i < 6` → `i < 20`
- mapCyberpunk: `i < 12` → `i < 25`, `i < 8` → `i < 20`（总计 45）

**修复状态**: verified

---

### ISSUE-004 [MEDIUM] — BackgroundRenderer.paramsFromTheme 使用硬编码值

**分类**: Functional
**文件**: `frontend/src/components/tree/scene/BackgroundRenderer.ts`

`paramsFromTheme` 方法（第 107-109 行）将 `fogDistance`、`buildingDensity`、`buildingHeight` 硬编码为 `60.0`/`0.5`/`4.0`，而非从 `TreeStyleParams` 的 `bgFogDistance`/`bgBuildingDensity`/`bgBuildingHeight` 读取。尽管 ISSUE-001 已添加这些参数，但它们与渲染器未连接——主题切换不会真正改变雾距、建筑密度和高度。

**发现方式**: 代码静态分析

**修复** (commit `84fef17`):
- 将 `paramsFromTheme` 中的硬编码值改为 `theme.bgFogDistance`、`theme.bgBuildingDensity`、`theme.bgBuildingHeight`

**修复状态**: verified

---

## 修复后的测试结果

```
✓ src/constants/__tests__/theme.spec.ts (4 tests)
✓ src/components/tree/__tests__/themeTransition.spec.ts (6 tests)
✓ src/components/tree/__tests__/backgroundLayers.spec.ts (8 tests)
✓ src/components/tree/__tests__/sdfParamRegistry.spec.ts (14 tests)

Test Files  6 passed (6)
     Tests  40 passed (40)
```

TypeScript 类型检查: 零错误

---

## 健康评分

| 类别 | 权重 | 得分 | 说明 |
|------|------|------|------|
| Functional | 20% | 75 | 4 个问题: 1 HIGH(-25) + 3 MEDIUM(-0, 修复前) |
| 测试覆盖 | - | 100 | 40/40 通过, 0 失败 |

**最终评分**: 无法计算完整加权分数（仅代码级 QA，缺少浏览器维度的 Console/Links/Visual/UX/Accessibility 类别）。功能性维度从修复前的严重断裂（5 测试失败）恢复到完整通过。

---

## 提交历史

```
84fef17 fix(qa): ISSUE-004 — paramsFromTheme 使用硬编码值，改为读取 TreeStyleParams.bg*参数
01e033e fix(qa): ISSUE-002/003 — shader 中使用 uGroundY 替代硬编码值并增加循环迭代次数
4c47a2b fix(qa): ISSUE-001 — 在 TreeStyleParams 中添加缺失的 bg* 背景参数
```

---

## 额外发现（未修复，非阻塞）

1. **Shader 相机位置硬编码**: `backgroundRaymarch.ts` 第 219 行的 `vec3 ro = vec3(0.0, 2.8, -6.0)` 和缩放 `zoom = 1.8` 未使用 SDF 参数注册表中的 `uCamY`/`uCamPitch`/`uCamZ`/`uFovZoom` uniform。这意味着 SdfParamRegistry 中的相机参数尚未连接到实际的 shader 渲染。

2. **BackgroundRenderer 构造函数的初始值硬编码**: 构造函数（第 32-42 行）中的 `uFogDistance`（60.0）、`uBuildingDensity`（0.5）、`uBuildingHeight`（4.0）使用硬编码默认值，而非主题值。`update()` 方法会覆盖这些值，但初始化时使用默认主题的值更合理。

---

## 总结

| | |
|---|---|
| 发现问题 | 4 (1 HIGH, 3 MEDIUM) |
| 已修复 | 4 |
| 修复验证通过 | 4 |
| 测试通过率 | 40/40 (100%) |
| 类型错误 | 0 |
