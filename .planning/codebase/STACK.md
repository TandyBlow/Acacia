# Technology Stack

**Analysis Date:** 2026-04-27

## Languages

**Primary:**
- TypeScript 5.9.3 - Frontend SPA (Vue SFCs, stores, adapters, composables)
- Python 3.10 - Backend API server (FastAPI, services, database layer)

**Secondary:**
- SQL (SQLite dialect) - Database schema, migrations, queries
- HTML/CSS - Frontend templates and styling
- GLSL (shaders) - 3D background rendering via Three.js (`frontend/src/components/tree/shaders/`)

## Runtime

**Frontend Environment:**
- Node.js 20 (Dockerfile specifies `node:20-alpine`)
- Package Manager: npm (no lockfile checked into repo)
- Module system: ESM (`"type": "module"` in `frontend/package.json`)
- Runtime target: Browsers with ES2023+ support

**Backend Environment:**
- Python 3.10 (Dockerfile specifies `python:3.10-slim`)
- ASGI Server: Uvicorn (served at port 7860, single worker)
- No Python lockfile (requirements.txt only)
- No virtual environment pinned in repo

## Frameworks

**Core (Frontend):**
- Vue 3.5.24 - Progressive UI framework (`<script setup lang="ts">` SFCs)
- Vue Router 5.0.4 - Client-side routing (dynamic `:id` param)
- Pinia 3.0.4 - State management (`frontend/src/stores/`)
- Tailwind CSS 4.1.18 - Utility-first styling via `@tailwindcss/vite` plugin
- Naive UI 2.43.2 - Primary component library (modals, inputs, notifications)
- Radix Vue 1.9.17 - Headless UI primitives (accessibility-focused)
- TipTap 3.15.3 - Rich-text editor (StarterKit + extensions: code-block-lowlight, image, mathematics, Markdown serialization)

**Core (Backend):**
- FastAPI (no version pinned) - REST API framework with Pydantic models
- Uvicorn (no version pinned) - ASGI server

**Testing:**
- Vitest 4.1.4 - Frontend unit/component tests (`npm test`)
- happy-dom 20.8.9 - DOM environment for Vitest
- @vue/test-utils 2.4.6 - Vue component testing utilities
- pytest (not in requirements.txt, mentioned in CLAUDE.md) - Backend tests with httpx ASGI transport
- pytest-asyncio (not in requirements.txt) - Async test support

**Build/Dev:**
- Vite 7.2.4 - Dev server, HMR, production bundling
- vue-tsc 3.1.4 - Type checking during build (`vue-tsc -b && vite build`)
- @vitejs/plugin-vue 6.0.1 - Vue SFC compilation
- vite-plugin-pwa 1.2.0 - PWA manifest and service worker generation

## Key Dependencies

**Critical (Frontend):**
- three 0.184.0 - 3D rendering engine for interactive tree visualization (`frontend/src/components/tree/scene/`)
- @dgreenheck/ez-tree 1.1.0 - Procedural tree skeleton generation
- @tanstack/vue-query 5.92.8 - Server state caching and request deduplication
- dompurify 3.3.3 - HTML sanitization for user content
- highlight.js 11.11.1 - Code syntax highlighting in TipTap editor
- katex 0.16.40 - LaTeX math rendering in TipTap editor
- vuedraggable 4.1.0 - Drag-and-drop tree node reordering
- pinia-plugin-persistedstate 4.7.1 - localStorage persistence for Pinia stores

**Critical (Backend):**
- PyJWT (no version pinned) - JWT token creation and verification (HS256, 7-day expiry)
- bcrypt (no version pinned) - Password hashing
- httpx (no version pinned) - HTTP client for SiliconFlow LLM API calls
- Pillow (no version pinned) - Image processing for tree visualization rendering
- numpy (no version pinned) - Numerical computation for skeleton generation
- python-dotenv (no version pinned) - Environment variable loading

**Infrastructure:**
- python-dotenv - `.env` file loading at startup (`backend/main.py:11`)
- No ORM - raw SQL via `sqlite3` module in Python
- No migration tool - schema managed via `CREATE TABLE IF NOT EXISTS` in `backend/database.py:init_db()`

## Configuration

**Environment Variables (Frontend):**
- `VITE_DATA_MODE` - Adapter selection: `backend` (REST API) or `local` (localStorage). Default: `backend`
- `VITE_BACKEND_URL` - Backend API base URL. Default: `http://localhost:7860`

Frontend env files present:
- `frontend/.env` - Active configuration
- `frontend/.env.example` - Template with `VITE_DATA_MODE=backend`
- `frontend/.env.backend.example` - Backend mode example
- `frontend/.env.production` - Production overrides

**Environment Variables (Backend):**
- `JWT_SECRET` - Secret key for JWT signing. Default: `dev-secret-change-in-production`
- `DB_PATH` - SQLite database file path. Default: `acacia.db`
- `SILICONFLOW_API_KEY` - API key for SiliconFlow LLM (OpenAI-compatible)
- `SILICONFLOW_MODEL` - LLM model name. Default: `Qwen/Qwen2.5-7B-Instruct`
- `LLM_API_URL` - LLM API endpoint. Default: `https://api.siliconflow.cn/v1/chat/completions`
- `TREE_GEN_VERSION` - Tree generator algorithm version (1=L-system, 2=space colonization). Default: `2`
- `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` - Legacy Supabase connection (only for `migrate_from_supabase.py`)

Backend env files present:
- `backend/.env` - Active configuration (779 bytes, contains secrets)
- `backend/.env.example` - Template with Supabase and SiliconFlow settings

**Build Configuration:**
- `frontend/tsconfig.json` - Project references to app and node configs
- `frontend/tsconfig.app.json` - App TypeScript config (strict, noUnusedLocals, noUnusedParameters), extends `@vue/tsconfig/tsconfig.dom.json`
- `frontend/tsconfig.node.json` - Vite config TypeScript (ES2023 target)
- `frontend/vite.config.ts` - Vite config with Vue plugin and PWA plugin
- `frontend/Dockerfile` - Multi-stage build: `node:20-alpine` for build, `nginx:alpine` for serve
- `backend/DockerFile` - Single-stage: `python:3.10-slim`, exposes 7860, init_db on start
- `deploy/nginx.conf` - Nginx config: static files + API proxy to backend
- `deploy/acacia.service` - systemd unit file for backend process

**Styling Configuration:**
- Tailwind CSS v4 via `@tailwindcss/vite` plugin (auto-discovery, no `tailwind.config.js` needed)
- Custom CSS variables in `frontend/src/style.css` for theming (primary, hint, glass, shadows)
- Sakura theme via `.theme-sakura` class modifier

## Platform Requirements

**Development:**
- Node.js 20+ with npm
- Python 3.10+ with pip
- Git
- Bash shell (for deploy scripts)

**Production:**
- Linux VPS (Ubuntu assumed by `deploy/setup.sh`)
- Nginx (reverse proxy + static file serving)
- systemd (process management)
- Let's Encrypt / certbot (optional HTTPS)
- Docker (optional alternative deployment)

---

*Stack analysis: 2026-04-27*
