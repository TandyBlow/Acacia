# Testing Patterns

**Analysis Date:** 2026-04-27

## Test Framework

**Frontend Runner:**
- Vitest 4.x (`vitest: "^4.1.4"`)
- Config: No dedicated `vitest.config.ts` — uses Vite's inline configuration (resolved automatically by vitest from `vite.config.ts`)
- Environment: `happy-dom` (`happy-dom: "^20.8.9"`) for DOM simulation
- Vue test utils: `@vue/test-utils: "^2.4.6"` for component mounting

**Backend Runner:**
- pytest (installed separately, not in `requirements.txt`)
- `pytest-asyncio` for async test support
- `httpx` with `ASGITransport` for FastAPI integration testing

**Run Commands:**
```bash
cd frontend && npm test              # Run all Vitest tests
cd frontend && npx vitest run        # Equivalent — single run
cd backend && pytest tests/          # Run all backend tests
cd backend && pytest test_tree_skeleton_unit.py -v   # Run with verbose output
```

## Test File Organization

**Location:**
- Frontend: Co-located with source files — `*.spec.ts` next to the implementation
  - `frontend/src/stores/nodeStore.spec.ts` alongside `frontend/src/stores/nodeStore.ts`
  - `frontend/src/stores/authStore.spec.ts` alongside `frontend/src/stores/authStore.ts`
- Backend: Dedicated `tests/` directory for API tests, root-level for unit tests
  - `backend/tests/test_nodes_api.py`
  - `backend/test_tree_generator_unit.py`
  - `backend/test_tree_skeleton_unit.py`
  - `backend/test_minimal.py`

**Naming:**
- Frontend: `*.spec.ts` (Vitest convention)
- Backend: `test_*.py` (pytest convention)

**Current Coverage:**
Only two frontend store files and three backend modules are tested:
- `frontend/src/stores/nodeStore.spec.ts` (111 lines, 3 test cases)
- `frontend/src/stores/authStore.spec.ts` (92 lines, 5 test cases across 2 describe blocks)
- `backend/tests/test_nodes_api.py` (60 lines, 3 async API tests)
- `backend/test_tree_generator_unit.py` (195 lines, 5 test classes)
- `backend/test_tree_skeleton_unit.py` (365 lines, 9 test classes with 35+ tests)
- `backend/test_minimal.py` (15 lines, minimal health check)

## Test Structure

**Frontend Suite Organization (Vitest):**
```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Mock adapter defined at module level, BEFORE the dynamic import
const mockAdapter: CoreDataAdapter = {
  getNodeContext: vi.fn<(nodeId: string | null) => Promise<NodeContext>>(),
  createNode: vi.fn<(parentId: string | null, name: string) => Promise<NodeRecord>>(),
  // ... all methods mocked
};

// Module mocks set up before store import
vi.mock('../services/nodeCache', () => ({
  getCached: () => null,
  setCache: () => {},
  invalidate: () => {},
  invalidateAll: () => {},
}));

// Dynamic import AFTER mocks are configured
import { useNodeStore, setDataAdapter } from './nodeStore';

describe('useNodeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());   // Fresh Pinia per test
    setDataAdapter(mockAdapter);      // Inject mock adapter
    vi.clearAllMocks();               // Reset mock call history
  });

  it('loads node context and resets to display mode', async () => {
    const store = useNodeStore();
    // ... arrange, act, assert
  });
});
```

**Backend Suite Organization (pytest):**
```python
import pytest
from httpx import ASGITransport, AsyncClient
from main import app

@pytest.fixture(autouse=True)
def clear_nodes_store():
    nodes_store.clear()
    yield
    nodes_store.clear()

@pytest.mark.asyncio
async def test_post_node_creates_node_and_get_returns_it():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # arrange, act, assert within the async context
```

**Backend Unit Test Classes:**
```python
class TestLSystemRules:
    """Test L-system rule generation"""

    def test_leaf_node_rule(self):
        """Leaf nodes (child_count=0) should not branch"""
        rule = generate_lsystem_rule(0)
        assert rule == "F"
```

**Patterns:**
- Setup: `beforeEach` with `setActivePinia(createPinia())` and mock injection
- Teardown: Implicit via fresh Pinia per test (no explicit teardown needed)
- Assertion: `expect(...).toBe(...)`, `expect(...).toEqual(...)`, `expect(...).toHaveBeenCalledWith(...)`, `await expect(...).resolves.toBe(...)`
- Python: `assert` statements with optional descriptive messages

## Mocking

**Framework:** Vitest built-in mocking (`vi.fn()`, `vi.mock()`, `vi.hoisted()`)

**Store Tests — Adapter Mock Pattern:**
```typescript
const mockAdapter: CoreDataAdapter = {
  getNodeContext: vi.fn<(nodeId: string | null) => Promise<NodeContext>>(),
  createNode: vi.fn<(parentId: string | null, name: string) => Promise<NodeRecord>>(),
  updateNodeContent: vi.fn<(nodeId: string, content: string) => Promise<void>>(),
  deleteNode: vi.fn<(nodeId: string, deleteChildren: boolean) => Promise<void>>(),
  moveNode: vi.fn<(nodeId: string, newParentId: string | null) => Promise<void>>(),
  getTree: vi.fn<() => Promise<TreeNode[]>>(),
  clearCache: vi.fn(),
};
```

**Module Mock Pattern:**
```typescript
vi.mock('../services/nodeCache', () => ({
  getCached: () => null,
  setCache: () => {},
  invalidate: () => {},
  invalidateAll: () => {},
}));
```

**Hoisted Mock Pattern (for imports that execute at import time):**
```typescript
const mockAdapter = vi.hoisted(() => ({
  initialize: vi.fn(),
  onAuthStateChange: vi.fn(() => () => {}),
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
```

**Per-test Response Setup:**
```typescript
mockAdapter.getNodeContext!.mockResolvedValueOnce(rootContext);
mockAdapter.createNode!.mockResolvedValueOnce(createdNode);
```

**What to Mock:**
- The entire `CoreDataAdapter` / `AuthAdapter` interface (external dependency for stores)
- The `nodeCache` service module
- Any external API or side-effect modules

**What NOT to Mock:**
- Pinia itself (real `createPinia()` and `setActivePinia()`)
- Vue reactivity (`ref`, `computed` — tested via their observable behavior)
- `treeUtils` functions (tested transitively through store behavior)

**Backend Mocking:**
```python
from unittest.mock import Mock, patch, MagicMock
```
Available in test imports but minimal usage — backend tests predominantly use real implementations with test fixtures.

## Fixtures and Factories

**Test Data (Frontend):**
Inline object literals within each test case:
```typescript
const rootContext: NodeContext = {
  nodeInfo: null,
  pathNodes: [],
  children: [{ id: 'c1', name: 'Child', content: '', parentId: null, sortOrder: 0 }],
};
```

**Test Data (Backend):**
Fixture factory functions for generating test trees:
```python
def _make_tree(n_roots=3, depth=2, children_per_node=2, mastery=0.5):
    """Generate a test tree with specified structure."""
    nodes = []
    # ... build tree
    return nodes

SAMPLE_TREE = _make_tree(3, 2, 2, 0.5)
```

**Location:**
- Frontend fixtures live inline within the test file or `describe` block
- Backend fixtures live as module-level functions and constants in test files
- No dedicated `__fixtures__` or `factories` directories exist

## Coverage

**Requirements:** No coverage threshold enforced. No coverage configuration in `vite.config.ts` or `vitest.config.*`.

**Current Gaps:**
- No component tests (no `.vue` files have corresponding `.spec.ts` files)
- No composable tests (`useQuiz`, `useReview`, `useKnobDispatch`, etc.)
- No adapter tests (`backendAdapter`, `localAdapter`, `backendAuth`, `localAuth`)
- No utility tests (`treeUtils`, `api`)
- Backend service layer untested directly (`quiz_service_sqlite`, `review_service_sqlite`, `ai_generate_service_sqlite`)
- Backend auth module untested (`auth.py`)

## Test Types

**Unit Tests (Frontend):**
- Scope: Pinia store logic — state transitions, mock adapter interactions, validation rules
- Files: `nodeStore.spec.ts`, `authStore.spec.ts`
- Approach: Inject mock adapters, call store methods, assert state changes and mock call history

**Integration Tests (Backend):**
- Scope: FastAPI endpoint-to-response lifecycle via `httpx.AsyncClient` with `ASGITransport`
- Files: `tests/test_nodes_api.py`
- Approach: Create node via POST, verify with GET, delete and verify 404 — full CRUD cycle

**Unit Tests (Backend):**
- Scope: Pure functions for tree generation, L-system, space colonization, superellipse math
- Files: `test_tree_generator_unit.py`, `test_tree_skeleton_unit.py`
- Approach: Class-based organization, focused on algorithm correctness, edge cases

**E2E Tests:**
- Not used. No Playwright, Cypress, or Selenium configuration present.

## Common Patterns

**Async Testing (Frontend):**
```typescript
it('loads node context and resets to display mode', async () => {
  const store = useNodeStore();
  mockAdapter.getNodeContext!.mockResolvedValueOnce(rootContext);

  await store.loadNode(null);

  expect(mockAdapter.getNodeContext).toHaveBeenCalledWith(null);
  expect(store.viewState).toBe('display');
});
```

**Async Assertion with resolves:**
```typescript
await expect(store.submitByKnob()).resolves.toBe(true);
```

**Error Testing (Frontend):**
Error paths are implicitly tested through state assertions (no dedicated error-throwing test cases exist yet).

**Backend CRUD Cycle Testing:**
```python
@pytest.mark.asyncio
async def test_delete_node_by_id_removes_node_and_returns_404_afterward():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create
        create_response = await client.post("/nodes", json={"name": "To Delete"})
        node_id = create_response.json()["id"]
        # Delete
        delete_response = await client.delete(f"/nodes/{node_id}")
        assert delete_response.status_code == 204
        # Verify gone
        get_after_delete = await client.get(f"/nodes/{node_id}")
        assert get_after_delete.status_code == 404
```

**Determinism Testing (Backend):**
```python
class TestDeterminism:
    def test_same_input_same_output(self):
        r1 = generate_tree_skeleton(SAMPLE_TREE)
        r2 = generate_tree_skeleton(SAMPLE_TREE)
        assert r1["branches"] == r2["branches"]
```

---

*Testing analysis: 2026-04-27*
