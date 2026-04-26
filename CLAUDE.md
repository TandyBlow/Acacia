# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
