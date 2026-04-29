# Phase 1: Non-Tree Foundations - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning
**Source:** CEO Plan `2026-04-29-non-tree-optimization.md` + Eng Review decisions

<domain>
## Phase Boundary

Phase 1 establishes the infrastructure foundation for all subsequent non-tree optimization phases:

1. **Login Rate Limiting** — 5 failed attempts per IP within 15 minutes → 429 response
2. **Global Rate Limiting** — 100 req/min per IP; LLM endpoints 10 req/min per user
3. **Migration Versioning** — `migrations/` directory with numbered SQL files, `schema_version` table
4. **Request Logging Middleware** — method, path, status, duration_ms, user_id
5. **Debug Log Cleanup** — Remove `console.warn` debug logging from authStore.ts

</domain>

<decisions>
## Implementation Decisions

### Rate Limiting
- **Global:** 100 req/min per IP across all endpoints
- **LLM endpoints:** 10 req/min per user (`/ai-generate-nodes`, `/analyze-node/{node_id}`, `/generate-question/{node_id}`, `/generate-batch/{node_id}`)
- **Login:** 5 failed attempts per IP within 15-min sliding window → HTTP 429 with message "登录尝试过多，请15分钟后再试"
- **Fail-open:** Rate limiter must fail open on DB error (don't block legitimate requests if rate_limits table is unavailable)
- **Middleware order:** Logging wraps rate-limiting (outer → inner: logging → rate-limiting → app)

### Migration System
- `backend/migrations/` directory with numbered SQL files (`001_initial.sql`, `002_rate_limits.sql`, etc.)
- New `schema_version` table: `(version INTEGER PRIMARY KEY, applied_at TEXT)`
- `init_db()` tracks applied migrations — only runs unapplied migrations in order
- Baseline at version 1: existing schema is version 1 (all current CREATE TABLE IF NOT EXISTS statements)
- Detect partial state: if a migration file exists but version not recorded, treat as unapplied
- Migration 002: create `rate_limits` table

### Request Logging
- Middleware logs: method, path, status_code, duration_ms, user_id (if authenticated, else "anonymous")
- Use Python `logging` module (standard library, no external dependency)
- Log format: structured key=value pairs for grep-ability

### Data Model
- `rate_limits` table: `ip TEXT, endpoint TEXT, count INT, window_start TEXT`
- `schema_version` table: `version INTEGER PRIMARY KEY, applied_at TEXT`

### Debug Log Cleanup
- Remove `console.warn` lines from `frontend/src/stores/authStore.ts`: lines 99, 101, 107, 109

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source of Truth
- `backend/main.py` — Current FastAPI app structure, all endpoints, middleware chain
- `backend/database.py` — Current `init_db()`, `get_db_ctx()`, table creation
- `backend/auth.py` — JWT auth, password hashing (no rate limiting currently)
- `frontend/src/stores/authStore.ts` — Auth store with console.warn debug lines to remove

### Architecture Context
- `.planning/codebase/ARCHITECTURE.md` — Project architecture
- `.planning/codebase/STACK.md` — Technology stack

</canonical_refs>

<specifics>
## Specific Ideas

### Rate Limiting Algorithm
- Sliding window per (IP, endpoint) pair
- For login: track failed attempts only (not all requests)
- Rate limit data stored in SQLite `rate_limits` table
- Clean up expired windows on each check (delete rows where `window_start < now - 15 min`)

### Migration Baseline Strategy
- Version 1 = current schema state (all existing CREATE TABLE IF NOT EXISTS)
- On first run with migration system, check if `schema_version` table exists:
  - If not: create it and insert version 1 (current schema is baseline)
  - If yes: apply any unapplied migrations in order
- This means creating `001_initial.sql` as a no-op marker (schema already exists from init_db)

### Middleware Implementation
- Pure ASGI middleware (not FastAPI decorators) for request logging
- FastAPI middleware for rate limiting (needs dependency injection for DB access)
- Both as callable classes implementing `BaseHTTPMiddleware`

</specifics>

<deferred>
## Deferred Ideas

- Push notification infrastructure (Phase 5)
- AI SSE streaming refactor (Phase 4)
- OAuth/password reset (deferred to TODOS.md)
- LLM caching table creation (Phase 4)

</deferred>

---

*Phase: 01-non-tree-optimization*
*Context gathered: 2026-04-29 via CEO Plan + Eng Review*
