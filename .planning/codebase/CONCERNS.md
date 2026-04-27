# Codebase Concerns

**Analysis Date:** 2026-04-27

## Tech Debt

### Large Monolithic Files with Extensive Commented-Out Code
- Issue: `frontend/src/components/tree/scene/SceneManager.ts` (1030 lines) contains ~260 lines of commented-out ground and particle system code, plus commented-out proctree imports. This bloats the file, makes navigation difficult, and introduces merge-conflict risk.
- Files: `frontend/src/components/tree/scene/SceneManager.ts`
- Impact: Reduced readability, harder to maintain, risk of dead code activation by accident.
- Fix approach: Remove all commented-out ground/particle code (lines 556-676). If needed, restore from git history.

### Unused Vendor Library
- Issue: `frontend/src/vendor/proctree.ts` is a full TypeScript port of the proctree.js library. All imports in `SceneManager.ts` are commented out. The `ProctreeGeometry.ts` helper is also unused. These files exist but serve no purpose.
- Files: `frontend/src/vendor/proctree.ts`, `frontend/src/components/tree/scene/ProctreeGeometry.ts`
- Impact: Dead code in the repo, increases build time and confusion.
- Fix approach: Remove both files and the commented-out proctree import block in `SceneManager.ts`. The project now uses `@dgreenheck/ez-tree` instead.

### Debug Logging Left in Production Code
- Issue: Multiple `console.warn()` calls with verbose JSON serialization remain in auth and logout flows. These were clearly added for debugging and not removed.
- Files:
  - `frontend/src/stores/authStore.ts:99` - `console.warn('[authStore] initialize() result:', JSON.stringify(currentUser))`
  - `frontend/src/stores/authStore.ts:101` - `console.warn('[authStore] after assignUser...')`
  - `frontend/src/stores/authStore.ts:107` - `console.warn('[authStore] onAuthStateChange:...')`
  - `frontend/src/stores/authStore.ts:109` - `console.warn('[authStore] after onAuthStateChange...')`
  - `frontend/src/composables/useLogoutFlow.ts:14` - `console.warn('[useLogoutFlow] startLogout...')`
  - `frontend/src/components/tree/scene/UserDataMapper.ts:254` - `console.log(...)` call
  - `frontend/src/components/tree/TreeCanvas.vue:68` - `console.log('Clicked branch, node_id:', nodeId)`
- Impact: Verbose console output in production, potential exposure of user state in browser logs.
- Fix approach: Remove all `console.log`/`console.warn` calls in auth and logout paths, or gate behind a debug flag/vite env var.

### Broken/Dead Test Files
- Issue: Several backend test files are broken or contain dead code:
  - `backend/tests/test_nodes_api.py` imports `_nodes` from `main`, but `main.py` does not export `_nodes` — this test will fail to import and cannot run.
  - `backend/test_tree_generator.py` imports `generate_tree_visualization` from `tree_generator`, but no `tree_generator.py` file exists — import error.
  - `backend/test_minimal.py` is not a test file; it is a standalone FastAPI app with `/` and `/health` routes — dead code.
- Files: `backend/tests/test_nodes_api.py`, `backend/test_tree_generator.py`, `backend/test_minimal.py`
- Impact: CI would fail if these tests were actually run. False confidence in test coverage.
- Fix approach: Either fix `test_nodes_api.py` to use the real SQLite-backed API (with test fixtures), or remove it. Remove `test_tree_generator.py` and `test_minimal.py` if no longer needed.

### Quiz Service Silent Error Passing
- Issue: JSON decode errors in `quiz_service_sqlite.py` use bare `pass` statements, silently swallowing malformed data from the database.
- Files: `backend/quiz_service_sqlite.py`
  - Line 275: `except (json.JSONDecodeError, TypeError): pass` (in `generate_quiz_question_sqlite`)
  - Line 367: `except (json.JSONDecodeError, TypeError): pass` (in `get_questions_by_node_sqlite`)
  - Line 402: `except (json.JSONDecodeError, TypeError): pass` (in `get_wrong_questions_sqlite`)
  - Line 430: `except (json.JSONDecodeError, TypeError): pass` (in `get_single_question_sqlite`)
- Impact: If `options` column contains non-JSON data (corruption, migration artifact), the API returns raw strings instead of parsed options. Frontend may crash on rendering.
- Fix approach: Log a warning or return a fallback (e.g., `["数据损坏"]`) instead of silently passing corrupted data through to the client.

### External Dependency Not Tracked
- Issue: `deploy_to_hf.py` imports `huggingface_hub` (`from huggingface_hub import HfApi, create_repo, upload_folder`), but this package is not listed in `backend/requirements.txt`. It only works if manually installed.
- Files: `backend/deploy_to_hf.py`, `backend/requirements.txt`
- Impact: Deployment script fails with `ModuleNotFoundError` on a fresh environment.
- Fix approach: Add `huggingface-hub` to `requirements.txt` or document it as a prerequisite in the deploy script header.

## Known Bugs

### Backend Test Suite Cannot Run
- Symptoms: `backend/tests/test_nodes_api.py` fails at module import because it references `from main import _nodes` which does not exist in `main.py`. The test file appears to be from an older version of the API that used an in-memory `_nodes` dict rather than SQLite.
- Files: `backend/tests/test_nodes_api.py`
- Trigger: Running `pytest backend/tests/` from the repo root.
- Workaround: The two unit test files (`test_tree_skeleton_unit.py`, `test_tree_generator_unit.py`) run independently. There are no working backend integration tests.

## Security Considerations

### Hardcoded Default JWT Secret
- Risk: `backend/auth.py` line 10 uses `os.getenv("JWT_SECRET", "dev-secret-change-in-production")`. If the environment variable is not set in production, the hardcoded fallback is used, allowing anyone to forge valid JWT tokens.
- Files: `backend/auth.py:10`
- Current mitigation: None. The deploy script (`deploy/setup.sh`) presumably sets this env var, but there is no startup check.
- Recommendations: Remove the default value entirely. Raise a configuration error on startup if `JWT_SECRET` is not set, forcing explicit configuration.

### CORS Allows All Origins
- Risk: `backend/main.py` line 40 sets `allow_origins=["*"]` with `allow_credentials` not explicitly set. Combined with `Authorization` header being accepted, this means any website can make authenticated requests to the API from a user's browser if the backend is accessible.
- Files: `backend/main.py:38-43`
- Current mitigation: The frontend uses `VITE_BACKEND_URL` to point to the backend, and self-hosted deployments typically use Nginx reverse proxy on the same domain. But if the backend port (7860) is exposed publicly, CSRF-like attacks are possible.
- Recommendations: Set `allow_origins` to the specific frontend origin(s) in production, or at minimum restrict to same-origin via an env var.

### No Password Strength Enforcement
- Risk: `backend/main.py` line 94 only checks that username and password are non-empty (`if not payload.username.strip() or not payload.password`). No minimum length, no complexity requirements.
- Files: `backend/main.py:82-110`
- Current mitigation: The frontend `authStore` requires passwords to be non-empty. No server-side validation.
- Recommendations: Enforce minimum password length (e.g., 8 characters) on the backend. Consider adding length limits to prevent abuse (extremely long passwords can cause bcrypt performance issues).

### SQLite PRAGMA synchronous=NORMAL
- Risk: `backend/database.py` line 123 sets `PRAGMA synchronous=NORMAL`. In WAL mode with `synchronous=NORMAL`, the database may be corrupted if the system crashes or loses power at the wrong moment, because WAL checkpoints are not fully synced to disk.
- Files: `backend/database.py:123`
- Impact: Potential data loss on VPS crash/power failure.
- Recommendations: For a single-VPS deployment with low write volume, `synchronous=FULL` is recommended for safety. The performance difference is negligible for this scale.

### Sensitive Data in Browser localStorage
- Risk: The JWT token is stored in `localStorage` (`frontend/src/utils/api.ts` line 6: `const TOKEN_KEY = 'acacia_backend_token'`). localStorage is accessible to any JavaScript running on the same domain, making it vulnerable to XSS attacks. Also, `authStore` stores the username in localStorage (line 58: `acacia_uname_${next.id}`).
- Files: `frontend/src/utils/api.ts:3-4`, `frontend/src/stores/authStore.ts:58`
- Current mitigation: None.
- Recommendations: Consider using httpOnly cookies for the JWT token instead of localStorage. If localStorage must be used, ensure Content Security Policy headers are set via Nginx.

### `.env` Files Present
- Risk: `.env` files exist in both `frontend/` and `backend/` directories (`.env`, `.env.example`, `.env.production`, `.env.backend.example`). If the frontend `.env` file is accidentally committed with production credentials, secrets would leak.
- Files: `frontend/.env`, `frontend/.env.production`, `backend/.env`, `backend/.env.example`, `frontend/.env.example`, `frontend/.env.backend.example`
- Current mitigation: Not confirmed whether `.env` is in `.gitignore`.
- Recommendations: Verify `.env` (but not `.env.example`) is listed in `.gitignore`. The frontend `.env` file should never contain secrets since Vite embeds them at build time.

## Performance Bottlenecks

### Depth Calculation Per Node (O(n^2) worst case)
- Issue: `backend/tree_repository_sqlite.py` calculates depth for every node by recursively walking parent chains, with a depth cache that is reset per-node. The `calc_depth()` function uses `next((n for n in nodes if n["id"] == nid), None)` which is an O(n) linear scan. For a tree with N nodes, this becomes O(N * D * N) = O(N^2 * D) in the worst case.
- Files: `backend/tree_repository_sqlite.py:27-40`
- Cause: The linear scan `next(...)` inside a recursive function called for every node.
- Improvement path: Pre-build a `dict` mapping node_id to node before the loop, then use direct lookup: `node_map = {n["id"]: n for n in nodes}`.

### Client-Side Retryvability Calculation for Every Node on Every Stats Load
- Issue: `backend/quiz_service_sqlite.py` function `get_quiz_stats_sqlite()` calls `_calculate_retrievability()` for every node on every request. Each call parses a datetime string and computes a floating-point exponential. For large trees (1000+ nodes), this becomes noticeable.
- Files: `backend/quiz_service_sqlite.py:474-514`
- Cause: Dynamic R(t) calculated per-request for all nodes.
- Improvement path: Consider caching retrievability in the `nodes` table and updating it periodically (e.g., on review submission) rather than computing on every read.

### SceneManager Rebuilds Entire Scene on Resize
- Issue: `SceneManager.ts` disposes and rebuilds the entire Three.js scene, including recreating all meshes and shader materials, when `rebuildScene()` is called. On resize, it also recomputes the tree bounding box from all geometry.
- Files: `frontend/src/components/tree/scene/SceneManager.ts:218-222`, `914-952`
- Cause: Full dispose+rebuild is the simplest approach but regenerates all geometry.
- Improvement path: For simple parameter changes, update uniforms in-place rather than rebuilding the entire tree. Reserve full rebuild for structural changes (tree data changed).

## Fragile Areas

### SceneManager.ts (1030 lines)
- Files: `frontend/src/components/tree/scene/SceneManager.ts`
- Why fragile: Monolithic class managing Three.js scene lifecycle, animation loop, theme transitions, resize handling, background rendering, camera fitting, WebGL context loss recovery, and debug GUI integration. Any change risks breaking the visual pipeline.
- Safe modification: Changes to `applyStyleParams()` (color/uniform updates) are safe. Changes to `buildTreeMeshes()`, `disposeScene()`, or `animate()` require careful testing with real data.
- Test coverage: No automated tests. Visual-only verification.

### Node Edit State Machine (nodeStore.ts)
- Files: `frontend/src/stores/nodeStore.ts`
- Why fragile: The `confirmOperation()` function handles ADD, DELETE, and MOVE in a single method with shared transient state variables. `canConfirm` is a computed with complex branching logic. View state transitions (`viewState.value = ViewStates.DISPLAY`) are scattered across load/persist/cancel paths.
- Safe modification: Adding a new state requires touching at minimum: `ViewState` type, `ViewStates` const, `isXState` computed, `clearTransientState()`, `cancelOperation()`, `confirmOperation()`, and relevant UI components.
- Test coverage: 3 unit tests in `nodeStore.spec.ts`. No tests for: race conditions (rapid state toggling), error recovery after failed confirm, edge cases during MOVE with descendant blocking.

### AI Generation Pipeline (3 chained services)
- Files: `backend/ai_generate_service_sqlite.py`, `backend/quiz_service_sqlite.py`, `frontend/src/composables/useAiGenerate.ts`
- Why fragile: The AI generation depends on `SILICONFLOW_API_KEY` being set (env var), the LLM returning valid JSON (fallback regex extraction), and the generated node names not conflicting with existing nodes (renamed to "XXX（补充）" on conflict). Any change to the prompt format or LLM output structure breaks parsing.
- Safe modification: The JSON extraction regex in `extract_json()` (line 85) and `parse_llm_json()` (line 61) is the most brittle part. Test with actual LLM responses before changing.
- Test coverage: None for any AI generation code.

### Frontend Adapter Switching at Build Time
- Files: `frontend/src/adapters/index.ts`, `frontend/src/config.ts`
- Why fragile: The adapter (backend vs local) is selected at build time via `VITE_DATA_MODE` env var. The `localAdapter` is a full localStorage implementation with its own tree manipulation logic (seed data, CRUD, tree building). Any change to the `DataAdapter` interface or node behavior must be duplicated across both adapters.
- Safe modification: Always test changes with both `VITE_DATA_MODE=local` and `VITE_DATA_MODE=backend`.
- Test coverage: Only `nodeStore.spec.ts` with a mock adapter. No tests for `localAdapter` or `backendAdapter` directly.

## Scaling Limits

### SQLite Single-File Database
- Current capacity: Suitable for single-user or small-team usage (tens of thousands of nodes). SQLite with WAL mode handles concurrent reads well but only one writer at a time.
- Limit: Write contention under concurrent quiz answer submissions or rapid node creation from multiple users. `database.py` creates a new connection per context manager, which means connection setup overhead per request.
- Scaling path: For multi-user scale, migrate to PostgreSQL. The `DataAdapter` abstraction in the frontend already supports swapping data sources. The backend `*_sqlite.py` naming convention suggests planned DB-agnostic service separation.

### No Request Rate Limiting
- Current capacity: No rate limiting on any endpoint. The AI generation endpoints (`/ai-generate-nodes`, `/generate-question/*`, `/analyze-node/*`) make external LLM API calls with costs.
- Limit: A malicious client could exhaust LLM API quota by repeatedly calling AI endpoints, or overload the server with rapid-fire requests.
- Scaling path: Add rate limiting middleware (e.g., slowapi with FastAPI) with stricter limits on AI endpoints.

### In-Memory Tree Data for Generation
- Issue: `tree_repository_sqlite.py` loads all non-deleted nodes into memory, and `tree_skeleton.py` allocates data structures proportional to node count. For very large trees (10,000+ nodes), memory usage could become significant.
- Files: `backend/tree_repository_sqlite.py:8-12`, `backend/tree_skeleton.py`
- Current capacity: Tested with small-to-medium trees (likely under 500 nodes).
- Limit: Memory pressure for large knowledge bases.
- Scaling path: Add pagination or incremental generation for the skeleton endpoint.

## Dependencies at Risk

### @dgreenheck/ez-tree (^1.1.0)
- Risk: This is a niche Three.js tree generation library with a single maintainer. If it becomes unmaintained or has breaking API changes, the entire 3D tree visualization breaks. The SceneManager heavily customizes ez-tree internals via `applyOverrides()` and `deepMergeOptions()`.
- Files: `frontend/src/components/tree/scene/SceneManager.ts`, `frontend/src/components/tree/scene/UserDataMapper.ts`
- Impact: The TreeCanvas component, which is the primary visual feature, would need replacement.
- Migration plan: The `vendor/proctree.ts` exists as a fallback but is outdated. Consider forking ez-tree or extracting the relevant tree generation code internally.

### Pillow + NumPy in Backend
- Risk: `Pillow` and `numpy` are listed in `requirements.txt` but only used by `backend/renderer.py` for PNG rendering, which appears to be from the old lsystem pipeline. The current skeleton endpoint returns JSON (not PNG), so these may be unused.
- Files: `backend/requirements.txt`, `backend/renderer.py`
- Impact: Larger Docker image, potential CVEs in unused image processing libraries.
- Migration plan: Verify if `renderer.py` is still used. If not, remove `Pillow` and `numpy` from `requirements.txt` and remove `renderer.py`.

## Missing Critical Features

### No Automated CI/CD Pipeline
- Problem: There is no CI configuration (no `.github/workflows/`, `.gitlab-ci.yml`, etc.). Tests are not run automatically on push/PR.
- Blocks: Automated quality gates, preventing regressions, ensuring tests pass before deploy.

### No Database Backup Mechanism
- Problem: The SQLite database (`acacia.db`) is a single file without any backup automation. The deploy scripts (`deploy/setup.sh`, `deploy/deploy.sh`) do not include backup steps.
- Blocks: Disaster recovery. If the VPS disk fails or the database file is corrupted, all user data is lost.

### No Input Size Limits on Backend
- Problem: The `ContentUpdateRequest.content` field and `AiGenerateRequest.input` field accept arbitrarily large strings. FastAPI by default has no request body size limit.
- Blocks: Protection against resource exhaustion attacks (sending multi-GB request bodies).

## Test Coverage Gaps

### No Frontend Component Tests
- What's not tested: All Vue components (19 `.vue` files) including `MarkdownEditor.vue`, `TreeCanvas.vue`, `QuizPanel.vue`, `AuthPanel.vue`, etc.
- Files: All `frontend/src/components/**/*.vue`
- Risk: Visual regressions, broken user interactions, broken TipTap editor integration.
- Priority: High for `MarkdownEditor.vue` (most complex component with TipTap integration).

### No Backend Integration Tests
- What's not tested: The entire REST API surface. The only test file (`test_nodes_api.py`) is broken and would test an older in-memory API that no longer exists.
- Files: `backend/main.py` (all endpoints), `backend/tests/test_nodes_api.py` (broken)
- Risk: API regressions are undetected until manual testing or production deploy.
- Priority: High. At minimum, test auth endpoints (register/login/me) and basic CRUD (create node, get context, update content).

### No AI Service Tests
- What's not tested: LLM integration in `ai_generate_service_sqlite.py` and `quiz_service_sqlite.py`. JSON parsing, error handling, and edge cases (empty LLM response, malformed JSON, missing keys).
- Files: `backend/ai_generate_service_sqlite.py`, `backend/quiz_service_sqlite.py`
- Risk: Changes to prompt templates or parsing logic break the AI features silently.
- Priority: Medium. Mock the LLM call and test the parsing logic.

### No Review/FSRS Algorithm Tests
- What's not tested: The FSRS spaced repetition logic in `review_service_sqlite.py` (stability updates, difficulty clamping, retrievability calculation, state machine transitions).
- Files: `backend/review_service_sqlite.py`
- Risk: Bugs in the scheduling algorithm could cause incorrect review intervals, degrading the learning experience.
- Priority: Medium. Unit tests for the pure math functions (`_calculate_retrievability`, `_update_fsrs_params`) are straightforward to write.

### No LocalAdapter Tests
- What's not tested: The localStorage-based `localAdapter` which has its own complete tree manipulation logic including seed data initialization, CRUD, path building, and tree building.
- Files: `frontend/src/adapters/localAdapter.ts`
- Risk: Bugs in local mode go undetected until manual testing.
- Priority: Low (local mode is not the primary deployment path).

---

*Concerns audit: 2026-04-27*
