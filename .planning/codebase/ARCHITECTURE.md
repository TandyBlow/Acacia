# Architecture

**Analysis Date:** 2026-04-27

## System Overview

```text
+-----------------------------------------------------------------------------+
|                              CLIENT BROWSER                                 |
|  +-----------------------------------------------------------------------+  |
|  |            App.vue (error boundary)                                    |  |
|  |  +------------------------------------------------------------------+  |  |
|  |  |           MainLayout.vue (CSS Grid shell)                        |  |  |
|  |  |  +-----------+  +-------------+  +----------------------------+  |  |  |
|  |  |  | LogoArea  |  | Breadcrumbs |  |         Knob               |  |  |  |
|  |  |  `src/components/layout/LogoArea.vue`                         |  |  |  |
|  |  |  +-----------+  +-------------+  +----------------------------+  |  |  |
|  |  |  | Navigation|  |  Content Area (dynamic component)            |  |  |  |
|  |  |  | sidebar   |  |  AuthPanel | MarkdownEditor | ConfirmPanel   |  |  |  |
|  |  |  |           |  |  GlobalTree | TreeCanvas | QuizPanel etc.   |  |  |  |
|  |  |  +-----------+  +----------------------------------------------+  |  |  |
|  |  +------------------------------------------------------------------+  |  |
|  +-----------------------------------------------------------------------+  |
|           |                              |                                   |
|    Pinia State:               Composables (useQuiz, useStats, etc.)         |
|    authStore, nodeStore,      call apiFetch() directly                      |
|    styleStore                                                                |
|           |                              |                                   |
|  +--------v------------------------------v--------------------------------+  |
|  |                  Adapter Layer (`src/adapters/`)                        |  |
|  |  backendAdapter  --OR--  localAdapter                                   |  |
|  |  Selected at boot by VITE_DATA_MODE env var                            |  |
|  +--------+--------------------------------+------------------------------+  |
+-----------|--------------------------------|--------------------------------+
            | HTTP REST (backendAdapter)     | localStorage (localAdapter)
            v                                v
+------------------------------+    +------------------+
|   FastAPI Backend            |    |  localStorage    |
|   main.py (620 lines)        |    |  (seed data +    |
|   Port 7860                  |    |   user data)     |
|                              |    +------------------+
|  +------------------------+  |
|  |  Service Layer         |  |
|  |  quiz_service_sqlite   |  |
|  |  review_service_sqlite  |  |
|  |  ai_generate_service_  |  |
|  |    sqlite               |  |
|  |  style_service_sqlite   |  |
|  |  tag_service_sqlite     |  |
|  +------------------------+  |
|  +------------------------+  |
|  |  Repository Layer      |  |
|  |  tree_repository_      |  |
|  |    sqlite.py            |  |
|  +------------------------+  |
|  +------------------------+  |
|  |  Persistence           |  |
|  |  database.py           |  |
|  |  SQLite (WAL mode)     |  |
|  +------------------------+  |
|  +------------------------+  |
|  |  Auth                  |  |
|  |  auth.py (JWT HS256)   |  |
|  +------------------------+  |
|  +------------------------+  |
|  |  Tree Generation       |  |
|  |  tree_skeleton.py       |  |
|  |  lsystem.py             |  |
|  +------------------------+  |
+------------------------------+
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| `App.vue` | Error boundary wrapping `MainLayout` | `frontend/src/App.vue` |
| `MainLayout.vue` | CSS Grid shell; maps `ViewState` to dynamic content component; compact/mobile layout switching | `frontend/src/views/MainLayout.vue` |
| `LogoArea` | App branding/logo display | `frontend/src/components/layout/LogoArea.vue` |
| `Breadcrumbs` | Ancestor path navigation bar | `frontend/src/components/layout/Breadcrumbs.vue` |
| `Navigation` | Sidebar: child node list + tree browser | `frontend/src/components/layout/Navigation.vue` |
| `Knob` | Multi-purpose action button (context-sensitive hold/click/double-click) | `frontend/src/components/layout/Knob.vue` |
| `MarkdownEditor` | TipTap rich-text editor for node content | `frontend/src/components/editor/MarkdownEditor.vue` |
| `AuthPanel` | Login/register form (unauthenticated state) | `frontend/src/components/auth/AuthPanel.vue` |
| `ConfirmPanel` | Confirm add/move/delete operations | `frontend/src/components/ui/ConfirmPanel.vue` |
| `GlobalTree` | 2D tree view for move-target selection | `frontend/src/components/tree/GlobalTree.vue` |
| `TreeCanvas` | Three.js 3D tree visualization (SceneManager host) | `frontend/src/components/tree/TreeCanvas.vue` |
| `SceneManager` | Three.js scene lifecycle: skeleton-to-mesh, theme switching, camera, animation loop | `frontend/src/components/tree/scene/SceneManager.ts` |
| `BackgroundRenderer` | SDF raymarching background pipeline | `frontend/src/components/tree/scene/BackgroundRenderer.ts` |
| `UserDataMapper` | Maps user tree data to ez-tree parameters (branch counts, colors, wind) | `frontend/src/components/tree/scene/UserDataMapper.ts` |
| `ThemeTransition` | Interpolates between theme parameter sets | `frontend/src/components/tree/scene/ThemeTransition.ts` |
| `useAppInit` | Boot sequence: auth init -> node init -> skeleton preload -> style fetch | `frontend/src/composables/useAppInit.ts` |
| `useKnobDispatch` | Knob action dispatch: routes hold/click/double-click to store actions | `frontend/src/composables/useKnobDispatch.ts` |
| `authStore` | JWT auth session, login/register/logout, persisted via Pinia plugin | `frontend/src/stores/authStore.ts` |
| `nodeStore` | All tree state: active node, path, children, ViewState machine, CRUD operations | `frontend/src/stores/nodeStore.ts` |
| `styleStore` | Theme style (default/sakura/cyberpunk/ink) computed from node domain tags | `frontend/src/stores/styleStore.ts` |
| `backendAdapter` | `DataAdapter` implementation: HTTP REST to FastAPI | `frontend/src/adapters/backendAdapter.ts` |
| `localAdapter` | `CoreDataAdapter` implementation: localStorage-based with seed data | `frontend/src/adapters/localAdapter.ts` |
| `apiFetch` | Thin fetch wrapper: reads JWT from localStorage, sets Bearer header, parses errors | `frontend/src/utils/api.ts` |
| `nodeCache` | In-memory TTL cache for `NodeContext` to avoid redundant API calls | `frontend/src/services/nodeCache.ts` |
| `fastapi/main.py` | All REST endpoints: auth, node CRUD, tree generation, quiz, review, AI | `backend/main.py` |
| `database.py` | SQLite connection pool, schema init, WAL mode, PRAGMA tuning | `backend/database.py` |
| `auth.py` | bcrypt password hashing, JWT HS256 token create/verify | `backend/auth.py` |
| `tree_repository_sqlite.py` | Data access layer: fetches user tree with depth and child counts | `backend/tree_repository_sqlite.py` |
| `tree_skeleton.py` | Space Colonization tree skeleton generator (version 2) | `backend/tree_skeleton.py` |
| `lsystem.py` | L-system tree skeleton generator (version 1, legacy) | `backend/lsystem.py` |
| `quiz_service_sqlite.py` | AI-generated quiz questions via SiliconFlow API, persisted to quiz_questions table | `backend/quiz_service_sqlite.py` |
| `review_service_sqlite.py` | FSRS spaced repetition scheduling | `backend/review_service_sqlite.py` |
| `ai_generate_service_sqlite.py` | AI node generation from user input | `backend/ai_generate_service_sqlite.py` |
| `tag_service_sqlite.py` | Domain classification via keyword matching | `backend/tag_service_sqlite.py` |
| `style_service_sqlite.py` | Theme style computation from domain tag distribution | `backend/style_service_sqlite.py` |

## Pattern Overview

**Overall:** Adapter Pattern + State Machine

**Key Characteristics:**
- **Dual adapter architecture:** `DataAdapter` interface (`frontend/src/types/node.ts`) abstracts data access; `backendAdapter` and `localAdapter` are runtime-swapped at boot via `VITE_DATA_MODE` env var
- **ViewState machine:** The app is a single-page state machine driven by `nodeStore.viewState`, with values `display | add | move | delete | tree | quiz | quiz_history | stats | review`
- **Static DI injection:** Adapters and router navigator are injected into stores via module-level setter functions (`setDataAdapter`, `setAuthAdapter`, `setNavigator`) at boot, NOT constructor injection
- **Composables as service facades:** Feature logic (quiz, review, stats, AI generation) lives in Vue composables under `frontend/src/composables/`, each managing its own `isBusy`/`errorMessage` reactive state and calling `apiFetch()` directly (NOT through the adapter)
- **Backend is a flat FastAPI app:** All endpoints in a single `main.py` (620 lines); service modules are pure functions taking a `conn` parameter; no class-based service layer or DI framework
- **Tree visualization is Three.js client-side:** Skeleton data is computed server-side (Space Colonization algorithm), then rendered as a 3D scene in the browser using the `@dgreenheck/ez-tree` library

## Layers

**Frontend - View Layer:**
- Purpose: Renders UI based on current state; maps `ViewState` to Vue components
- Location: `frontend/src/views/MainLayout.vue`, `frontend/src/components/`
- Contains: All `.vue` SFCs, Three.js scene management
- Depends on: Pinia stores (`nodeStore`, `authStore`, `styleStore`) and composables
- Used by: Nothing (topmost)

**Frontend - State Layer (Pinia Stores):**
- Purpose: Centralized reactive state, business logic orchestration, ViewState machine
- Location: `frontend/src/stores/`
- Contains: `authStore.ts` (auth session), `nodeStore.ts` (tree + view state), `styleStore.ts` (theme)
- Depends on: DataAdapter (injected), router navigator (injected), `nodeCache` service
- Used by: View Layer components directly, composables

**Frontend - Service/Adapter Layer:**
- Purpose: Abstract data access behind `DataAdapter` interface; HTTP transport; caching
- Location: `frontend/src/adapters/`, `frontend/src/services/`, `frontend/src/utils/api.ts`
- Contains: `backendAdapter.ts`, `localAdapter.ts`, `backendAuth.ts`, `localAuth.ts`, `nodeCache.ts`, `api.ts`
- Depends on: Types (`node.ts`, `auth.ts`), browser fetch/localStorage
- Used by: Stores (`nodeStore`, `authStore`), composables (useQuiz etc. call `apiFetch` directly)

**Frontend - Domain Logic Layer (Composables):**
- Purpose: Feature-specific logic (quiz generation, review scheduling, stats, AI generation)
- Location: `frontend/src/composables/`
- Contains: `useQuiz.ts`, `useReview.ts`, `useStats.ts`, `useAiGenerate.ts`, `useTreeSkeleton.ts`, `useAppInit.ts`, `useKnobDispatch.ts`, `useLogoutFlow.ts`, `useKnobHints.ts`
- Depends on: `apiFetch` directly (NOT through stores), Pinia stores for user ID
- Used by: Vue components

**Backend - API Layer:**
- Purpose: HTTP endpoints, request validation, auth middleware, response formatting
- Location: `backend/main.py`
- Contains: All `@app.get`/`@app.post`/`@app.patch`/`@app.delete` route handlers
- Depends on: Service modules, `database.py`, `auth.py`
- Used by: Nginx reverse proxy, frontend `backendAdapter`

**Backend - Service Layer:**
- Purpose: Business logic for quizzes, reviews, AI generation, tagging, styling, tree data access
- Location: `backend/*_service_sqlite.py`, `backend/tree_repository_sqlite.py`
- Contains: Pure functions accepting `owner_id` and `conn` (SQLite connection)
- Depends on: `database.py` for `get_db_ctx`, external APIs (SiliconFlow for AI)
- Used by: `main.py` endpoints

**Backend - Persistence Layer:**
- Purpose: SQLite connection management, schema creation/migration, WAL mode tuning
- Location: `backend/database.py`
- Contains: `get_db()`, `get_db_ctx()`, `init_db()`
- Depends on: `sqlite3` stdlib module
- Used by: All service modules and `main.py` endpoints

**Backend - Tree Generation Engine:**
- Purpose: Generate tree skeleton data (branch coordinates, thickness, crown outline) from user node data
- Location: `backend/tree_skeleton.py`, `backend/lsystem.py`
- Contains: Space Colonization algorithm (v2) and L-system (v1), selected by `TREE_GEN_VERSION` env var
- Depends on: `tree_repository_sqlite.py` for data
- Used by: `main.py` `/generate-tree-skeleton` endpoint

## Data Flow

### Primary Request Path (Node Browsing)

1. `MainLayout.vue` `onMounted` -> `useAppInit()` -> `authStore.initialize()` -> auth adapter checks stored JWT (`frontend/src/composables/useAppInit.ts:18`)
2. `authStore.initialize()` sets `user` ref or stays null (`frontend/src/stores/authStore.ts:91`)
3. If authenticated, `nodeStore.initialize()` reads `route.params.id`, calls `loadNode(id)` (`frontend/src/stores/nodeStore.ts:161`)
4. `loadNode` checks `nodeCache` first, then calls `dataAdapter.getNodeContext(nodeId)` (`frontend/src/stores/nodeStore.ts:111-146`)
5. `backendAdapter.getNodeContext` -> `apiFetch('/nodes/context/{nodeId}')` -> HTTP GET to backend (`frontend/src/adapters/backendAdapter.ts:6`)
6. Backend `get_node_context` queries nodes table, builds ancestor path via `_build_path()`, returns `NodeContext` JSON (`backend/main.py:174-214`)
7. Store updates `activeNode`, `pathNodes`, `childNodes` refs; Vue reactivity re-renders breadcrumbs, navigation, editor (`frontend/src/stores/nodeStore.ts:130-137`)
8. `nodeCache.setCache(nodeId, context)` caches result for back-navigation (`frontend/src/stores/nodeStore.ts:138`)
9. Router path synced: `navigate('/node/{nodeId}')` via injected `router.push` (`frontend/src/stores/nodeStore.ts:122`)

### Tree Visualization Flow

1. After auth init, `useAppInit` calls `preloadSkeleton()` -> `useTreeSkeleton.fetchSkeleton()` (`frontend/src/composables/useAppInit.ts:21`)
2. `fetchSkeleton` calls `adapter.fetchTreeSkeleton(userId, canvasW, canvasH)` (`frontend/src/composables/useTreeSkeleton.ts:28`)
3. Backend `/generate-tree-skeleton` -> `fetch_user_tree_sqlite(owner_id)` -> `_generate_skeleton(tree_data)` -> Space Colonization algorithm -> returns `SkeletonData` JSON (`backend/main.py:426-437`)
4. `TreeCanvas.vue` onMounted reads `skeletonData` ref, passes to `SceneManager.buildScene(skeleton)` (`frontend/src/components/tree/TreeCanvas.vue`)
5. `SceneManager.buildScene` creates Three.js scene, builds branch meshes via `@dgreenheck/ez-tree`, sets up camera/renderer, starts animation loop (`frontend/src/components/tree/scene/SceneManager.ts:117-154`)
6. Branch click -> raycaster hit detection -> `callbacks.onBranchClick(nodeId)` -> `nodeStore.loadNode(nodeId)` navigates to that node (`frontend/src/components/tree/scene/SceneManager.ts`)

### Auth Flow

1. Unauthenticated user sees `AuthPanel` (login/register toggle) (`frontend/src/views/MainLayout.vue:144-145`)
2. Knob hold -> `useKnobDispatch.onHoldConfirm()` -> `authStore.submitByKnob()` (`frontend/src/composables/useKnobDispatch.ts:51-52`)
3. `authStore` calls `authAdapter.signIn(username, password)` or `authAdapter.signUp()` (`frontend/src/stores/authStore.ts:138-139`)
4. `backendAuth.signIn` -> `apiFetch('/auth/login', {POST})` -> backend validates credentials, returns JWT token (`frontend/src/adapters/backendAuth.ts`)
5. Backend `login()` endpoint: bcrypt verify, HS256 JWT with 7-day expiry (`backend/main.py:113-121`, `backend/auth.py:23-29`)
6. `backendAuth` stores token in localStorage under `acacia_backend_token` key (`frontend/src/utils/api.ts:3`)
7. All subsequent `apiFetch` calls read token from localStorage, attach `Authorization: Bearer <token>` header (`frontend/src/utils/api.ts:13-18`)

### Quiz Flow

1. User navigates to a node, Knob action triggers `nodeStore.startQuiz()` (`frontend/src/stores/nodeStore.ts:211`)
2. `MainLayout` renders `QuizPanel` (ViewState = `quiz`) (`frontend/src/views/MainLayout.vue:153-155`)
3. `QuizPanel` calls `useQuiz().generateQuestion(nodeId)` -> `apiFetch('/generate-question/{nodeId}')` POST (`frontend/src/composables/useQuiz.ts:54-57`)
4. Backend `generate_question_endpoint` -> `generate_quiz_question_sqlite()` -> calls SiliconFlow LLM API to generate question -> saves to `quiz_questions` table -> returns JSON (`backend/main.py:507-521`)
5. User answers -> `useQuiz().submitAnswer(nodeId, isCorrect)` -> POST `/submit-answer/{nodeId}` -> records in `quiz_records` table (`frontend/src/composables/useQuiz.ts:130-139`, `backend/main.py:573-580`)

**State Management:**
- Pinia stores are the single source of truth for all UI state
- `authStore` state is persisted via `pinia-plugin-persistedstate` (survives page refresh)
- `nodeStore` uses an in-memory TTL cache (`nodeCache.ts`, default TTL `10000ms`) to avoid re-fetching nodes during back-navigation
- Composables hold local reactive state (e.g., `currentQuestion`, `selectedOption`) scoped to the component instance that calls them
- `skeletonData` is a module-level `ref` (outside any composable) in `useTreeSkeleton.ts` — acts as a singleton cache

## Key Abstractions

**`DataAdapter` interface (frontend):**
- Purpose: Decouples all tree CRUD operations from their implementation (REST vs localStorage)
- Defined in: `frontend/src/types/node.ts:43-60`
- Implementations: `backendAdapter` (`frontend/src/adapters/backendAdapter.ts`), `localAdapter` (`frontend/src/adapters/localAdapter.ts`)
- Pattern: Structural Adapter pattern; selected at import time by `loadAdapters()` (`frontend/src/adapters/index.ts`)
- Extended by `TreeDataAdapter` for tree visualization endpoints (`fetchTreeSkeleton`, `tagNodes`, `fetchStyle`)

**`AuthAdapter` interface (frontend):**
- Purpose: Decouples auth operations from their implementation
- Defined in: `frontend/src/types/auth.ts`
- Implementations: `backendAuth` (`frontend/src/adapters/backendAuth.ts`), `localAuth` (`frontend/src/adapters/localAuth.ts`)

**`ViewState` state machine (frontend):**
- Purpose: Controls which UI component is rendered in the content area and what Knob actions do
- Defined in: `frontend/src/types/node.ts:3`
- States: `display | add | move | delete | tree | quiz | quiz_history | stats | review`
- Transitions managed by `nodeStore` action methods (`startAdd`, `startDelete`, `startMove`, `startQuiz`, etc.)
- `MainLayout.vue` `nonTreeContent` computed maps each state to a component (`frontend/src/views/MainLayout.vue:143-166`)

**`NodeContext` type (frontend):**
- Purpose: Groups the three pieces of data needed to render any node view
- Defined in: `frontend/src/types/node.ts:25-29`
- Contains: `nodeInfo` (the current node), `pathNodes` (ancestors for breadcrumbs), `children` (for sidebar)

**`get_db_ctx` context manager (backend):**
- Purpose: Provides transactional SQLite connections with auto-commit/rollback
- Defined in: `backend/database.py:18-27`
- Pattern: Python context manager with `try/yield/commit/except/rollback/finally/close`
- Used by: Every endpoint handler and service function

**`get_current_user` dependency (backend):**
- Purpose: FastAPI dependency that extracts and validates JWT from `Authorization: Bearer` header
- Defined in: `backend/main.py:56-62`
- Pattern: FastAPI `Depends()` injection into route handler parameters

**`SkeletonData` type (shared):**
- Purpose: Transfer object carrying tree visualization geometry from backend to frontend
- Defined in: `frontend/src/types/tree.ts:48-61`
- Contains: `branches[]`, `trunk[]`, `ground[]`, `roots[]`, `fork_points[]`, `crown_outline`, `growth`

## Entry Points

**Frontend Entry:**
- Location: `frontend/src/main.ts`
- Triggers: Browser loads `index.html` -> Vite bundles and serves this as the SPA entry
- Responsibilities: Creates Vue app, Pinia store with persisted state plugin, loads adapters, injects into stores, mounts app

**Backend Entry:**
- Location: `backend/main.py`
- Triggers: `uvicorn main:app --host 0.0.0.0 --port 7860`
- Responsibilities: Creates FastAPI app, configures CORS, registers all routes, runs `init_db()` on startup

**Router:**
- Location: `frontend/src/router.ts`
- Routes: `/` (home/tree view), `/node/:id` (node detail)
- Pattern: All routes render an empty component; the real component rendering happens inside `MainLayout.vue` based on `ViewState` — the router only drives URL state and back/forward navigation

**Deployment Entry:**
- Production: Nginx serves built frontend static files, proxies `/api/*` to uvicorn backend (`deploy/nginx.conf`)
- Docker Compose: Frontend (Nginx + static) and backend (uvicorn) in separate services (`docker-compose.yml`)
- Systemd: Backend runs as a systemd service (`deploy/acacia.service`)

## Architectural Constraints

- **Threading:** Backend (FastAPI + uvicorn) is single-threaded async; SQLite is connection-per-request with WAL mode for concurrent reads. Frontend is single-threaded browser JS.
- **Global state:** `nodeStore` and `authStore` are Pinia singletons accessible from any component. `skeletonData` (`frontend/src/composables/useTreeSkeleton.ts:7-8`) is a module-level `ref` shared across all consumers. `dataAdapter` and `authAdapter` are module-level variables in store modules (`frontend/src/stores/nodeStore.ts:18`, `frontend/src/stores/authStore.ts:16`), set once at boot via setter functions.
- **Circular imports:** No detected circular dependencies. Adapter loading uses dynamic `import()` to enable tree-shaking of the unused adapter path.
- **Adapter coupling:** Composables (`useQuiz`, `useStats`, `useReview`, `useAiGenerate`) bypass the `DataAdapter` abstraction and call `apiFetch()` directly. This means these features only work in `backend` data mode — they have no `localAdapter` equivalent. The `CoreDataAdapter` interface does not include quiz/stats/review methods.
- **Backend module organization:** Backend has no layered package structure — all service modules are flat files in `backend/`. Database connections are opened per-request via `get_db_ctx()`, not via a connection pool or ORM.
- **UI language:** All user-facing strings are Chinese, collected in `frontend/src/constants/uiStrings.ts`.
- **Production URL routing:** Frontend dev server proxies `/api` to backend via Vite config. Production uses Nginx `proxy_pass` for `/api/*` paths.

## Anti-Patterns

### Composables Bypassing Adapter Abstraction

**What happens:** Feature composables (`useQuiz`, `useStats`, `useReview`, `useAiGenerate`) import and call `apiFetch` directly instead of going through the `DataAdapter` interface. Quiz endpoints, review endpoints, stats endpoints, and AI endpoints do not appear in the `DataAdapter` interface at all.

**Why it's wrong:** If a user sets `VITE_DATA_MODE=local`, quiz/review/stats/AI features will fail at runtime because there is no local fallback. The dual-adapter architecture is incomplete — it covers tree CRUD but not the feature modules.

**Do this instead:** Extend `DataAdapter` (or a separate `FeatureAdapter`) to include quiz/review/stats/AI methods, implement in both `backendAdapter` and `localAdapter`, and have composables call through the adapter. Or, document clearly that these features require `backend` mode.

### Global Mutable Module-Level State

**What happens:** `dataAdapter` and `authAdapter` are module-level mutable variables (`nodeStore.ts:18`, `authStore.ts:16`) set via imperative setter functions at boot. `skeletonData` is a module-level `ref` in `useTreeSkeleton.ts:7`.

**Why it's wrong:** Module-level mutable state makes testing harder (must reset between tests) and creates implicit dependencies across the codebase. Any module importing `getDataAdapter()` couples to whatever was last set. Hot module replacement (HMR) during development may not reset these correctly.

**Do this instead:** Use Pinia's `$state` or provide/inject for DI. For skeleton data, consider making it part of a Pinia store or accepting it as a parameter rather than a module singleton.

### Monolithic Backend Endpoint File

**What happens:** All 18+ REST endpoints live in a single `main.py` (620 lines) with inline business logic, request models, and helper functions (`_build_path`, `_node_to_dict`, `_soft_delete_subtree`, `_is_descendant`).

**Why it's wrong:** As features grow, `main.py` becomes harder to navigate and test in isolation. The node CRUD section alone is ~200 lines with four private helper functions and five request models defined inline.

**Do this instead:** Split into FastAPI routers by domain (`routers/auth.py`, `routers/nodes.py`, `routers/quiz.py`, `routers/tree.py`), move Pydantic models to `schemas/`, keep `main.py` as the app factory that includes routers.

### Stub Implementations and Dead Code

**What happens:** `localAdapter.testSakuraTag()` is a no-op (`localAdapter.ts:60-62`). `SceneManager.ts` has commented-out proctree code references (lines 13-15 and 23-26). Particle system and ground mesh code are commented out (`SceneManager.ts:92-93`, `143-145`). Shader imports for `ground2d` and `particle` are commented out (`SceneManager.ts:13,17`).

**Why it's wrong:** Dead code and no-ops create confusion about what is functional. The proctree vs ez-tree migration appears incomplete with vestigial references.

**Do this instead:** Remove fully migrated code (proctree references). Either implement the particle/ground features or remove the commented code. Make `testSakuraTag` throw an explicit "not supported in local mode" error rather than silently succeeding.

## Error Handling

**Strategy:** Try-catch in every async operation with user-facing error messages in Chinese.

**Patterns:**
- Store actions: `isBusy = true`, try/catch, set `errorMessage` ref on failure, `isBusy = false` in finally (`frontend/src/stores/nodeStore.ts:126-146`)
- Composables: Same pattern with local `isBusy`/`errorMessage` refs (`frontend/src/composables/useQuiz.ts:36-38, 45-64`)
- `apiFetch`: Throws `Error` on non-2xx responses with response body text as message (`frontend/src/utils/api.ts:20-25`)
- Backend endpoints: Raise `HTTPException` with appropriate status code and detail message (`backend/main.py:94-95`)
- Backend services: Raise `ValueError` for validation, other exceptions caught by endpoint handler and re-raised as HTTP 500 (`backend/main.py:470-472`)
- Silent failures: Some operations intentionally swallow errors (answer recording `useQuiz.ts:136-138`, style fetch `styleStore.ts:33`, skeleton preload `useTreeSkeleton.ts:73`)
- `App.vue` has an `onErrorCaptured` error boundary that shows a retry button (`frontend/src/App.vue:8-15`)

## Cross-Cutting Concerns

**Logging:** `console.warn` for debug tracing in `authStore.ts` (lines 99, 101, 107, 109). No structured logging framework on either frontend or backend. Backend uses FastAPI default logging. No log level configuration env var.

**Validation:** Frontend: computed properties (`canConfirm`, `canSubmit`) gate user actions. Backend: FastAPI path validation + manual string trimming / empty checks in endpoint handlers (no Pydantic field validators with `min_length` etc.). Node name uniqueness enforced at API/database level for siblings.

**Authentication:** JWT Bearer token flow. Frontend stores token in `localStorage` under `acacia_backend_token` key. Backend `get_current_user` FastAPI dependency extracts and validates token on every protected endpoint. No refresh token mechanism — token expires after 7 days, user must re-login. CORS allows all origins (`allow_origins=["*"]`).

**View Transitions:** `MainLayout.vue` uses the View Transition API (`document.startViewTransition`) for smooth crossfades between content states (`frontend/src/views/MainLayout.vue:182-196`). Falls back to CSS opacity animation when View Transition API is unavailable.

**Compact/Mobile Layout:** `MainLayout.vue` monitors `window.innerWidth`/`innerHeight` and switches to compact layout below 900px, and three-mode compact layout (content/nav/feature) below 600px. Compact mode ref is injected via `provide('isTreeResizing', ...)` for cross-component sharing.

---

*Architecture analysis: 2026-04-27*
