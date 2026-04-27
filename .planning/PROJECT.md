# Acacia

## What This Is

Acacia 是一个 AI 增强的知识管理平台。用户输入零散知识点或文件 → AI 自动生成结构化知识树 → 自动产生测验题 → 通过每日测验巩固记忆。Web-first，浏览器访问，不需要本地安装。

## Core Value

帮助用户建自己的地基——AI 是提效工具，不是思考的替代品。降低学习摩擦 + 提供正反馈闭环。

## Requirements

### Validated

- ✓ 层级笔记 CRUD（树状结构、父子节点、面包屑导航）— 已有
- ✓ JWT 用户名/密码认证 — 已有
- ✓ TipTap 富文本编辑器 — 已有
- ✓ SQLite 数据存储（WAL 模式）— 已有
- ✓ 基础测验记录（QuizRecords）— 已有
- ✓ AI 生成 pipeline（SiliconFlow API）— 已有，基础可用
- ✓ SDF 光线步进背景管线（4 风格：default/sakura/cyberpunk/ink）— WIP
- ✓ PWA 离线支持 — 已有
- ✓ Docker + Nginx 部署 — 已有
- ✓ Debug GUI（lil-gui，开发模式）— 已有

### Active

- [ ] SDF 背景四层纵深结构——近景树 / 底部5-10%地面 / 中部60-80%建筑风景 / 顶部10-20%天空
- [ ] 4 主题 × 完整背景参数预设，参数独立且覆盖几何+颜色
- [ ] 主题切换 2 秒平滑插值过渡
- [ ] 参数元数据 schema 驱动（新增参数 = 一行 JSON，消除 3 文件重复声明）
- [ ] 着色器编译失败检测与降级提示
- [ ] AI 从零散输入/文件自动生成结构化知识点树
- [ ] AI 知识点自动定位到准确树路径
- [ ] 每日测验推送与正反馈闭环
- [ ] 新用户 5 分钟完成"输入 → 生成知识点树 → 完成一次测验"闭环
- [ ] 无需文档即可上手

### Out of Scope

- 移动端 App — Web 响应式优先
- Obsidian/Notion 插件 — 独立 Web 应用
- 实时协作 — 单人使用场景
- 视频/音频笔记 — v1 只做文本
- OAuth 第三方登录 — 用户名/密码足够
- 性能自动检测/降级 — 等主题系统稳定后再做

## Context

- 单人开发，已有 VPS + GitHub Actions CI/CD 部署管线
- 创始人自己是第一个用户，核心假设待验证：存在一群被 Obsidian/Notion 高门槛劝退但渴望系统化学习的知识工作者
- 当前用户留存完全依赖自发性坚持——缺少外部正反馈机制
- AI 时代提升了工作效率但侵蚀了学习动力——用户依赖 AI 建"空中楼阁"
- SiliconFlow API 用于 AI 生成，成本需关注
- 前端 SDF 背景管线是视觉差异化核心，当前 WIP 状态：参数可调但画面空洞

## Constraints

- **人力**: 单人开发
- **技术栈**: Vue 3 + TypeScript + Vite（前端），FastAPI + SQLite（后端），不可更换
- **AI 依赖**: SiliconFlow API，需关注可用性和成本
- **部署**: 自托管 VPS，Nginx 反代，Web-first
- **语言**: UI 中文

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Approach B：三管齐下（笔记+测验+AI树+视觉） | 用户首次打开即完整体验，视觉差异化拉新 | — Pending |
| SDF 光线步进做背景而非静态图片/CSS | 视觉差异化核心，参数化可控，与原树渲染管线统一 | — Pending |
| Debug GUI 仅开发模式 | 参数调节面向开发者，用户通过主题预设切换 | — Pending |
| BackgroundPreset 合并进 TreeStyleParams | 消除独立类型，ThemeTransition 自然覆盖颜色+几何 | — Pending |

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
*Last updated: 2026-04-27 after initialization*
