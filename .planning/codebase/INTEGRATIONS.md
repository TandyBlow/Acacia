# External Integrations

**Analysis Date:** 2026-04-27

## APIs & External Services

**LLM / AI:**
- SiliconFlow API (`https://api.siliconflow.cn/v1/chat/completions`) - OpenAI-compatible chat completions endpoint used for AI-assisted knowledge node generation and quiz question generation
  - SDK/Client: `httpx` (Python HTTP client, no vendor SDK)
  - Auth: `SILICONFLOW_API_KEY` env var (Bearer token in Authorization header)
  - Model: Configurable via `SILICONFLOW_MODEL` env var, default `Qwen/Qwen2.5-7B-Instruct`
  - Custom endpoint: Configurable via `LLM_API_URL` env var (supports any OpenAI-compatible provider like DeepSeek, Moonshot)
  - Implementation files:
    - `backend/ai_generate_service_sqlite.py:35-54` - `call_llm()` for node generation
    - `backend/quiz_service_sqlite.py:58-77` - `call_llm()` for quiz question generation
  - Timeout: 30s for node generation, 60s for quiz generation

**Supabase (Legacy / Migration Only):**
- Supabase - Previously used as primary database/storage; now migrated to local SQLite
  - SDK/Client: `supabase` Python package (installed only for migration)
  - Auth: `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` env vars
  - Migration script: `backend/migrate_from_supabase.py` - One-time export from Supabase and import into SQLite
  - The `.env.example` still documents Supabase config, but it is not used by the running application
  - The `setup_tree_generator.sh` script also references Supabase (deprecated)

## Data Storage

**Databases:**
- SQLite (primary) - File-based relational database
  - Connection: `DB_PATH` env var, defaults to `acacia.db`
  - Client: Python `sqlite3` stdlib module (no ORM)
  - Database file: `backend/acacia.db` (committed, ~90KB)
  - Schema: 5 tables - `users`, `nodes`, `edges`, `quiz_questions`, `quiz_records`
  - Migrations: Inline via `CREATE TABLE IF NOT EXISTS` + column existence checks in `backend/database.py:31-125`
  - Mode: WAL (Write-Ahead Logging) for concurrent read performance
  - PRAGMAs: `synchronous=NORMAL`, `cache_size=-2000` (2MB), `temp_store=MEMORY`
  - Frontend local mode also uses localStorage via `frontend/src/adapters/localAdapter.ts`

**File Storage:**
- Local filesystem only (no cloud object storage)
  - Nginx serves frontend static assets from `/opt/acacia/frontend/dist`

**Caching:**
- None (no Redis, Memcached, or server-side cache layer)
- Frontend PWA: Service worker-cached app shell (`frontend/public/sw.js`)
- Frontend: Nginx static asset caching (`expires 30d` / `expires 1y` for immutable assets)
- Frontend: `@tanstack/vue-query` provides client-side request deduplication

## Authentication & Identity

**Auth Provider:**
- Custom JWT-based authentication
  - Implementation: `backend/auth.py` - local username/password with bcrypt password hashing
  - Token: JWT HS256, 7-day expiry, stored in localStorage as `acacia_backend_token`
  - Frontend auth handler: `frontend/src/adapters/backendAuth.ts` + `frontend/src/stores/authStore.ts`
  - Middleware: `HTTPBearer` security scheme in FastAPI (`backend/main.py:45-62`)
  - All API routes (except `/`, `/health`, `/auth/register`, `/auth/login`) require valid JWT via `get_current_user` dependency
  - No OAuth, no third-party auth provider, no MFA

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, Bugsnag, or similar service)
- Backend raises `HTTPException` with status codes and detail messages
- Frontend catches errors in stores and shows Chinese-language error messages via Naive UI notifications

**Logs:**
- systemd journal (`journalctl -u acacia`) for backend process output
- Nginx access/error logs for HTTP traffic
- No structured logging, no log aggregation

## CI/CD & Deployment

**Hosting:**
- Self-hosted on a Linux VPS
  - Deployment path: `/opt/acacia/`
  - Process manager: systemd (`deploy/acacia.service`)
  - Reverse proxy: Nginx (`deploy/nginx.conf`)
  - HTTPS: Optional via certbot + Let's Encrypt

**CI Pipeline:**
- None (no GitHub Actions, GitLab CI, or similar detected)

**Deployment Scripts:**
- `deploy/setup.sh` - Initial server setup (packages, user, venv, database, systemd, nginx)
- `deploy/deploy.sh` - Update deployment (git pull, pip install, npm ci, build, restart services)
- `deploy/acacia.service` - systemd unit: single `uvicorn` worker, binds to `127.0.0.1:7860`
- Docker builds:
  - `frontend/Dockerfile` - Multi-stage: Node 20-alpine build + nginx:alpine serve
  - `backend/DockerFile` - Python 3.10-slim with auto `init_db()` on start

**Alternative Deployment:**
- `backend/deploy_to_hf.py` - HuggingFace Spaces deployment script (2156 bytes)

## Environment Configuration

**Required env vars:**
- `JWT_SECRET` - Secret key for JWT (critical: change from default in production)
- `SILICONFLOW_API_KEY` - LLM API key for AI features (AI generation and quizzes fail without it)
- `VITE_DATA_MODE` - Frontend data mode: `backend` or `local`
- `VITE_BACKEND_URL` - Backend URL for frontend API calls (set to `/api` in production behind Nginx)

**Optional env vars:**
- `DB_PATH` - SQLite file location (defaults to `acacia.db`)
- `SILICONFLOW_MODEL` - LLM model name (defaults to `Qwen/Qwen2.5-7B-Instruct`)
- `LLM_API_URL` - Custom OpenAI-compatible endpoint
- `TREE_GEN_VERSION` - Tree generation algorithm: `1` (L-system) or `2` (space colonization, default)
- `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` - Only for `migrate_from_supabase.py`

**Secrets location:**
- `.env` files (backend and frontend) - These are gitignored (not in repo)
- `backend/.env.example` provides template
- systemd service file includes inline environment variables for production (`deploy/acacia.service`)

## Webhooks & Callbacks

**Incoming:**
- None (no webhook endpoints defined in the API)

**Outgoing:**
- None (no webhook calls to external services)

---

*Integration audit: 2026-04-27*
