# Requirements: Acacia -- SDF 背景风格视觉引擎

**Defined:** 2026-04-28
**Core Value:** 帮助用户建自己的地基——AI是提效工具，不是思考的替代品。背景视觉随用户知识成长而自然演化。

## v1 Requirements

Requirements for the SDF background style engine phase. Each maps to roadmap phases.

### Camera & Rendering

- [ ] **CAM-01**: Shader 声明 uCamY/uCamPitch/uCamZ/uFovZoom uniform，替换硬编码的 ro/lookAt/zoom 值
- [ ] **CAM-02**: 相机向下俯视——lookAt.y < ro.y，pitch 为负值，画面主体为斜向下俯瞰的远景
- [ ] **CAM-03**: BackgroundRenderer 通过 SdfParamRegistry.applyParamsToUniforms 传入相机参数
- [ ] **CAM-04**: 每风格定义 bgCam* 基准值，不同风格相机高度和俯角有微妙差异但结构性不变
- [ ] **CAM-05**: 鼠标视差深度——shader 添加 uniform vec2 uMouseUV，远景层偏移量最大 3%，平台层不受影响

### Foreground Platform SDF

- [ ] **PLAT-01**: 新增 sdCliff(p, width, height, edgeRound) SDF 原语
- [ ] **PLAT-02**: 新增 sdPlatform(p, type) 分发函数，根据平台类型路由到具体 SDF
- [ ] **PLAT-03**: 平台放置在相机前方近距离（z≈2-5），占据屏幕底部约 5%
- [ ] **PLAT-04**: 5 种平台类型 SDF：山崖/观景台/天台/寺庙台基/巨石
- [ ] **PLAT-05**: 每平台类型 2-3 个小型细节 SDF（栏杆/碎石/空调外机/草丛/石灯等），hash11 固定放置

### Style Template System

- [ ] **TMPL-01**: StyleTemplate 接口定义：{ platformType, vistaType, skyPalette, detailSet, timeOfDayBias }
- [ ] **TMPL-02**: templateToParams(t: StyleTemplate): TreeStyleParams 纯函数——查表+叠加组合维度参数
- [ ] **TMPL-03**: 风格维度映射覆盖全部 TreeStyleParams（不仅是 bg*），非背景参数（trunk/leaf/bloom/outline/particles）也由维度派生
- [ ] **TMPL-04**: ~100 个有效模板存储在 THEME_TEMPLATES: StyleTemplate[] 数组
- [ ] **TMPL-05**: 不合理组合自动过滤（如城市天际线+山崖平台→自动改用天台平台）
- [ ] **TMPL-06**: validateStyleParams() 在 templateToParams 和 LLM 生成路径上均运行

### Style Transition

- [ ] **TRAN-01**: Shader 同时持有 uStyleType 和 uStyleTypeTarget（均为 int）
- [ ] **TRAN-02**: 连续 lerp 项（3 秒，easeInOutCubic）：相机参数、天空颜色、雾距离、粒子颜色
- [ ] **TRAN-03**: 离散切换项（t=0.5）：uStyleType（map 函数）、粒子形状
- [ ] **TRAN-04**: 雾遮蔽曲线：t∈[0.3, 0.5] uFogDistance 降至 40%，t∈[0.5, 0.7] 恢复至 100%
- [ ] **TRAN-05**: BackgroundRenderer 管理过渡状态机：idle → transitioning → idle
- [ ] **TRAN-06**: 过渡中收到新触发：以当前中间状态为新起点，目标变更为新风格（无排队）
- [ ] **TRAN-07**: ThemeTransition 继续负责树渲染参数（trunk/leaf/wind/lighting），shader 过渡负责背景参数，两者并行无冲突

### Knowledge-Driven Style Triggering

- [ ] **TRIG-01**: 新增 frontend/src/composables/useStyleTrigger.ts 触发子系统
- [ ] **TRIG-02**: 触发条件——主领域切换：全部节点最常见 domain_tag 发生变化（众数变更）
- [ ] **TRIG-03**: 触发条件——掌握度跨阈值：平均 mastery_score 跨越 0.25 的整数倍边界（0.25/0.50/0.75）
- [ ] **TRIG-04**: 触发条件——新领域出现：新 domain_tag 出现在超过 20% 的节点中
- [ ] **TRIG-05**: 防抖：两次触发之间至少间隔 60 秒
- [ ] **TRIG-06**: 触发检测在 Pinia nodeStore watcher 中运行（每次 CRUD 后），不阻塞渲染
- [ ] **TRIG-07**: 后端 GET /api/nodes/style-context 返回用户领域分布和平均掌握度（降级方案：前端本地计算）

### Time-of-Day System

- [ ] **TOD-01**: Shader 添加 uniform float uTimeOfDay（0.0-1.0，24h 归一化）
- [ ] **TOD-02**: uTimeOfDay 基于系统实时时钟（new Date().getHours() / 24）
- [ ] **TOD-03**: 每风格定义 dawn/noon/dusk/night 四组颜色覆盖
- [ ] **TOD-04**: 在相邻时段调色板之间 lerp 平滑过渡
- [ ] **TOD-05**: 每风格可定义 timeOfDayOffset（0.0-0.5）偏移基准时刻

### LLM Style Generation (Backend)

- [ ] **LLM-01**: POST /api/styles/generate 端点，接收知识数据摘要，返回 TreeStyleParams JSON
- [ ] **LLM-02**: 使用 SiliconFlow API（已有 SILICONFLOW_API_KEY）
- [ ] **LLM-03**: 生成结果通过 validateStyleParams() 校验，失败静默丢弃并 console.warn
- [ ] **LLM-04**: 系统后台调用，非用户触发

### Error Handling & Degradation

- [ ] **ERR-01**: Shader 编译失败回退到现有 2D 天空渐变（sky2d.ts），日志记录编译错误
- [ ] **ERR-02**: WebGL context 丢失保持 SceneManager 现有处理器
- [ ] **ERR-03**: 移动端 shader 编译失败渐进降级：检测失败→减少 map 函数→回退 sky2d
- [ ] **ERR-04**: 模板展开/LLM 生成路径统一 validateStyleParams() 确保所有值在有效范围内

### Architecture & Code Quality

- [ ] **ARCH-01**: Shader 文件拆分——每 vista map 函数独立 .glsl 文件，Vite raw import 动态组合
- [ ] **ARCH-02**: 粒子系统重新启用（当前代码库中存在但被禁用的 particle.ts），作为天空层视觉生命
- [ ] **ARCH-03**: SDF raymarch 性能预算达标：桌面端 60fps / 移动端 30fps，80 步上限
- [ ] **ARCH-04**: 近远几何步进优化：平台 SDF bounding sphere 在 t>5 后不再参与 map 计算

## v2 Requirements

Deferred to future release.

### Weather & Polish

- **WTHR-01**: 天气粒子效果（雨/雪/闪电）— shader 复杂度超出当前范围
- **WTHR-02**: prefers-reduced-motion 支持——过渡动画和视差在用户系统设置下禁用
- **WTHR-03**: 过渡雾遮蔽验证——指数雾对近景(z≈5)可能遮蔽不足，需实现时实测

## Out of Scope

| Feature | Reason |
|---------|--------|
| 3D 相机飞越 | 需要完整 3D 场景几何，与当前 SDF raymarch 架构不兼容 |
| 声音/音效系统 | 非视觉系统，独立功能领域 |
| 用户手动切换风格 UI | 风格由知识数据自动驱动，不需要手动 UI |
| 移动端 App | Web 响应式优先 |
| OAuth 第三方登录 | 用户名/密码足够 |
| 实时协作 | 单人使用场景 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CAM-01 | Phase 1 | Pending |
| CAM-02 | Phase 1 | Pending |
| CAM-03 | Phase 1 | Pending |
| CAM-04 | Phase 1 | Pending |
| CAM-05 | Phase 1 | Pending |
| PLAT-01 | Phase 2 | Pending |
| PLAT-02 | Phase 2 | Pending |
| PLAT-03 | Phase 2 | Pending |
| PLAT-04 | Phase 2 | Pending |
| PLAT-05 | Phase 2 | Pending |
| TMPL-01 | Phase 3 | Pending |
| TMPL-02 | Phase 3 | Pending |
| TMPL-03 | Phase 3 | Pending |
| TMPL-04 | Phase 3 | Pending |
| TMPL-05 | Phase 3 | Pending |
| TMPL-06 | Phase 3 | Pending |
| TRAN-01 | Phase 4 | Pending |
| TRAN-02 | Phase 4 | Pending |
| TRAN-03 | Phase 4 | Pending |
| TRAN-04 | Phase 4 | Pending |
| TRAN-05 | Phase 4 | Pending |
| TRAN-06 | Phase 4 | Pending |
| TRAN-07 | Phase 4 | Pending |
| TRIG-01 | Phase 5 | Pending |
| TRIG-02 | Phase 5 | Pending |
| TRIG-03 | Phase 5 | Pending |
| TRIG-04 | Phase 5 | Pending |
| TRIG-05 | Phase 5 | Pending |
| TRIG-06 | Phase 5 | Pending |
| TRIG-07 | Phase 5 | Pending |
| TOD-01 | Phase 6 | Pending |
| TOD-02 | Phase 6 | Pending |
| TOD-03 | Phase 6 | Pending |
| TOD-04 | Phase 6 | Pending |
| TOD-05 | Phase 6 | Pending |
| LLM-01 | Phase 7 | Pending |
| LLM-02 | Phase 7 | Pending |
| LLM-03 | Phase 7 | Pending |
| LLM-04 | Phase 7 | Pending |
| ERR-01 | Phase 8 | Pending |
| ERR-02 | Phase 8 | Pending |
| ERR-03 | Phase 8 | Pending |
| ERR-04 | Phase 8 | Pending |
| ARCH-01 | Phase 1 | Pending |
| ARCH-02 | Phase 6 | Pending |
| ARCH-03 | Phase 8 | Pending |
| ARCH-04 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 47 total
- Mapped to phases: 47
- Unmapped: 0

**Phase distribution:**
- Phase 1 (Camera & Shader Foundation): 6 requirements
- Phase 2 (Foreground Platform SDF): 5 requirements
- Phase 3 (Style Template System): 6 requirements
- Phase 4 (Style Transition Engine): 7 requirements
- Phase 5 (Knowledge-Driven Triggering): 7 requirements
- Phase 6 (Time-of-Day & Particles): 6 requirements
- Phase 7 (LLM Style Generation): 4 requirements
- Phase 8 (Error Handling & Performance): 6 requirements

---
*Requirements defined: 2026-04-28*
*Last updated: 2026-04-28 -- traceability populated by roadmap creation*
