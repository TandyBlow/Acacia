# Acacia

## What This Is

Acacia 是一个 AI 增强的知识管理平台。用户输入零散知识点或文件 → AI 自动生成结构化知识树 → 自动产生测验题 → 通过每日测验巩固记忆。Web-first，浏览器访问。核心视觉特征：SDF 光线步进实时渲染的3层纵深背景（天空/远景/前景平台），风格由知识数据驱动自动切换，非用户手动选择。

## Core Value

帮助用户建自己的地基——AI 是提效工具，不是思考的替代品。降低学习摩擦 + 提供正反馈闭环。背景视觉是差异化核心——让每次打开应用都是一次沉浸式体验，风格随用户知识成长而自然演化。

## Requirements

### Validated

- ✓ 层级笔记 CRUD（树状结构、父子节点、面包屑导航）— 已有
- ✓ JWT 用户名/密码认证 — 已有
- ✓ TipTap 富文本编辑器 — 已有
- ✓ SQLite 数据存储（WAL 模式）— 已有
- ✓ 基础测验记录（QuizRecords）— 已有
- ✓ AI 生成 pipeline（SiliconFlow API）— 已有，基础可用
- ✓ SDF 光线步进背景管线（4 风格原型：default/sakura/cyberpunk/ink）— WIP
- ✓ PWA 离线支持 — 已有
- ✓ Docker + Nginx 部署 — 已有
- ✓ Debug GUI（lil-gui，开发模式）— 已有

### Active

- [ ] **SDF-01**: 相机系统重连——shader 使用 uCamY/uCamPitch/uCamZ/uFovZoom uniform 替换硬编码值，相机向下俯视（负pitch）
- [ ] **SDF-02**: 前景平台 SDF——sdCliff/sdPlatform 原语，平台在屏幕底部约5%，相机前方 z≈2-5
- [ ] **SDF-03**: 风格模板系统——5平台类型×6远景类型×5天空调色板=~100种风格由维度组合生成，templateToParams() 纯函数映射
- [ ] **SDF-04**: 风格过渡动画——3秒 easeInOutCubic，连续参数 lerp + t=0.5 原子切换 map 函数 + 雾遮蔽 pop
- [ ] **SDF-05**: 知识数据驱动风格切换——domain_tag 众数变更 / mastery_score 跨 0.25 阈值 / 新领域出现 >20%，useStyleTrigger.ts 触发子系统
- [ ] **SDF-06**: 鼠标视差深度——uMouseUV 驱动远景层最大3%偏移，平台层不受影响
- [ ] **SDF-07**: 时段系统——uTimeOfDay（0-1，24h归一化）基于系统实时时钟，每风格 dawn/noon/dusk/night 四组调色板 lerp
- [ ] **SDF-08**: 平台边缘细节物体——每平台类型2-3个小型SDF（栏杆/碎石/空调外机/草丛/石灯等），hash11 固定放置
- [ ] **SDF-09**: LLM 自动风格生成——POST /api/styles/generate，接收知识数据摘要返回 TreeStyleParams，validateStyleParams() 校验
- [ ] **SDF-10**: Shader 文件拆分——每 vista map 函数独立 .glsl 文件，Vite raw import 动态组合
- [ ] **SDF-11**: 性能预算达标——桌面端 60fps / 移动端 30fps，80 步 raymarch，过渡期间单 map 函数
- [ ] **SDF-12**: 降级与错误处理——shader 编译失败回退 2D 天空渐变，移动端渐进降级
- [ ] **AI-01**: AI 从零散输入/文件自动生成结构化知识点树
- [ ] **AI-02**: AI 知识点自动定位到准确树路径
- [ ] **AI-03**: 每日测验推送与正反馈闭环
- [ ] **AI-04**: 新用户 5 分钟完成"输入 → 生成知识点树 → 完成一次测验"闭环

### Out of Scope

- 移动端 App — Web 响应式优先
- Obsidian/Notion 插件 — 独立 Web 应用
- 实时协作 — 单人使用场景
- 视频/音频笔记 — v1 只做文本
- OAuth 第三方登录 — 用户名/密码足够
- 3D 相机飞越 — 与当前 SDF raymarch 架构不兼容
- 天气粒子效果（雨/雪/闪电）— shader 复杂度超出当前范围
- 声音/音效系统
- 用户手动切换风格 UI — 风格由知识数据自动驱动
- prefers-reduced-motion 支持 — 延期到 TODOS.md

## Context

- 单人开发，已有 VPS + GitHub Actions CI/CD 部署管线
- 创始人自己是第一个用户，核心假设待验证：存在一群被 Obsidian/Notion 高门槛劝退但渴望系统化学习的知识工作者
- 当前用户留存完全依赖自发性坚持——缺少外部正反馈机制
- AI 时代提升了工作效率但侵蚀了学习动力——用户依赖 AI 建"空中楼阁"
- SiliconFlow API 用于 AI 生成，成本需关注
- 前端 SDF 背景管线是视觉差异化核心，当前 WIP 状态：参数可调但画面空洞
- 背景 3 层纵深结构：天空（上 45-50%）→ 远景 vista（中 40-50%，斜向下俯瞰）→ 前景平台（底部约 5%，树站立其上）
- 相机始终在观景点位置（平台上方），视角向下倾斜（负 pitch），不同风格相机高度和俯角微妙差异
- 风格生成维度：5 平台类型 × 6 远景类型 × 5 天空调色板 ≈ 100 种有效组合 + 连续时段偏移
- 触发数据需要后端 `GET /api/nodes/style-context` 端点（降级方案：前端本地计算）
- 过渡期间 shader 同时持有 uStyleType 和 uStyleTypeTarget，t=0.5 原子切换 map 函数

## Constraints

- **人力**: 单人开发
- **技术栈**: Vue 3 + TypeScript + Vite（前端），FastAPI + SQLite（后端），不可更换
- **AI 依赖**: SiliconFlow API，需关注可用性和成本
- **部署**: 自托管 VPS，Nginx 反代，Web-first
- **语言**: UI 中文
- **性能**: SDF raymarch 上限 80 步，桌面端 60fps / 移动端 30fps，过渡期间单 map 函数（不做双 raymarch）
- **shader 架构**: 单一 shader 包含所有 vista+平台+细节，移动端需渐进降级

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 风格由维度组合生成，非手工编写 | 100 种风格不可逐个手写参数 | — Pending |
| 风格切换由知识数据驱动，非用户手动 | 背景随知识成长演化，降低用户认知负担 | — Pending |
| 过渡动画采用中点原子切换+雾遮蔽，非 SDF 混合或双 raymarch | mix(mapA, mapB) 对异质几何无意义，双 raymarch 160 步超性能预算 | — Pending |
| 相机 4 参数模型（yaw 固定为0，look-distance 由 pitch 隐式派生） | 保持简洁，4 参数足以定义向下俯视机位 | — Pending |
| 时段基于系统实时时钟（非节点 updated_at） | 背景随一天时间自然变化，与用户数据无关 | — Pending |
| Shader 文件拆分：每 vista map 独立 .glsl + Vite raw import | 便于 LLM 生成新 vista 类型，需通过 shader 注册校验 | — Pending |
| ThemeTransition 继续管树渲染参数，shader 过渡管背景参数 | 两者并行但控制不同参数域，无冲突 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-28 after CEO plan scope expansion*
