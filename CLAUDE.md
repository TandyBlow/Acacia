# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 权威设计文档

项目设计以飞书文档为唯一权威来源，代码实现必须符合文档规范。

**飞书文档 URL**: https://ecnvi3wy83vn.feishu.cn/wiki/Uxe0wPonbiy6Ntk0HOucBRKhnxf

**何时必须查阅此文档**：
- 任何涉及 UI 布局、区域、动画的修改
- 任何涉及页面状态机（展示/添加/移动/删除/确认）的修改
- 任何涉及旋钮交互逻辑的修改
- 任何涉及面包屑、导航栏行为的修改
- 任何涉及设计系统（底部区域/活动区域/下沉区域/玻璃区域）的修改
- 不确定某个交互行为应该如何表现时

**查阅方式**: 使用飞书 MCP 工具 `feishu_read_doc` 读取文档内容。

文档涵盖：区域定义（底部区域/活动区域/下沉区域）、3种布局（大/中/小）、5个部分（LOGO/面包屑/导航栏/内容区/旋钮）、切换动画、各状态下的交互行为、专有名词定义。

## Project Overview

**Acacia** is a hierarchical note-taking web app. Users organize notes in a tree structure (parent-child nodes), navigate via breadcrumbs/sidebar, and edit content with a TipTap rich-text editor. Auth is username/password-based with JWT tokens, backed by SQLite.

## Architecture

The repo is split into two parts:

- **`frontend/`** — Vue 3 + TypeScript + Vite SPA. The main application.
- **`backend/`** — FastAPI app with SQLite database, JWT auth, and all CRUD/API logic.

### Data Flow

All frontend data flows through `DataAdapter` interface (`frontend/src/types/node.ts`). There are two implementations:

- **`backendAdapter`** — HTTP REST to FastAPI backend, the production adapter. `VITE_DATA_MODE` must be `backend`.
- **`localAdapter`** — localStorage-based, used for offline/dev without backend.

The active adapter is selected at import time by `VITE_DATA_MODE`. Production uses `backend` mode.

### State Management

Pinia stores (`frontend/src/stores/`):

- **`authStore`** — JWT auth session, login/register/logout.
- **`nodeStore`** — All tree state: active node, children, path breadcrumbs, CRUD operations, view state machine (`display | add | move | delete | logout`).

### 页面转换系统

全局页面转换动画系统 (`usePageTransition`) 统一管理所有界面切换的动画：

- **区域注册**：每个区域组件在挂载时注册自己的可见性判断函数
- **转换流程**：下沉 → 加载 → 区域对比 → 升起
- **触发点**：节点导航、布局切换、旋钮操作、窗口大小改变

所有界面切换都会触发统一的加载动画，确保视觉体验一致。

**小布局动画冲突规则**：小布局下 Navigation 组件有独立的内部动画（`animateSmallLayoutOfficial`、`animateSmallLayoutAdd`、`animateSmallLayoutReturn`），而 MainLayout 的 `animateContentTransition` 由 `isTransitioning` watch 触发。两者同时运行会互相踩踏。规则：小布局进出特殊状态（add/daily_quiz/welcome）时，Content 跳过 slide 动画，只做瞬间 DOM 交换，让 Navigation 的动画独占视觉过渡。

### 设计系统：区域层级

内容区的区域层级有严格定义，**修改时禁止违反以下规则**：

**底部区域**（`inset` type）：不可交互的凹陷容器，内阴影由 `::after` 承载。
**活动区域**（`glass` type）：可交互的凸起容器，必须出现在底部区域内，带有外阴影。

层级关系：底部区域 → 活动区域 → 内容。活动区域必须在视觉上盖住底部区域的内阴影，不能被阴影遮挡。

**各布局下的具体实现**：
- **大/中布局**：`content-inset` 是底部区域（`::after` z-index:1），`content-glass`（z-index:2）承载活动区域，活动区域自然在阴影之上
- **小布局**：底部区域和活动区域的层级关系与大布局相同（`content-inset::after` z-index:1, `content-glass` z-index:2），活动区域盖住底部区域阴影。**禁止把 `content-inset::after` 设为 `display: none`**，这会消除底部区域

**内容区活动区域结构**：每个内容组件（MarkdownEditor、ConfirmPanel、DailyQuizPanel、WelcomePanel）必须自己包含活动区域（`activity-layout > activity-glass-host > GlassWrapper > activity-scroll`）。这些 class 的样式定义在 `MainLayout.vue` 的非 scoped `<style>` 块中，**禁止在组件的 scoped style 中重复定义**，否则 scoped attribute 会导致样式不匹配。

**禁止在 MainLayout 中统一包裹 GlassWrapper**。活动区域属于各内容组件内部，MainLayout 只提供全局 class 定义。


### UI Structure

`MainLayout.vue` is the single-page shell with a CSS Grid layout:

| Area | Component | Role |
|------|-----------|------|
| Logo | `LogoArea` | App branding |
| Breadcrumbs | `Breadcrumbs` | Ancestor path navigation |
| Navigation | `Navigation` | Sidebar: child nodes + tree browser |
| Content | Dynamic | `MarkdownEditor` (default), `GlobalTree` (move mode), `ConfirmPanel` (add/delete/logout), `AuthPanel` (unauthenticated) |
| Knob | `Knob` | Multi-purpose action button (context-sensitive) |

Components are organized under `frontend/src/components/` by domain: `auth/`, `editor/`, `layout/`, `tree/`, `ui/`.

### Database (SQLite)

- **`users`** table: id, username, password_hash, created_at.
- **`nodes`** table: id, owner_id, name, content (plain text), parent_id, sort_order, depth, domain_tag, mastery_score, is_deleted (soft delete), created_at, updated_at.
- **`edges`** table: parent_id + child_id (adjacency list), sort_order, relationship_type.
- **`quiz_records`** table: id, node_id, owner_id, is_correct, answered_at.
- Auth: JWT (HS256, 7-day expiry), bcrypt password hashing.
- SQLite runs in WAL mode for concurrent read performance.

### PWA

`vite-plugin-pwa` with `injectManifest` strategy. Custom service worker at `frontend/public/sw.js` handles app-shell precaching and offline fallback.

## Development Commands

All commands run from the submodule directory unless noted.

### Frontend

```bash
cd frontend
npm install          # install dependencies
npm run dev          # Vite dev server with hot reload
npm run build        # type-check (vue-tsc) + production build
npm run preview      # preview production build locally
```

Requires `.env` with:
```
VITE_DATA_MODE=backend
VITE_BACKEND_URL=http://localhost:7860
```

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 7860
```

Requires env vars: `JWT_SECRET`, `DB_PATH` (optional, defaults to `acacia.db`), `SILICONFLOW_API_KEY` (for AI features).

### Backend Tests

```bash
cd backend
pytest tests/        # runs async tests with httpx ASGI transport
```

Requires `pytest` and `pytest-asyncio` installed (not in requirements.txt).

### Docker (Backend)

```bash
docker build -t acacia-backend -f backend/DockerFile backend
```

## Coding Conventions

- **Indentation**: 2 spaces in Vue/TS/CSS.
- **Vue SFCs**: Use `<script setup lang="ts">`.
- **Component filenames**: `PascalCase.vue`.
- **Store/utility filenames**: `camelCase.ts`.
- **Python**: `snake_case`.
- **Commit subjects**: Short, imperative, one action per commit.
- **UI language**: Chinese (error messages, labels).
- **UI library**: Naive UI + Radix Vue for components, Tailwind CSS v4 for styling.

## Deployment

Self-hosted on a VPS. See `deploy/` for Nginx config, systemd service, and deployment scripts. Frontend is built as static files served by Nginx; API requests are proxied to the FastAPI backend.

### Quick deploy

```bash
# Initial setup (run once)
sudo bash deploy/setup.sh

# Update (after git push)
bash deploy/deploy.sh
```

For HTTPS, use certbot: `sudo certbot --nginx -d your-domain.com`.
