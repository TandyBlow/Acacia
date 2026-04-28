## Open Questions (RESOLVED)

1. **uFovZoom 是否需要映射为非线性的 FOV 角度？** — **RESOLVED**
   - What we know: 当前 `zoom = 1.8` 在线性缩放射线方向。标准 FOV 角度通过 `tan(fov/2)` 控制。线性缩放近似正确，但对于极端 FOV 值（接近 180 度）会有扭曲。
   - What's unclear: 是否需要一个映射函数 `uFovZoom = tan(fovRad/2)` 还是维持直观的线性缩放。
   - Recommendation: 保持线性缩放（与当前行为一致），在计划中标注此决策点供 discuss-phase 确认。当前参数范围 0.5-5.0 内线性缩放工作良好。

2. **鼠标视差偏移应该应用在哪个阶段？** — **RESOLVED**
   - What we know: CAM-05 要求"远景层偏移量最大 3%"。视差偏移可以在 raymarch 前（偏移 UV）、raymarch 后（偏移颜色采样）、或偏移射线原点来实现。
   - What's unclear: 需求未指定实现方式——改变 UV 再 raymarch 会产生几何视差（3D 感），仅偏移最终屏幕 UV 会产生图像视差（2D 位移）。
   - Resolution: 采用 raymarch 后 color 采样偏移方案——在 main() 中 raymarch 循环结束后使用 `smoothstep(PARALLAX_THRESHOLD, ...)` 计算距离相关的 parallaxFactor，对 sky gradient 分支应用 `parallaxOffsetX` 偏移 UV 采样。平台层（t < 20.0）不受影响，远景层（t > 20.0）和天空（miss）获得偏移。实现代码见 Plan 01-01 Task 2 step 2e。

3. **未来新增 vista map 时 .glsl 文件的注册机制？** — **RESOLVED**
   - What we know: Phase 1 只有 4 种风格，Phase 3 的模板系统可能产生更多 vista 类型。
   - What's unclear: 是否需要自动发现 .glsl 文件（如 `import.meta.glob`），还是手动注册新 map。
   - Resolution: Phase 1 采用显式导入（手动 import），Phase 3 可演进为 `import.meta.glob('./vista/*.glsl', { query: '?raw', import: 'default', eager: true })` 自动发现。当前阶段简单显式即可。

4. **Camera pitch 的 "look-distance" 是否应该作为独立的显式参数？** — **RESOLVED**
   - What we know: PROJECT.md 决策说 "look-distance from pitch (隐式派生)"。当前方案 forward 由 pitch 直接确定，没有独立的 look-distance 参数。
   - What's unclear: 是否需要在未来某些风格中控制"看的远近"。
   - Resolution: 维持隐式派生（符合已有决策）。look-distance 实际上由 `tMax = uFogDistance + 10.0` 隐式控制——远景在雾中消失的距离。