# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SeeWhat** is a hierarchical note-taking web app. Users organize notes in a tree structure (parent-child nodes), navigate via breadcrumbs/sidebar, and edit content with a TipTap rich-text editor. Auth is username-based (synthetic emails via SHA-256 hash) backed by Supabase Auth.

## Architecture

The repo is split into three parts:

- **`frontend/`** — Vue 3 + TypeScript + Vite SPA. The main application.
- **`backend/`** — FastAPI scaffold (in-memory node CRUD). Not actively used in production; Supabase is the primary data layer.
- **`supabase/`** — PostgreSQL schema, RPC functions, and RLS policies for the production data backend.

### Data Flow

All frontend data flows through `DataAdapter` interface (`frontend/src/types/node.ts`). There are two implementations in `frontend/src/services/dataAdapter.ts`:

- **`localDataAdapter`** — localStorage-based, used for offline/dev without Supabase.
- **`supabaseAdapter`** — Supabase-backed, the production adapter. `VITE_DATA_MODE` must be `supabase`.

The active adapter is selected at import time by `VITE_DATA_MODE`. The current code only allows `supabase` mode.

### State Management

Pinia stores (`frontend/src/stores/`):

- **`authStore`** — Supabase auth session, login/register/logout, username-to-email mapping.
- **`nodeStore`** — All tree state: active node, children, path breadcrumbs, CRUD operations, view state machine (`display | add | move | delete | logout`).

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

### Database (Supabase)

- **`nodes`** table: id, owner_id, name, content (jsonb with `markdown` key), embedding (vector 1536), depth, parent_id_cache, is_deleted (soft delete).
- **`edges`** table: parent_id + child_id (adjacency list), sort_order, relationship_type.
- **RLS**: Users can only access their own nodes/edges (owner_id = auth.uid()).
- **RPC functions**: `create_node`, `update_node_content`, `delete_node`, `move_node`, `get_node_context`, `get_tree` — handle cycle detection, depth propagation, sibling name uniqueness.
- Auth uses synthetic emails: `u.<sha256(username)>@seewhat.local`.

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
VITE_DATA_MODE=supabase
VITE_SUPABASE_URL=<your-url>
VITE_SUPABASE_ANON_KEY=<your-key>
```

### Backend (FastAPI scaffold)

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 7860
```

### Backend Tests

```bash
cd backend
pytest tests/        # runs async tests with httpx ASGI transport
```

Requires `pytest` and `pytest-asyncio` installed (not in requirements.txt).

### Docker (Backend)

```bash
docker build -t seewhat-backend -f backend/DockerFile backend
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

Frontend deploys to Vercel. Root directory must be set to `frontend`. See `DEPLOY.md` for full steps.
