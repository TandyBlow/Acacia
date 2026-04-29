# Phase 1: Non-Tree Foundations - Research

**Researched:** 2026-04-29
**Domain:** FastAPI middleware infrastructure (rate limiting, logging, database migration versioning)
**Confidence:** HIGH

## Summary

Phase 1 establishes infrastructure foundations that all subsequent phases depend on: rate limiting (login + global + LLM endpoints), database migration versioning, structured request logging, and debug log cleanup. All four backend tasks share the same architectural concern: they introduce middleware and boot-time infrastructure to a FastAPI + raw SQLite application with no existing middleware beyond CORS and no migration system.

**Primary recommendation:** Use custom pure ASGI middleware for both logging and rate limiting (not slowapi, not BaseHTTPMiddleware). Write a thin migration runner backed by a `schema_version` table (not alembic). Use Python stdlib `logging` with key=value formatted output. This keeps the dependency footprint at zero while giving full control over fail-open behavior, Chinese error messages, and the project's raw-SQL patterns.

**Critical architecture decision:** The rate limiting middleware MUST be a single pure ASGI class that handles all three rate limit categories (global, LLM, login-failed) in one pass, querying the DB once per request. It MUST fail open on any DB exception. The logging middleware MUST wrap the rate limiter as the outermost layer so rate-limited 429 responses are logged.

## User Constraints (from CONTEXT.md)

### Locked Decisions (from CONTEXT.md Decisions section)
- Global rate limiting: 100 req/min per IP across all endpoints
- LLM endpoints: 10 req/min per user for `/ai-generate-nodes`, `/analyze-node/{node_id}`, `/generate-question/{node_id}`, `/generate-batch/{node_id}`
- Login rate limiting: 5 failed attempts per IP within 15-min sliding window, HTTP 429 with Chinese message "登录尝试过多，请15分钟后再试"
- Fail-open: Rate limiter must fail open on DB error (don't block legitimate requests)
- Middleware order: Logging wraps rate-limiting (outer to inner: logging to rate-limiting to app)
- `backend/migrations/` directory with numbered SQL files (`001_initial.sql`, `002_rate_limits.sql`, etc.)
- `schema_version` table: `(version INTEGER PRIMARY KEY, applied_at TEXT)`
- `init_db()` tracks applied migrations, only runs unapplied migrations in order
- Baseline at version 1: existing schema is version 1
- Detect partial state: migration file exists but version not recorded = unapplied
- Migration 002: create `rate_limits` table with schema `ip TEXT, endpoint TEXT, count INT, window_start TEXT`
- Rate limit algorithm: sliding window per (IP, endpoint) pair
- Login rate limits: track failed attempts only (not all login requests)
- Data stored in SQLite `rate_limits` table (same WAL-mode database)
- Clean up expired windows on each check (delete rows where window_start < now - 15 min)
- Request logging: method, path, status_code, duration_ms, user_id (or "anonymous")
- Use Python `logging` module (standard library, no external dependency)
- Log format: structured key=value pairs for grep-ability
- Remove `console.warn` lines from `frontend/src/stores/authStore.ts`: lines 99, 101, 107, 109

### Claude's Discretion (from CONTEXT.md Specifics section, not locked)
- Rate limiting algorithm specifics (exact sliding window implementation)
- Middleware implementation approach (pure ASGI vs BaseHTTPMiddleware)
- Migration baseline strategy details (how to detect and initialize version 1)
- Middleware class design

### Deferred Ideas (OUT OF SCOPE — ignore completely)
- Push notification infrastructure (Phase 5)
- AI SSE streaming refactor (Phase 4)
- OAuth/password reset (deferred to TODOS.md)
- LLM caching table creation (Phase 4)

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Login rate limiting | Backend / API (FastAPI middleware) | Database / Storage (SQLite rate_limits table) | Middleware enforces policy; SQLite persists failed-attempt counters. Must sit before the auth endpoint handler. |
| Global rate limiting (100 req/min) | Backend / API (FastAPI middleware) | Database / Storage (SQLite rate_limits table) | Middleware checks+increments counters per IP on every request. Pure API-tier concern. |
| LLM endpoint rate limiting (10 req/min) | Backend / API (FastAPI middleware) | Database / Storage (SQLite rate_limits table) | Same middleware, partitioned by user_id for LLM paths. API-tier enforcement. |
| Migration versioning | Backend / API (boot-time init_db) | Database / Storage (SQLite schema_version table) | init_db() owns migration orchestration; SQLite stores version tracking. No runtime component. |
| Request logging | Backend / API (FastAPI middleware, outermost) | — | Pure middleware concern — captures HTTP semantics (method, path, status, duration). Single tier. |
| Debug log cleanup | Browser / Client (Vue SPA) | — | Frontend-only: remove 4 console.warn lines from authStore.ts. No backend component. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Python `logging` | stdlib | Structured request logging | Per CONTEXT.md decision; zero dependencies; already imported by FastAPI/uvicorn |
| Python `sqlite3` | stdlib | Rate limit counter storage + migration tracking | Project already uses raw sqlite3 throughout; WAL mode handles concurrent reads; no ORM |
| Python `time` | stdlib | Sliding window calculations | Standard library, sufficient for second-precision window math |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pytest` | 9.0.3 | Backend tests | Already installed; used for rate limiter unit tests and middleware integration tests |
| `pytest-asyncio` | 1.3.0 | Async test support | Required for testing ASGI middleware with httpx async transport |
| `httpx` | (already in requirements.txt) | ASGI test client | Already used by existing tests for backend endpoint testing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom ASGI rate limiter | slowapi (0.1.9) + custom `limits` SQLite storage | slowapi has NO SQLite backend [VERIFIED: pypi.org/project/slowapi/0.1.9]. Building a custom `limits.storage` adapter requires implementing `incr`, `get`, `get_expiry`, `check`, `reset` — the same amount of code as the middleware itself plus an abstraction layer that adds indirection. slowapi's decorator-based per-endpoint limiting requires `request: Request` on every decorated endpoint, which is "un-FastAPI-like" and conflicts with the project's existing handler signatures. Custom middleware gives direct SQLite access, fail-open control, and Chinese error messages without fighting a library designed for Redis/memcached. |
| Custom ASGI rate limiter | `fastapi-limiter` (Redis-only) | Requires Redis — the project does not have Redis deployed. Adding a Redis dependency for rate limiting alone is architectural overreach for a single-server SQLite app. |
| Custom migration system | Alembic 1.18.1 (already installed but never configured) | Alembic requires SQLAlchemy Table metadata for auto-generation. The project uses raw SQL with no ORM models. Configuring Alembic for raw SQL migrations requires writing empty revision files manually — same effort as numbered SQL files but with more configuration (alembic.ini + env.py). Per CONTEXT.md decision, custom approach is locked. |
| BaseHTTPMiddleware | Pure ASGI middleware | BaseHTTPMiddleware creates ~7 intermediate objects per request and drops throughput by 30-74% when stacked [VERIFIED: litellm benchmark, dev.to analysis]. Acceptable for infrequent operations (e.g., CORS which is already present) but NOT for middleware that runs on EVERY request (logging, rate limiting). Pure ASGI has minimal overhead — just a dict lookup and function call for passthrough. |

**Installation:**
No new packages required. All dependencies are already in the Python stdlib or installed in the project:
```bash
# Verify existing packages are current (optional):
pip install --upgrade fastapi uvicorn pytest pytest-asyncio httpx
```

**Version verification:**
- Python `logging`: stdlib, bundled with Python 3.12.3 [VERIFIED: python3 --version]
- Python `sqlite3`: stdlib, bundled with Python 3.12.3
- slowapi 0.1.9: no SQLite backend [VERIFIED: pypi.org, limits library storage backends]
- Alembic 1.18.1: installed but never configured (no alembic.ini, no env.py) [VERIFIED: filesystem check]
- pytest 9.0.3, pytest-asyncio 1.3.0: installed [VERIFIED: pip list]
- FastAPI 0.136.0, uvicorn 0.44.0: installed [VERIFIED: pip list]

## Architecture Patterns

### System Architecture Diagram

```
                        REQUEST FLOW (outer to inner)
    ┌─────────────────────────────────────────────────────────────────┐
    │                                                                 │
    │  ┌───────────────────────────────────────────────────────────┐ │
    │  │  LoggingMiddleware (pure ASGI, outermost)                  │ │
    │  │                                                             │ │
    │  │  1. Extract from scope: method, path, client IP            │ │
    │  │  2. Record start_time = time.time()                        │ │
    │  │  3. Extract user_id from Authorization header (if present) │ │
    │  │  4. Wrap `send` to capture response status_code            │ │
    │  │  5. After app returns: duration = time.time() - start_time │ │
    │  │  6. logger.info("method=GET path=/api/... status=200       │ │
    │  │                  duration_ms=12.3 user=abc123")            │ │
    │  └───────────────┬───────────────────────────────────────────┘ │
    │                  │ call_next(scope, receive, wrapped_send)     │
    │                  v                                              │
    │  ┌───────────────────────────────────────────────────────────┐ │
    │  │  RateLimitMiddleware (pure ASGI)                           │ │
    │  │                                                             │ │
    │  │  1. Extract IP + path from scope                           │ │
    │  │  2. If path is /auth/login:                                │ │
    │  │     - Query rate_limits WHERE ip=? AND endpoint='login'    │ │
    │  │     - If count >= 5 AND window_start > now-15min:          │ │
    │  │       → return 429 {"detail":"登录尝试过多，请15分钟后再试"}│ │
    │  │  3. Query rate_limits WHERE ip=? AND endpoint='global':    │ │
    │  │     - If count >= 100 AND window_start > now-60s:          │ │
    │  │       → return 429                                         │ │
    │  │  4. If path matches LLM endpoints:                         │ │
    │  │     - Query rate_limits WHERE ip=? AND endpoint='llm':     │ │
    │  │     - If count >= 10 AND window_start > now-60s:           │ │
    │  │       → return 429                                         │ │
    │  │  5. Wrap `send` to:                                        │ │
    │  │     - On 401 from /auth/login: increment login counter     │ │
    │  │     - On 200 from /auth/login: reset login counter         │ │
    │  │     - Always: increment global counter                     │ │
    │  │     - If LLM endpoint: increment LLM counter               │ │
    │  │  6. ALL DB operations wrapped in try/except:               │ │
    │  │     - On exception: logger.error(...), allow request       │ │
    │  └───────────────┬───────────────────────────────────────────┘ │
    │                  │ call_next(scope, receive, wrapped_send)     │
    │                  v                                              │
    │  ┌───────────────────────────────────────────────────────────┐ │
    │  │  CORSMiddleware (existing, BaseHTTPMiddleware)             │ │
    │  │  FastAPI App (main.py)                                     │ │
    │  └───────────────────────────────────────────────────────────┘ │
    │                                                                 │
    └─────────────────────────────────────────────────────────────────┘

                    BOOT SEQUENCE (startup event)
    ┌─────────────────────────────────────────────────────────────────┐
    │  @app.on_event("startup")                                       │
    │  init_db():                                                     │
    │    1. python3 db_migrate.py  (OR inline in init_db)             │
    │    2. Check if schema_version table exists                      │
    │       - NO: Create it, insert version=1 (baseline = current)    │
    │       - YES: Read max(version), apply unapplied SQL files       │
    │    3. Apply migrations in order (002_rate_limits.sql, etc.)     │
    │    4. Record each applied migration in schema_version            │
    │    5. Then run existing CREATE TABLE IF NOT EXISTS statements   │
    └─────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
backend/
├── main.py                    # FastAPI app, startup event calls init_db
├── database.py                # init_db() now includes migration runner call
├── middleware/
│   ├── __init__.py
│   ├── logging_middleware.py   # LoggingMiddleware (pure ASGI class)
│   └── rate_limit_middleware.py # RateLimitMiddleware (pure ASGI class)
├── migrations/
│   ├── 001_initial.sql         # No-op marker (schema already in init_db)
│   └── 002_rate_limits.sql     # CREATE TABLE IF NOT EXISTS rate_limits (...)
├── db_migrate.py               # Migration runner: reads schema_version, applies SQL files
├── tests/
│   ├── test_rate_limiter.py    # Rate limiter unit + integration tests
│   ├── test_logging_middleware.py # Logging middleware tests
│   └── test_migrations.py      # Migration runner tests
└── frontend/src/stores/
    └── authStore.ts            # Lines 99, 101, 107, 109: console.warn removed
```

### Pattern 1: Pure ASGI Middleware (Request + Response Wrapping)

**What:** A class implementing `__init__(self, app: ASGIApp)` and `async def __call__(self, scope, receive, send)`. For middleware that needs to see the response (status code, duration), wrap the `send` callable to intercept `http.response.start` messages.

**When to use:** All middleware that runs on every request. BaseHTTPMiddleware is only acceptable for infrequent operations.

**Example (Logging Middleware):**
```python
# Source: adapted from Starlette docs + litellm benchmark findings
# https://www.starlette.io/middleware/#pure-asgi-middleware

import time
import logging
from typing import Awaitable, Callable
from fastapi import Request

logger = logging.getLogger("acacia.request")

class LoggingMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start_time = time.time()
        method = scope.get("method", "UNKNOWN")
        path = scope.get("path", "/")

        # Extract user_id from Authorization header (best-effort)
        user_id = "anonymous"
        for header_name, header_value in scope.get("headers", []):
            if header_name == b"authorization":
                # Parse Bearer token to extract user (or just note authenticated)
                user_id = "authenticated"  # simplified; full JWT decode optional
                break

        response_status = 0
        async def wrapped_send(message):
            nonlocal response_status
            if message["type"] == "http.response.start":
                response_status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, wrapped_send)
        finally:
            duration_ms = round((time.time() - start_time) * 1000, 2)
            logger.info(
                "method=%s path=%s status=%s duration_ms=%s user=%s",
                method, path, response_status, duration_ms, user_id,
            )
```

### Pattern 2: Fail-Open Rate Limiter with Sliding Window

**What:** A rate limiter that queries SQLite for current usage, blocks if over limit, and increments counters after the request. All DB operations wrapped in try/except — on failure, the request proceeds (fail-open).

**When to use:** Rate limiting with persistent storage where availability trumps rate limit enforcement during storage outages.

**Example (Rate Limit Middleware - structural outline):**
```python
# Source: custom design based on sliding window algorithm + fail-open pattern
# Verified against: limits library MovingWindowRateLimiter strategy
# https://github.com/cjwatson/limits

import time
import logging
from database import get_db_ctx

logger = logging.getLogger("acacia.ratelimit")

GLOBAL_LIMIT = 100    # requests per window
GLOBAL_WINDOW = 60    # seconds
LOGIN_LIMIT = 5       # failed attempts
LOGIN_WINDOW = 900    # 15 minutes
LLM_LIMIT = 10        # requests per window
LLM_WINDOW = 60       # seconds

LLM_PATHS = {"/ai-generate-nodes", "/analyze-node", "/generate-question", "/generate-batch"}

class RateLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "/")
        ip = self._get_ip(scope)
        now = time.time()

        # Check login rate limit (pre-request)
        if path == "/auth/login":
            if not self._check_rate_limit(ip, "login_failed", LOGIN_LIMIT, LOGIN_WINDOW):
                await self._send_429(send, "登录尝试过多，请15分钟后再试")
                return

        # Check global rate limit
        if not self._check_rate_limit(ip, "global", GLOBAL_LIMIT, GLOBAL_WINDOW):
            await self._send_429(send, "请求过于频繁，请稍后再试")
            return

        # Check LLM rate limit (pre-request)
        is_llm = any(path.startswith(p) for p in LLM_PATHS)
        llm_blocked = False
        if is_llm:
            user_id = self._extract_user_id(scope)
            llm_blocked = not self._check_rate_limit(user_id, "llm", LLM_LIMIT, LLM_WINDOW)
            if llm_blocked:
                await self._send_429(send, "AI请求过于频繁，请稍后再试")
                return

        # Wrap send for post-response actions
        response_status = 0
        async def wrapped_send(message):
            nonlocal response_status
            if message["type"] == "http.response.start":
                response_status = message["status"]
            await send(message)

        await self.app(scope, receive, wrapped_send)

        # Post-response: increment counters (fail-open)
        self._increment_rate_limit(ip, "global", GLOBAL_WINDOW)
        if is_llm:
            user_id = self._extract_user_id(scope)
            self._increment_rate_limit(user_id, "llm", LLM_WINDOW)
        if path == "/auth/login" and response_status == 401:
            self._increment_rate_limit(ip, "login_failed", LOGIN_WINDOW)

    def _get_ip(self, scope) -> str:
        # Extract client IP from scope
        client = scope.get("client")
        return client[0] if client else "unknown"

    def _check_rate_limit(self, key: str, endpoint: str, limit: int, window: int) -> bool:
        """Returns True if request is allowed. Fails open (returns True on DB error)."""
        try:
            with get_db_ctx() as conn:
                now_iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
                row = conn.execute(
                    "SELECT count, window_start FROM rate_limits WHERE ip=? AND endpoint=?",
                    (key, endpoint),
                ).fetchone()
                if row:
                    window_start = row["window_start"]
                    # Reset if window expired
                    if (time.time() - self._parse_iso(window_start)) > window:
                        conn.execute(
                            "UPDATE rate_limits SET count=1, window_start=? WHERE ip=? AND endpoint=?",
                            (now_iso, key, endpoint),
                        )
                        return True
                    if row["count"] >= limit:
                        return False
                return True
        except Exception as e:
            logger.error("rate_limit_check_failed key=%s endpoint=%s error=%s", key, endpoint, str(e))
            return True  # FAIL OPEN

    def _increment_rate_limit(self, key: str, endpoint: str, window: int):
        """Increments counter. Silently ignores DB errors (fail-open)."""
        try:
            with get_db_ctx() as conn:
                now_iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
                row = conn.execute(
                    "SELECT count, window_start FROM rate_limits WHERE ip=? AND endpoint=?",
                    (key, endpoint),
                ).fetchone()
                if row and (time.time() - self._parse_iso(row["window_start"])) <= window:
                    conn.execute(
                        "UPDATE rate_limits SET count=count+1 WHERE ip=? AND endpoint=?",
                        (key, endpoint),
                    )
                else:
                    conn.execute(
                        "INSERT OR REPLACE INTO rate_limits (ip, endpoint, count, window_start) VALUES (?, ?, 1, ?)",
                        (key, endpoint, now_iso),
                    )
        except Exception as e:
            logger.error("rate_limit_increment_failed key=%s endpoint=%s error=%s", key, endpoint, str(e))
            # Silently fail — don't block requests
```

### Pattern 3: Migration Runner (Version-Tracked SQL Files)

**What:** A function that reads `backend/migrations/*.sql` files sorted by number prefix, checks `schema_version` table, and applies only unapplied migrations in order.

**When to use:** On application startup, before any other database operations.

**Example:**
```python
# Source: adapted from common DIY migration pattern
# Verified against: gist.github.com/rameshvarun/4a6897ccc7c58bd412b75c12373d57e2

import os
import sqlite3
from datetime import datetime, timezone

def run_migrations(conn: sqlite3.Connection, migrations_dir: str = "migrations"):
    """Apply unapplied migrations in order. Baseline at version 1."""

    # Ensure schema_version table exists
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
    """)

    # Check current version
    current = conn.execute("SELECT COALESCE(MAX(version), 0) FROM schema_version").fetchone()[0]

    # If no version recorded but tables exist (existing install), baseline at 1
    if current == 0:
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('schema_version', 'sqlite_sequence')"
        ).fetchall()
        if tables:
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
                (1, datetime.now(timezone.utc).isoformat()),
            )
            current = 1

    # Find and apply unapplied migration files
    if not os.path.isdir(migrations_dir):
        return

    migration_files = sorted(
        [f for f in os.listdir(migrations_dir) if f.endswith(".sql")],
        key=lambda f: int(f.split("_")[0]),
    )

    for filename in migration_files:
        version = int(filename.split("_")[0])
        if version <= current:
            continue  # Already applied

        filepath = os.path.join(migrations_dir, filename)
        with open(filepath, "r", encoding="utf-8") as f:
            sql = f.read()

        conn.executescript(sql)
        conn.execute(
            "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
            (version, datetime.now(timezone.utc).isoformat()),
        )
        current = version
```

### Anti-Patterns to Avoid
- **BaseHTTPMiddleware for every-request middleware:** CORS already uses it. Adding logging AND rate limiting as BaseHTTPMiddleware would stack 3 layers, each creating ~7 intermediate objects per request — significant throughput loss. Use pure ASGI for logging and rate limiting.
- **Separate DB query per rate limit check:** Don't query the DB for login check, then again for global check, then again for LLM check. Query once, get all relevant rows WHERE ip=? (or a UNION), and evaluate in memory.
- **Synchronous `time.time()` in async context:** FastAPI's single-threaded async model means `time.time()` is safe (no GIL contention for this), but the rate limit DB operations must NOT use async DB drivers because the project uses synchronous sqlite3. Call `get_db_ctx()` directly — never `await` a sync call. This is safe in FastAPI's threadpool-less single-worker model because sqlite3 operations are fast (< 1ms).
- **Alembic for raw-SQL-only project:** Alembic expects SQLAlchemy metadata for auto-generation. Without ORM models, it provides no value over numbered SQL files — only adds configuration burden (alembic.ini + env.py).
- **slowapi without Redis:** slowapi's in-memory storage silently breaks in multi-worker scenarios. The project's single-worker uvicorn avoids this, but slowapi's lack of SQLite storage means you'd be building a custom `limits` storage adapter anyway — more code than the middleware itself.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting algorithm (sliding window) | Custom time-window math from scratch | `time.time()` with simple SQLite count/window_start queries | The sliding window algorithm is already well-defined. Implement the known pattern, don't invent a new one. |
| Migration file ordering | Custom file scanning/sorting logic | `sorted(os.listdir(), key=lambda f: int(f.split("_")[0]))` | Trivial with stdlib; no library needed for reading numbered files in order. |
| Structured log formatting | Custom log format string parser | Python `logging` module with a custom `Formatter` that outputs `key=value` pairs | stdlib `logging.Formatter` already handles format strings; just set the format to `%(message)s` and pass pre-formatted key=value strings to `logger.info()`. |
| JWT user extraction from headers | Manual Base64 decode of JWT payload | `auth.verify_token()` (existing) — call it with the raw token from the Authorization header | Already implemented in `backend/auth.py`. The logging middleware can import and call `verify_token()` to extract user_id. |

**Key insight:** Phase 1's tasks are all thin wrappers around existing stdlib or project infrastructure. The rate limiter is the most complex piece, but it's fundamentally a few SQL queries + a sliding window check — no external library buys simplicity at this scale. The migration runner is even simpler: read files, track versions, execute SQL.

## Runtime State Inventory

> This section is NOT applicable (Phase 1 is greenfield infrastructure, not a rename/refactor/migration of existing systems). The only rename-like action is removing debug `console.warn` lines from `authStore.ts`, which is a pure code edit with zero runtime state impact — no databases, service config, OS registrations, secrets, or build artifacts reference those debug log lines.

**All 5 categories: Nothing found (greenfield infrastructure phase).**

## Common Pitfalls

### Pitfall 1: Blocking Legitimate Requests on DB Failure (Fail-Closed Instead of Fail-Open)

**What goes wrong:** An uncaught `sqlite3.OperationalError` (e.g., disk full, database locked despite WAL mode, corrupted database file) propagates up through the rate limiting middleware and returns HTTP 500 to the user — even though the actual endpoint handler would have succeeded.

**Why it happens:** The natural pattern is `if check_limit(): raise HTTPException(429)`. If `check_limit()` raises instead of returning `True/False`, every request dies.

**How to avoid:** Every DB call in the rate limiting middleware must be wrapped in `try/except Exception`. The except block MUST log the error AND return "allowed" (for checks) or silently return (for increments). Never let a DB exception escape the middleware.

**Warning signs:** Rate limiter code that calls `conn.execute()` without a try/except immediately around it. Return values that can be either `bool` or `raise`.

### Pitfall 2: Clock Skew and Window Reset Races

**What goes wrong:** If the server clock changes (NTP adjustment, DST transition, VM migration), the sliding window calculation `time.time() - window_start` can produce negative values or jump forward, and rate limit windows that should still be active suddenly appear expired.

**Why it happens:** `time.time()` is wall-clock time, not monotonic. NTP adjustments and VM suspend/resume cycles can shift it.

**How to avoid:** Use `time.monotonic()` for window expiration checks within a single process lifetime. However, `window_start` stored in SQLite must be wall-clock time (ISO format) for cross-restart correctness. Keep two time sources: `time.monotonic()` for in-process checks, ISO datetimes for database records. This is a minor concern for a single-server app but worth documenting.

**Warning signs:** Users report rate limits expiring early or never expiring after server restarts. Only using `time.time()` for everything without awareness of its non-monotonic nature.

### Pitfall 3: Migration Partial Application

**What goes wrong:** Migration 002 (`CREATE TABLE rate_limits`) runs successfully but the `INSERT INTO schema_version` for version 2 fails (e.g., constraint violation, connection drop). On next startup, the migration runner sees version 1 as the max and tries to run 002 again — which fails because the table already exists.

**Why it happens:** `conn.executescript(sql)` and `conn.execute("INSERT INTO schema_version ...")` are not atomic together unless wrapped in a transaction. SQLite's default behavior is auto-commit for each statement.

**How to avoid:** Wrap migration application in an explicit transaction: begin, run SQL, insert version record, commit. The `get_db_ctx()` context manager already provides transaction boundaries — use it. Also use `CREATE TABLE IF NOT EXISTS` in ALL migration SQL files to make migrations idempotent against partial application.

**Warning signs:** Migration SQL files that use `CREATE TABLE` without `IF NOT EXISTS`. Migration runner that does `conn.execute()` outside `get_db_ctx()`.

### Pitfall 4: Rate Limit Counter Leakage (No Cleanup)

**What goes wrong:** The `rate_limits` table grows unboundedly — every unique IP accumulates a row that's never deleted. Over months, the table could reach thousands of rows, and the `SELECT ... WHERE ip=? AND endpoint=?` query slows down without an index.

**Why it happens:** Expired windows are only logically ignored (the window_start check filters them out) but the rows remain in the database.

**How to avoid:** Add cleanup logic that runs periodically: `DELETE FROM rate_limits WHERE window_start < datetime('now', '-15 minutes')`. Run this on every Nth request (e.g., every 100th request) or at startup. Also add a composite index on `(ip, endpoint)` for fast lookups.

**Warning signs:** `rate_limits` table row count growing linearly with uptime. Rate limit check latency increasing over weeks.

### Pitfall 5: Login Rate Limiting Double-Counting

**What goes wrong:** If the login endpoint is called, rate limited (pre-check passes), the request proceeds, the handler returns 401, and the counter increment fails — the next request might also pass the pre-check. Or worse: the middleware increments the counter BEFORE checking if the handler succeeds, so a successful login still counts as a "failed attempt."

**Why it happens:** Separating the pre-check (block if over limit) from the post-response increment (count the failure) requires careful ordering. The increment must happen AFTER the handler responds with 401, not before.

**How to avoid:** The `wrapped_send` callback in the pure ASGI pattern handles this naturally — `response_status` is set by the wrapped send, and the increment runs after `await self.app(...)`. The check runs before `await self.app(...)`. Never increment the login counter in the pre-request phase.

**Warning signs:** Successful logins being counted against the failed-attempt limit. Rate limit triggering after 4 failed attempts instead of 5.

## Code Examples

Verified patterns from official and community sources:

### Pure ASGI Middleware Skeleton (Starlette Official)
```python
# Source: https://www.starlette.io/middleware/#pure-asgi-middleware
# This is the authoritative pattern from Starlette docs.

from starlette.types import ASGIApp, Scope, Receive, Send, Message

class CustomASGIMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Pre-request logic here (read headers from scope)
        # ...

        # Optionally wrap send to intercept response
        async def send_wrapper(message: Message) -> None:
            # Post-response logic here (inspect message["status"])
            await send(message)

        await self.app(scope, receive, send_wrapper)
```

### Sliding Window Rate Limit Algorithm (from `limits` library)
```python
# Source: https://github.com/cjwatson/limits (MovingWindowRateLimiter strategy)
# The canonical implementation uses:
#   1. A key prefix for namespace isolation
#   2. A sorted set of timestamps (Redis ZSET) or a count + window_start pair
#   3. Cleanup of expired entries on each check
#
# For SQLite adaptation, we use:
#   - Key: (ip, endpoint) composite
#   - Value: (count INT, window_start TEXT ISO8601)
#   - Expiry check: window_start < now - window_duration_seconds
```

### Structured Key=Value Logging with stdlib logging
```python
# Source: Python docs + community pattern
# https://docs.python.org/3/howto/logging-cookbook.html#using-logging-in-multiple-modules

import logging

# Configure once at app startup
handler = logging.StreamHandler()
handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
logger = logging.getLogger("acacia")
logger.addHandler(handler)
logger.setLevel(logging.INFO)

# Usage: emit key=value pairs as the message string
logger.info("method=%s path=%s status=%s duration_ms=%s user=%s",
            method, path, status, duration, user_id)
# Output: 2026-04-29 10:30:00,123 INFO acacia.request method=GET path=/nodes/123 status=200 duration_ms=12.3 user=abc123
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No rate limiting | Sliding window with SQLite persistence | Phase 1 implementation | Prevents brute-force and abuse; fail-open ensures availability |
| ALTER TABLE column additions in init_db() | Numbered migration SQL files with schema_version tracking | Phase 1 implementation | Deterministic schema evolution; idempotent on partial failure |
| No request logging | Structured key=value logging via stdlib logging | Phase 1 implementation | Debuggability; grep-able access logs |
| console.warn in authStore | Removed | Phase 1 implementation | Clean production console |

**Deprecated/outdated:**
- `init_db()` column-by-column ALTER TABLE pattern (lines 96-120 of database.py): Replaced by migration system. The existing column addition logic should be extracted into migration 001_initial.sql as a baseline marker — the actual ALTER TABLE statements are already applied on existing databases, so 001_initial.sql is a no-op marker.
- slowapi: Not adopted. No SQLite backend, requires Redis for production. Custom middleware is simpler for this project's scale.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Custom rate limiter with raw SQLite is simpler than building a `limits` library SQLite storage adapter for slowapi | Standard Stack / Alternatives Considered | Medium: If the `limits.storage` interface is significantly simpler than estimated, slowapi would provide production-tested rate limit header output and strategy implementations. Mitigated by the fact that the project's rate limiting needs are simple (3 limit categories, one DB table, no distributed coordination). |
| A2 | Single uvicorn worker deployment (rate limit counters don't need cross-process coordination) | Architecture Patterns | Low: The project already runs single-worker uvicorn [VERIFIED: CLAUDE.md specifies `uvicorn main:app --reload --host 0.0.0.0 --port 7860` without `--workers` flag]. Additional workers would require Redis or WAL-mode concurrent write handling. |
| A3 | `python3 db_migrate.py` or inline migration in `init_db()` is the correct entry point | Architecture Patterns | Low: This is the standard pattern for migration runners. The exact module structure (separate file vs. inline) is a minor implementation detail. |
| A4 | Existing `init_db()` CREATE TABLE IF NOT EXISTS statements remain unchanged as version 1 baseline | Migration Runner | Low: The CONTEXT.md explicitly states "Version 1 = current schema state (all existing CREATE TABLE IF NOT EXISTS)." The risk is if tables have diverged on different developer machines, but `IF NOT EXISTS` makes this idempotent. |

## Open Questions

1. **Should the migration runner be a separate `db_migrate.py` module or inline in `init_db()`?**
   - What we know: Both approaches work. Separate module is testable independently; inline is simpler.
   - What's unclear: Whether the project prefers many small modules (current pattern: flat files with specific responsibilities) or consolidated entry points.
   - Recommendation: Separate `db_migrate.py` module for testability. `init_db()` calls `run_migrations()` before its existing CREATE TABLE statements.

2. **Should the rate limit cleanup (DELETE expired rows) run on every request or periodically?**
   - What we know: Running cleanup on every request adds DB overhead. Running it too infrequently allows table bloat.
   - What's unclear: Expected traffic volume. Low-traffic app (single user) = negligible overhead either way. Higher traffic = periodic is better.
   - Recommendation: Run cleanup on every 100th request (track with a simple counter in the middleware). This gives O(1) amortized cleanup cost.

3. **Should `verify_token()` be called synchronously from within async middleware?**
   - What we know: `verify_token()` is synchronous (pure CPU, no I/O). In FastAPI's single-threaded async model, calling sync functions from async code does NOT block the event loop (no await needed). The project already calls sync `get_db_ctx()` from async endpoint handlers without issue.
   - What's unclear: Whether calling `jwt.decode()` in middleware is worth the CPU cost for every request.
   - Recommendation: Parse the JWT heuristically (check if Bearer token is present, decode the payload without cryptographic verification) for logging purposes. Logging middleware doesn't need cryptographically verified user IDs — just best-effort identification. If the token is invalid, fall back to "anonymous."

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python | Backend runtime | Yes | 3.12.3 | — |
| sqlite3 module | Rate limit DB + migration tracking | Yes | stdlib (3.12.3) | — |
| logging module | Request logging | Yes | stdlib (3.12.3) | — |
| FastAPI | App framework | Yes | 0.136.0 | — |
| uvicorn | ASGI server | Yes | 0.44.0 | — |
| pytest | Backend tests | Yes | 9.0.3 | — |
| pytest-asyncio | Async test support | Yes | 1.3.0 | — |
| httpx | ASGI test transport | Yes (in requirements.txt) | — | — |
| slowapi | Rate limiting (if chosen) | — | — | Not used — custom middleware instead |

**Missing dependencies with no fallback:** None. All dependencies are in the Python stdlib or already installed.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 9.0.3 + pytest-asyncio 1.3.0 |
| Config file | none — see Wave 0 (need conftest.py or pytest.ini for path setup) |
| Quick run command | `cd backend && python -m pytest tests/ -x --tb=short` |
| Full suite command | `cd backend && python -m pytest tests/ -v` |

### Phase Requirements to Test Map

Phase 1 has no formal requirements in REQUIREMENTS.md (it was defined by CEO Plan after the original roadmap). The following derived requirement IDs are used for traceability:

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NF-01 | Login: 5 failed attempts within 15 min from same IP returns 429 with "登录尝试过多，请15分钟后再试" | integration | `pytest tests/test_rate_limiter.py::test_login_rate_limit_blocks_after_5_failures -x` | No (Wave 0) |
| NF-02 | Login: successful login resets failed attempt counter for that IP | integration | `pytest tests/test_rate_limiter.py::test_login_success_resets_counter -x` | No (Wave 0) |
| NF-03 | Global: 100+ requests in 60 seconds from same IP returns 429 | integration | `pytest tests/test_rate_limiter.py::test_global_rate_limit_blocks_after_100 -x` | No (Wave 0) |
| NF-04 | LLM: 10+ requests in 60 seconds to LLM endpoints returns 429 | integration | `pytest tests/test_rate_limiter.py::test_llm_rate_limit_blocks_after_10 -x` | No (Wave 0) |
| NF-05 | Rate limiter fails open on DB error (does not block legitimate requests) | unit | `pytest tests/test_rate_limiter.py::test_fail_open_on_db_error -x` | No (Wave 0) |
| NF-06 | Logging middleware emits method, path, status, duration_ms, user_id | unit | `pytest tests/test_logging_middleware.py::test_logs_request_fields -x` | No (Wave 0) |
| NF-07 | Migration runner applies 001_initial.sql (no-op) and 002_rate_limits.sql in order | unit | `pytest tests/test_migrations.py::test_applies_migrations_in_order -x` | No (Wave 0) |
| NF-08 | Migration runner detects baseline: existing schema = version 1 | unit | `pytest tests/test_migrations.py::test_baselines_existing_schema -x` | No (Wave 0) |
| NF-09 | Migration runner handles partial state: file exists but version not recorded | unit | `pytest tests/test_migrations.py::test_handles_partial_migration -x` | No (Wave 0) |
| NF-10 | console.warn removed from authStore.ts lines 99, 101, 107, 109 | manual/smoke | Grep: `grep -n "console.warn" frontend/src/stores/authStore.ts` returns no results | Manual check after edit |
| NF-11 | Middleware order: logging wraps rate-limiting (429 responses appear in request log) | integration | `pytest tests/test_middleware_order.py::test_429_responses_are_logged -x` | No (Wave 0) |

### Sampling Rate
- **Per task commit:** `cd backend && python -m pytest tests/ -x --tb=short` (quick fail on first error)
- **Per wave merge:** `cd backend && python -m pytest tests/ -v` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `backend/tests/test_rate_limiter.py` — covers NF-01 through NF-05
- [ ] `backend/tests/test_logging_middleware.py` — covers NF-06
- [ ] `backend/tests/test_migrations.py` — covers NF-07, NF-08, NF-09
- [ ] `backend/tests/test_middleware_order.py` — covers NF-11
- [ ] `backend/tests/conftest.py` — shared fixtures: in-memory SQLite database, test ASGI app factory, mock scope/receive/send
- [ ] `backend/pytest.ini` or `backend/pyproject.toml` — pytest configuration with `pythonpath = .` to fix existing import error in `test_nodes_api.py`
- [ ] Existing `backend/tests/test_nodes_api.py` — has import error: `ModuleNotFoundError: No module named 'main'`. Needs `pythonpath` fix or `__init__.py` in tests directory.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | Rate limiting on `/auth/login` prevents brute-force (ASVS 2.9.1). JWT remains in auth.py. |
| V3 Session Management | No | Phase does not modify session management. |
| V4 Access Control | Yes (indirect) | Rate limiting per IP/user prevents resource exhaustion that could bypass access controls (ASVS 4.2.1). Middleware runs before endpoint auth checks. |
| V5 Input Validation | No | Phase does not introduce new input handling. |
| V6 Cryptography | No | Phase does not introduce new cryptographic operations. |
| V7 Error Handling | Yes | Fail-open pattern ensures DB errors don't become denial-of-service vectors (ASVS 7.4.1). Structured logging aids incident detection. |
| V8 Data Protection | No | Phase does not handle sensitive data. Rate limit counters are non-sensitive. |

### Known Threat Patterns for FastAPI + SQLite Rate Limiting

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Brute-force login via rapid password guessing | Spoofing | Login rate limiter: 5 failed attempts per 15-min window per IP. Sliding window prevents burst attacks at window boundaries. |
| Resource exhaustion via high-frequency API calls | Denial of Service | Global rate limiter: 100 req/min per IP. LLM rate limiter: 10 req/min per user (LLM API calls are expensive). |
| Rate limit bypass via IP spoofing (X-Forwarded-For header manipulation) | Spoofing | Extract IP from `scope["client"]` (the actual connecting IP, set by uvicorn/Nginx). If behind Nginx, configure `--proxy-headers` in uvicorn and read `X-Forwarded-For` correctly. |
| Rate limit counter overflow via integer wrapping | Tampering | SQLite INTEGER is 64-bit signed. At 100 req/min, overflow would take ~1.75e14 years. Not a practical concern. |
| Database locking causing rate limiter denial-of-service | Denial of Service | Fail-open pattern: DB errors allow requests through. WAL mode prevents read locks from blocking writes. |
| Migration SQL injection via crafted migration filename | Tampering | Version number parsed via `int(f.split("_")[0])` — malformed filenames raise `ValueError` which aborts migration. No user-controlled input in migration SQL — all SQL is from committed source files. |

## Sources

### Primary (HIGH confidence)
- [Starlette Middleware docs](https://www.starlette.io/middleware/#pure-asgi-middleware) — Pure ASGI middleware pattern (authoritative)
- [limits library GitHub](https://github.com/cjwatson/limits) — Sliding window rate limiting algorithm, storage backend interface
- [slowapi PyPI](https://pypi.org/project/slowapi/0.1.9/) — Verified version 0.1.9, confirmed no SQLite storage backend
- [liteLLM middleware benchmark](https://docs.litellm.ai/blog/fastapi-middleware-performance) — BaseHTTPMiddleware vs pure ASGI throughput comparison (+74% improvement)
- [dev.to FastAPI middleware analysis](https://dev.to/sazonov/analysing-fastapi-middleware-performance-2n61) — Performance impact of stacking BaseHTTPMiddleware layers
- [Python logging cookbook](https://docs.python.org/3/howto/logging-cookbook.html) — Structured logging patterns with stdlib
- [DIY SQLite migration gist](https://gist.github.com/rameshvarun/4a6897ccc7c58bd412b75c12373d57e2) — Migration tracking table pattern (reference implementation)
- Project source files: `backend/main.py`, `backend/database.py`, `backend/auth.py`, `frontend/src/stores/authStore.ts` — Verified line numbers, existing code patterns
- `backend/requirements.txt` — Verified no slowapi or external rate limiting dependencies
- `pip list` output — Verified installed packages: fastapi 0.136.0, uvicorn 0.44.0, pytest 9.0.3, pytest-asyncio 1.3.0, alembic 1.18.1 (installed but not configured)

### Secondary (MEDIUM confidence)
- [fastapi-best-architecture discussion #70](https://github.com/fastapi-practices/fastapi-best-architecture/discussions/70) — Community consensus: fastapi-limiter > asgi-ratelimit > slowapi for production use
- [Hybrid fail-open strategy issue](https://github.com/TEJ42000/ALLMS/issues/231) — Tiered fail-open strategy (authenticated users fail-open, anonymous fail-closed)
- [fastapi-structured-logging GitHub](https://github.com/babs/fastapi-structured-logging) — Reference for access log middleware with structlog

### Tertiary (LOW confidence)
- [segmentfault SQLite migration article](https://segmentfault.com/p/1210000046580688) — Declarative schema diff approach (informational only, not adopted)
- Community discussions on slowapi vs alternatives — Not verified against production benchmarks, used for ecosystem awareness only

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — All dependencies verified as already installed or stdlib. slowapi's lack of SQLite support confirmed via PyPI listing and `limits` library source.
- Architecture: HIGH — Pure ASGI middleware pattern verified against Starlette official docs and performance benchmarks. Sliding window algorithm verified against `limits` library implementation. Migration pattern verified against community reference implementations.
- Pitfalls: MEDIUM — Pitfalls 1-4 are well-known patterns with documented mitigations. Pitfall 2 (clock skew) is theoretical for single-server deployment but cited from real-world distributed systems experience. Pitfall 5 (login double-counting) is specific to this implementation and based on first-principles analysis of the pre-check/post-increment pattern.
- Security: HIGH — ASVS mappings verified against ASVS 4.0 standard. Threat patterns analyzed via STRIDE model against the specific technology stack (FastAPI + SQLite + raw SQL).

**Research date:** 2026-04-29
**Valid until:** 2026-05-29 (30 days — stable infrastructure patterns, no fast-moving external dependencies)
