# Codebase Structure

**Analysis Date:** 2026-04-27

## Directory Layout

```
Acacia/                                 # Project root
├── frontend/                           # Vue 3 + TypeScript SPA (the main application)
│   ├── public/                         # Static assets served as-is (PWA manifest, service worker, icons)
│   │   └── sw.js                       # Custom service worker for PWA offline support
│   ├── src/                            # Application source code
│   │   ├── adapters/                   # DataAdapter and AuthAdapter implementations (backend REST + localStorage)
│   │   ├── api/                        # (empty — API client logic lives in utils/api.ts and adapters/)
│   │   ├── assets/                     # Static assets processed by Vite (images, textures)
│   │   │   └── textures/              # Leaf textures for Three.js tree rendering
│   │   ├── components/                 # Vue SFCs organized by domain
│   │   │   ├── ai/                    # AI node generation popup
│   │   │   ├── auth/                  # Login/register panel
│   │   │   ├── editor/               # TipTap rich-text editor + Markdown extensions
│   │   │   │   └── extensions/       # Custom TipTap extensions (code block UI, Markdown input rules)
│   │   │   ├── layout/               # Shell components: Logo, Breadcrumbs, Navigation, Knob
│   │   │   ├── quiz/                 # Quiz panel and quiz history panel
│   │   │   ├── review/               # Spaced repetition review panel
│   │   │   ├── stats/                # Quiz performance stats panel
│   │   │   ├── tree/                 # Tree visualization (2D + 3D)
│   │   │   │   ├── scene/           # Three.js scene management (SceneManager, shaders, geometry)
│   │   │   │   └── shaders/         # GLSL shader source files (crown, trunk, sky, SDF, particles)
│   │   │   └── ui/                   # Generic UI: ConfirmPanel, FeaturePanel, GlassWrapper
│   │   ├── composables/              # Vue composables (reactive logic hooks)
│   │   ├── constants/                # Magic values, breakpoints, theme presets, Chinese UI strings
│   │   ├── services/                 # Non-Vue utility services (node cache)
│   │   ├── stores/                   # Pinia state stores (auth, node, style)
│   │   ├── types/                    # TypeScript interfaces and types (shared contracts)
│   │   ├── utils/                    # Pure utility functions (API fetch, tree manipulation)
│   │   ├── vendor/                   # Vendored third-party code (proctree algorithm, legacy)
│   │   ├── views/                    # Top-level page/shell components (MainLayout)
│   │   ├── App.vue                   # Root component (error boundary wrapping MainLayout)
│   │   ├── config.ts                 # Runtime config derived from env vars (data mode, backend URL)
│   │   ├── main.ts                   # Application entry: Vue app creation, Pinia, DI bootstrap
│   │   ├── router.ts                 # Vue Router config (two routes: / and /node/:id)
│   │   └── style.css                 # Global styles, CSS custom properties (theming)
│   ├── .vscode/                      # VS Code workspace settings (Volar takeover, etc.)
│   ├── dist/                         # Production build output (generated, not committed by default)
│   ├── index.html                    # Vite HTML entry point
│   ├── package.json                  # npm dependencies and scripts
│   ├── tsconfig.json                 # TypeScript configuration
│   └── vite.config.ts                # Vite build config (PWA plugin, proxy, aliases)
├── backend/                          # FastAPI Python application
│   ├── tests/                        # Backend test suite (pytest + httpx ASGI transport)
│   │   └── test_nodes_api.py         # API integration tests for node CRUD
│   ├── main.py                      # FastAPI app: all REST endpoints, CORS, auth dependency
│   ├── database.py                   # SQLite connection management, schema init, migrations
│   ├── auth.py                       # bcrypt + JWT (HS256) authentication
│   ├── tree_repository_sqlite.py     # Data access layer for tree queries
│   ├── tree_skeleton.py              # Space Colonization tree skeleton generator (v2)
│   ├── lsystem.py                    # L-system tree generator (v1, legacy)
│   ├── renderer.py                   # Tree rendering utilities (backend-side)
│   ├── quiz_service_sqlite.py        # AI quiz generation service (SiliconFlow API)
│   ├── review_service_sqlite.py      # FSRS spaced repetition service
│   ├── ai_generate_service_sqlite.py # AI node content generation service
│   ├── tag_service_sqlite.py         # Domain keyword classification service
│   ├── style_service_sqlite.py       # Theme style computation from domain tags
│   ├── migrate_from_supabase.py      # Migration script from Supabase to SQLite (legacy)
│   ├── deploy_to_hf.py               # HuggingFace Spaces deployment script
│   ├── test_minimal.py               # Minimal backend smoke test
│   ├── test_tree_generator.py        # Tree generator integration test
│   ├── test_tree_generator_unit.py   # Tree generator unit tests
│   ├── test_tree_skeleton_unit.py    # Tree skeleton unit tests
│   ├── DockerFile                    # Backend Docker image build
│   └── requirements.txt              # Python dependencies
├── deploy/                           # Deployment configuration
│   ├── nginx.conf                    # Nginx reverse proxy config (frontend static + /api proxy)
│   ├── acacia.service                # systemd unit file for backend
│   ├── setup.sh                      # Initial VPS setup script
│   └── deploy.sh                     # Update/deploy script
├── .github/                          # GitHub Actions CI/CD
│   ├── workflows/                    # Workflow definitions
│   └── scripts/                      # CI helper scripts
├── .planning/                        # GSD planning artifacts (generated, committed)
│   └── codebase/                     # Codebase analysis documents
├── .claude/                          # Claude Code configuration
│   └── skills/                       # Project-specific skills
├── .gitignore                        # Git ignore rules
├── CLAUDE.md                         # Claude Code project instructions
├── AGENTS.md                         # Agent configuration
├── DEPLOY.md                         # Deployment documentation
├── docker-compose.yml                # Multi-service Docker Compose config
├── dev.bat                           # Windows development quick-start script
└── acacia.db                         # SQLite database file (development data, gitignored)
```

## Directory Purposes

**`frontend/src/adapters/`:**
- Purpose: Implementation of `DataAdapter` and `AuthAdapter` interfaces for both backend (REST) and local (localStorage) modes
- Contains: TypeScript modules with exported constant objects satisfying the adapter interfaces
- Key files: `backendAdapter.ts`, `localAdapter.ts`, `backendAuth.ts`, `localAuth.ts`, `index.ts` (dynamic loader)

**`frontend/src/stores/`:**
- Purpose: Pinia state stores — the single source of truth for all application state
- Contains: `authStore.ts` (auth session, login/register/logout), `nodeStore.ts` (tree state, ViewState machine, CRUD), `styleStore.ts` (theme style from domain tags)
- Key files: `nodeStore.ts` (361 lines — largest store), `authStore.ts`

**`frontend/src/components/`:**
- Purpose: Vue Single File Components, organized by feature domain
- Contains: `.vue` SFCs with `<script setup lang="ts">`, some `.ts` companion files for complex logic (scene manager, shaders)
- Key files: `editor/MarkdownEditor.vue`, `tree/TreeCanvas.vue`, `tree/scene/SceneManager.ts` (1030 lines — largest component file)

**`frontend/src/composables/`:**
- Purpose: Vue composables encapsulating feature logic with reactive state
- Contains: Each file exports a `use*()` function returning reactive refs and async methods
- Key files: `useQuiz.ts`, `useReview.ts`, `useStats.ts`, `useAppInit.ts`, `useTreeSkeleton.ts`, `useKnobDispatch.ts`

**`frontend/src/views/`:**
- Purpose: Top-level page/shell components
- Contains: `MainLayout.vue` — the sole view component (600 lines) providing the CSS Grid layout, dynamic content switching, and compact/mobile layout logic

**`frontend/src/constants/`:**
- Purpose: Application-wide constants and configuration values
- Contains: `app.ts` (breakpoints, cache TTL, storage keys), `theme.ts` (tree style parameters for each theme preset), `uiStrings.ts` (all Chinese UI text strings)
- Key files: `theme.ts` (defines `THEME_PRESETS` object driving the 3D tree visual style)

**`frontend/src/types/`:**
- Purpose: TypeScript type definitions shared across the frontend
- Contains: `node.ts` (NodeRecord, NodeContext, DataAdapter interface, ViewState), `tree.ts` (SkeletonData, Branch, CrownOutline for tree visualization), `auth.ts` (AuthUser, AuthAdapter)

**`frontend/src/utils/`:**
- Purpose: Pure utility functions with no Vue dependency
- Contains: `api.ts` (fetch wrapper with JWT auth), `treeUtils.ts` (tree data manipulation: buildTree, collectDescendantIds, normalizeSiblingOrder)

**`frontend/src/services/`:**
- Purpose: Non-Vue services with module-level state
- Contains: `nodeCache.ts` (in-memory TTL cache for NodeContext)

**`frontend/src/vendor/`:**
- Purpose: Vendored third-party code
- Contains: `proctree.ts` — legacy procedural tree algorithm (no longer actively used, replaced by ez-tree + server-generated skeletons)

**`backend/`:**
- Purpose: FastAPI REST API server, all business logic, database management
- Contains: `main.py` (all endpoints), service modules (`*_service_sqlite.py`), auth, database layer, tree generation engine, tests
- Structure: Flat module layout — all `.py` files at top level, tests in `tests/` subdirectory

**`deploy/`:**
- Purpose: Production deployment configuration and scripts
- Contains: Nginx config (reverse proxy + static file serving), systemd service file, shell scripts for setup and update

**`.github/`:**
- Purpose: CI/CD pipeline configuration
- Contains: GitHub Actions workflow definitions and helper scripts

## Key File Locations

**Entry Points:**
- `frontend/src/main.ts`: Vue application bootstrap — creates Vue app, Pinia, loads adapters, mounts
- `frontend/index.html`: Vite HTML entry point
- `backend/main.py`: FastAPI application — all endpoints, CORS, startup init
- `frontend/src/router.ts`: Vue Router with `/` and `/node/:id` routes

**Configuration:**
- `frontend/src/config.ts`: Runtime config from VITE env vars (`VITE_DATA_MODE`, `VITE_BACKEND_URL`)
- `frontend/vite.config.ts`: Vite build config (PWA plugin, dev server proxy, aliases)
- `frontend/tsconfig.json`: TypeScript project configuration
- `frontend/package.json`: npm dependencies and scripts (`dev`, `build`, `preview`)
- `backend/requirements.txt`: Python dependencies (fastapi, uvicorn, PyJWT, bcrypt, httpx, python-dotenv)
- `.env`: Frontend env vars (VITE_DATA_MODE, VITE_BACKEND_URL) — gitignored
- `docker-compose.yml`: Multi-service Docker Compose config

**Core Logic:**
- `frontend/src/stores/nodeStore.ts`: Central orchestrator — ViewState machine, all tree CRUD, routing sync
- `frontend/src/stores/authStore.ts`: Auth session management
- `frontend/src/views/MainLayout.vue`: UI shell with dynamic content switching
- `frontend/src/composables/useAppInit.ts`: Application boot sequence
- `frontend/src/composables/useKnobDispatch.ts`: Knob interaction dispatch logic
- `frontend/src/types/node.ts`: Core type contracts (DataAdapter interface, ViewState, NodeContext)
- `backend/main.py`: All API endpoints and request/response models
- `backend/database.py`: Schema definition, migrations, connection management
- `backend/tree_skeleton.py`: Space Colonization algorithm (v2 tree generation)

**3D Tree Visualization Pipeline:**
- `frontend/src/components/tree/TreeCanvas.vue`: Host component for Three.js scene
- `frontend/src/components/tree/scene/SceneManager.ts`: Three.js scene lifecycle (1030 lines)
- `frontend/src/components/tree/scene/UserDataMapper.ts`: Maps user data to ez-tree parameters
- `frontend/src/components/tree/scene/ThemeTransition.ts`: Smooth theme color interpolation
- `frontend/src/components/tree/scene/BackgroundRenderer.ts`: SDF raymarching background
- `frontend/src/components/tree/scene/BloomManager.ts`: Post-processing bloom effect
- `frontend/src/components/tree/scene/DebugGUI.ts`: Dev-only debug overlay
- `frontend/src/components/tree/scene/ProctreeGeometry.ts`: Legacy procedural tree geometry (unused)
- `frontend/src/components/tree/shaders/*.ts`: GLSL shader source strings
- `frontend/src/constants/theme.ts`: `THEME_PRESETS` — color/style parameters per theme
- `frontend/src/types/tree.ts`: Shared types for skeleton data
- `frontend/src/composables/useTreeSkeleton.ts`: Skeleton data fetching and caching
- `frontend/src/assets/textures/`: Leaf texture PNG files (3 variants)

**Testing:**
- `frontend/src/stores/authStore.spec.ts`: Auth store unit tests (Vitest)
- `frontend/src/stores/nodeStore.spec.ts`: Node store unit tests (Vitest)
- `backend/tests/test_nodes_api.py`: API integration tests (pytest + httpx)
- `backend/test_tree_generator.py`: Tree generator integration test
- `backend/test_tree_generator_unit.py`: Tree generator unit tests
- `backend/test_tree_skeleton_unit.py`: Tree skeleton unit tests
- `backend/test_minimal.py`: Minimal backend smoke test

**Deployment:**
- `deploy/nginx.conf`: Nginx config routing
- `deploy/acacia.service`: systemd unit file
- `deploy/setup.sh`: VPS first-time setup
- `deploy/deploy.sh`: Update/deploy script
- `backend/DockerFile`: Backend Docker image
- `docker-compose.yml`: Full-stack Docker Compose

## Naming Conventions

**Files:**
- Vue components: `PascalCase.vue` — e.g., `MainLayout.vue`, `MarkdownEditor.vue`, `AiGeneratePopup.vue`
- TypeScript modules (non-components): `camelCase.ts` — e.g., `nodeStore.ts`, `backendAdapter.ts`, `nodeCache.ts`, `treeUtils.ts`
- Type definition files: `camelCase.ts` — e.g., `node.ts`, `tree.ts`, `auth.ts`
- Backend Python files: `snake_case.py` — e.g., `quiz_service_sqlite.py`, `tree_repository_sqlite.py`, `ai_generate_service_sqlite.py`
- Test files: `*.spec.ts` (frontend, Vitest), `test_*.py` (backend, pytest) — e.g., `nodeStore.spec.ts`, `test_nodes_api.py`
- Shader files: `camelCase.ts` — e.g., `backgroundRaymarch.ts`, `sdfPrimitives.ts`

**Directories:**
- Frontend component domains: lowercase — `auth/`, `editor/`, `layout/`, `tree/`, `quiz/`, `review/`, `stats/`, `ai/`, `ui/`
- Frontend infrastructure: lowercase — `adapters/`, `composables/`, `services/`, `stores/`, `types/`, `utils/`, `constants/`
- Nested component support: `tree/scene/`, `tree/shaders/`, `editor/extensions/`

**Interfaces:**
- TypeScript interfaces: `PascalCase` — `NodeRecord`, `NodeContext`, `DataAdapter`, `TreeNode`, `SkeletonData`, `Branch`
- Python classes: `PascalCase` — `CanvasSize`, `AiGenerateRequest`, `QuizAnswerRequest`

**Functions:**
- TypeScript functions: `camelCase` — `loadNode()`, `fetchTreeSkeleton()`, `getNodeContext()`, `apiFetch()`
- Python functions: `snake_case` — `get_current_user()`, `_build_path()`, `_node_to_dict()`, `hash_password()`
- Private helpers prefixed with `_`: `_soft_delete_subtree()`, `_is_descendant()`, `_build_path()`

**Store naming:**
- Store definition: `use{Name}Store` — `useNodeStore`, `useAuthStore`, `useStyleStore`
- Store instance: `{name}Store` — `nodeStore`, `authStore`, `styleStore`

**Composable naming:**
- Export function: `use{CamelCase}` — `useQuiz()`, `useReview()`, `useStats()`, `useAppInit()`, `useTreeSkeleton()`

**Constants:**
- UPPER_SNAKE_CASE for constant values: `ViewStates`, `COMPACT_BREAKPOINT`, `LOCAL_NODES_KEY`, `NODE_CACHE_TTL_MS`

## Where to Add New Code

**New Feature (e.g., "Tags" or "Search"):**
- Frontend component: `frontend/src/components/{feature}/` — create a new domain directory
- Composable (stateful logic): `frontend/src/composables/use{Feature}.ts`
- Store (if global state needed): `frontend/src/stores/{feature}Store.ts`
- Types: `frontend/src/types/{feature}.ts` (or add to existing type files if related)
- Backend service: `backend/{feature}_service_sqlite.py`
- Backend endpoint: Add to `backend/main.py` or extract to `backend/routers/{feature}.py` (recommended)
- Backend tests: `backend/tests/test_{feature}_api.py`
- UI strings: Add to `frontend/src/constants/uiStrings.ts`
- Tests: `frontend/src/stores/{feature}Store.spec.ts`

**New Component/Module:**
- Vue SFC component: `frontend/src/components/{domain}/{ComponentName}.vue`
- TypeScript module (non-Vue): `frontend/src/{appropriate-dir}/{moduleName}.ts`
- Util function: `frontend/src/utils/{utilName}.ts`
- Service: `frontend/src/services/{serviceName}.ts`

**New API Endpoint:**
- Currently: Add route handler to `backend/main.py` following existing patterns
- Recommended: Create `backend/routers/{domain}.py`, use FastAPI `APIRouter`, include in `main.py`
- Request/response models: Define Pydantic `BaseModel` subclasses near the endpoint or in a `backend/schemas/` directory
- Database changes: Update `backend/database.py` `init_db()` with new table creation and migration logic

**New Page/View:**
- Add to `ViewState` type in `frontend/src/types/node.ts:3`
- Add new state constant to `ViewStates` object
- Add `start{Feature}()` method to `nodeStore` in `frontend/src/stores/nodeStore.ts`
- Add state boolean computed (e.g., `is{Feature}State`)
- Add component mapping in `MainLayout.vue` `nonTreeContent` computed
- Add content key handling in `contentKey` computed

**New Adapter Implementation:**
- Create `frontend/src/adapters/{name}Adapter.ts` implementing `DataAdapter` interface
- Create `frontend/src/adapters/{name}Auth.ts` implementing `AuthAdapter` interface
- Add case to `loadAdapters()` in `frontend/src/adapters/index.ts`
- Add env var to `frontend/src/config.ts`

**New Theme:**
- Add enum value to `ThemeStyle` in `frontend/src/stores/styleStore.ts:5`
- Add theme preset entry in `THEME_PRESETS` in `frontend/src/constants/theme.ts`
- Add CSS class handling in `styleStore.applyTheme()`
- Add theme transition target in `ThemeTransition` if custom colors needed
- Optionally add domain rule in `backend/style_service_sqlite.py` `STYLE_RULES`

**Utilities:**
- Shared helpers: `frontend/src/utils/` if pure functions, `frontend/src/services/` if stateful
- Tree-specific utilities: `frontend/src/utils/treeUtils.ts`
- API utilities: `frontend/src/utils/api.ts`

**Tests:**
- Component tests: co-locate as `{ComponentName}.spec.ts` in the same directory
- Store tests: `frontend/src/stores/{storeName}.spec.ts`
- Util tests: `frontend/src/utils/{utilName}.spec.ts`
- Backend API tests: `backend/tests/test_{feature}_api.py`
- Backend unit tests: `backend/test_{module}_unit.py` or `backend/test_{module}.py`

## Special Directories

**`frontend/dist/`:**
- Purpose: Vite production build output — bundled JS, CSS, HTML, and assets
- Generated: Yes (by `npm run build`)
- Committed: No (gitignored; generated fresh per deployment)

**`frontend/node_modules/`:**
- Purpose: npm package dependencies
- Generated: Yes (by `npm install`)
- Committed: No (gitignored)

**`frontend/src/vendor/`:**
- Purpose: Vendored third-party code that cannot be npm-installed
- Generated: No
- Committed: Yes (contains `proctree.ts` — legacy procedural tree algorithm)
- Note: Currently only contains legacy code that has been superseded by `@dgreenheck/ez-tree`

**`backend/__pycache__/` and `backend/.pytest_cache/`:**
- Purpose: Python bytecode cache and pytest cache
- Generated: Yes (by Python interpreter and pytest)
- Committed: No (gitignored)

**`acacia.db`:**
- Purpose: SQLite database file (development data)
- Generated: Yes (by backend on first startup)
- Committed: No (gitignored; contains user data)

**`.planning/codebase/`:**
- Purpose: GSD codebase analysis documents for planner/executor consumption
- Generated: Yes (by `/gsd-map-codebase` command)
- Committed: Yes (used by subsequent GSD commands)

**`frontend/src/assets/textures/`:**
- Purpose: Leaf texture images for 3D tree rendering (PNG files)
- Generated: No (static assets)
- Committed: Yes

---

*Structure analysis: 2026-04-27*
