# Coding Conventions

**Analysis Date:** 2026-04-27

## Naming Patterns

**Files:**
- Vue SFC components: `PascalCase.vue` — `MarkdownEditor.vue`, `AuthPanel.vue`, `Breadcrumbs.vue`, `QuizPanel.vue`, `MainLayout.vue`
- TypeScript stores: `camelCase.ts` — `nodeStore.ts`, `authStore.ts`, `styleStore.ts`
- TypeScript composables: `useCamelCase.ts` — `useKnobDispatch.ts`, `useAppInit.ts`, `useQuiz.ts`, `useReview.ts`, `useLogoutFlow.ts`, `useKnobHints.ts`, `useTreeSkeleton.ts`, `useAiGenerate.ts`, `useStats.ts`
- TypeScript type definitions: `camelCase.ts` — `node.ts`, `auth.ts`, `tree.ts`
- TypeScript services: `camelCase.ts` — `nodeCache.ts`
- TypeScript adapters: `camelCase.ts` — `backendAdapter.ts`, `localAdapter.ts`, `backendAuth.ts`, `localAuth.ts`
- TypeScript utilities: `camelCase.ts` — `treeUtils.ts`, `api.ts`
- TypeScript constants: `camelCase.ts` — `uiStrings.ts`, `app.ts`, `theme.ts`
- TypeScript config/bootstrap: `camelCase.ts` — `config.ts`, `main.ts`, `router.ts`
- Python files: `snake_case.py` — `quiz_service_sqlite.py`, `tree_repository_sqlite.py`, `test_nodes_api.py`

**Functions:**
- TypeScript functions: `camelCase` — `formatError`, `loadNode`, `startAdd`, `setDataAdapter`, `getCurrentUser`, `enqueueSave`, `clearAutoSaveTimer`, `collectDescendantIds`
- Vue composables: `useCamelCase` — `useQuiz`, `useReview`, `useLogoutFlow`, `useKnobDispatch`, `useAppInit`
- Pinia store exports: `useCamelCaseStore` — `useNodeStore`, `useAuthStore`, `useStyleStore`
- Python functions: `snake_case` — `get_current_user`, `hash_password`, `generate_lsystem_rule`, `generate_tree_skeleton`, `_compute_tree_stats`

**Variables:**
- TypeScript variables: `camelCase` — `viewState`, `activeNode`, `dataAdapter`, `isBusy`, `errorMessage`
- Boolean state variables: `isCamelCase` / `hasCamelCase` — `isBusy`, `isAuthenticated`, `isEditState`, `isConfirmState`, `isLoggingOut`, `isCompactLayout`
- Ref reactivity: same camelCase patterns — `const viewState = ref<ViewState>(ViewStates.DISPLAY)`
- Reactive module-level variables: `camelCase` — `let dataAdapter`, `let authAdapter`, `let navigator`
- Python variables: `snake_case` — `owner_id`, `node_id`, `tree_data`, `canvas_w`, `canvas_h`

**Types and Interfaces:**
- TypeScript interfaces: `PascalCase` — `NodeRecord`, `NodeContext`, `TreeNode`, `AuthUser`, `AuthResult`, `AuthAdapter`, `CoreDataAdapter`, `DataAdapter`, `TreeDataAdapter`, `StyleResult`, `QuizQuestion`, `DueReviewItem`, `ReviewResult`, `ReviewStats`, `SkeletonData`
- TypeScript type aliases: `PascalCase` — `ViewState`, `ThemeStyle`, `CompactMode`, `AuthMode`
- TypeScript literal unions over string constants: exported with a companion `as const` object — `ViewState` (type) and `ViewStates` (const)

**Constants:**
- TypeScript constant objects: `SCREAMING_SNAKE_CASE` or `PascalCase` — `ViewStates`, `UI`, `KNOB_HOLD_MS`, `NODE_CACHE_TTL_MS`, `AUTO_SAVE_DELAY_MS`, `COMPACT_BREAKPOINT`
- Python constants: `UPPER_CASE` — `TREE_GEN_VERSION`
- Magic numbers extracted to `frontend/src/constants/app.ts`

## Code Style

**Formatting:**
- No project-level `.prettierrc` or `eslint.config.*` — formatting is unenforced by tooling
- 2-space indentation used consistently across `.vue`, `.ts`, and `.css`
- Single quotes for strings
- Semicolons used at end of statements
- Trailing commas in multi-line objects/arrays/parameters
- Vue `<style scoped>` with CSS custom properties for theming (`var(--color-primary)`, `var(--color-glass-border)`)

**TypeScript Strictness (from `frontend/tsconfig.app.json`):**
```json
"strict": true,
"noUnusedLocals": true,
"noUnusedParameters": true,
"erasableSyntaxOnly": true,
"noFallthroughCasesInSwitch": true,
"noUncheckedSideEffectImports": true
```

**Vue SFC Conventions:**
- Use `<script setup lang="ts">` exclusively — no Options API
- SFC section order: `<template>`, `<script setup lang="ts">`, `<style scoped>`
- All styles are scoped
- CSS custom properties for color theming, no hardcoded colors in component styles
- Deep selector `:deep()` for styling child component internals

**Python Style:**
- Follows PEP 8 generally (4-space indentation, snake_case)
- Module-level docstrings on test files, sparse on production files
- Type hints on function signatures but not exhaustive
- `import os` / `from fastapi import FastAPI` grouping: stdlib, third-party, local

## Import Organization

**Order (observed in TypeScript files):**
1. Framework imports — `vue`, `pinia`, `vue-router`
2. Third-party library imports — `@tiptap/*`, `naive-ui`, `three`, `dompurify`
3. Internal relative imports from other directories — `../../stores/nodeStore`, `../types/node`
4. Internal relative imports from same directory — `./extensions/codeBlockWithUi`
5. Side-effect style imports last — `import 'highlight.js/styles/github.css'`

**Path Aliases:**
- No path aliases configured (no `@/` in `tsconfig.json`)
- All internal imports use relative paths

**Dynamic Imports:**
- Adapter loading in `frontend/src/adapters/index.ts` uses `import('./backendAdapter')` for code splitting
- This pattern isolates adapter-specific code from the main bundle

**Python Import Order:**
1. Standard library — `os`, `math`, `uuid`, `io`
2. Third-party — `fastapi`, `pydantic`, `httpx`, `pytest`
3. Local modules — `from database import get_db_ctx`, `from lsystem import generate_lsystem_skeleton`

## Error Handling

**Store Pattern (frontend):**
The canonical pattern for async operations in Pinia stores and composables uses a busy flag, error ref, and try/catch/finally:

```typescript
// In nodeStore.ts, useQuiz.ts, useReview.ts, etc.
isBusy.value = true;
errorMessage.value = null;
try {
  // operation
} catch (error) {
  errorMessage.value = formatError(error);
} finally {
  isBusy.value = false;
}
```

**Error Formatting:**
- A `formatError(error: unknown): string` utility per module extracts messages from Error instances
- Falls back to user-facing Chinese strings from `UI.errors.*` in `frontend/src/constants/uiStrings.ts`
- `authStore.ts` has its own `formatAuthError` variant

**Error Throwing:**
- `throw new Error(UI.errors.siblingNameConflict)` — user-facing error messages via the constant object
- `throw new Error('Data adapter not initialized')` — hardcoded English for developer-facing errors
- Adapters throw on validation failures (duplicate name, missing parent, empty name)

**Silent Catch:**
- Used for non-critical operations: `} catch { /* ignore */ }` or `} catch { return null; }`
- Examples: localStorage operations, optional AI feature failures, answer recording

**Backend Error Handling:**
- FastAPI `HTTPException` with status codes for API errors
- Specific exception types: `ValueError` for validation, generic `Exception` for unexpected errors
- Pattern: `try/except ValueError as e: raise HTTPException(422, detail=str(e))`

**Non-null Assertion:**
- `!` used sparingly where the adapter is guaranteed initialized: `dataAdapter!.getNodeContext(nodeId)`
- `getDataAdapter()` throws if not initialized, providing a runtime guard

## Logging

**Framework:** Direct `console` methods — no structured logging library

**Patterns:**
- `console.warn` with bracketed prefixes for debug tracing: `[authStore]`, `[useLogoutFlow]`
- `console.error` for operational failures: shader compilation, skeleton load failures
- `console.log` for interactive debug output (branch click in `TreeCanvas.vue`)
- Debug `console.warn` statements remain in production code in `authStore.ts` and `useLogoutFlow.ts` (likely leftover from a debugging session)

**Backend:** No explicit logging framework — relies on uvicorn's default log output

## Comments

**When to Comment:**
- Module-level docstrings in Python test files: `"""Unit tests for tree_skeleton.py"""`
- Class-level docstrings in Python test classes: `"""Test L-system rule generation"""`
- JSDoc for deprecated APIs: `/** @deprecated Use adapter.clearCache() via the injected adapter instead. */`
- Minimal inline comments in production code — naming conventions and function structure serve as primary documentation

**JSDoc/TSDoc:**
- Only used for `@deprecated` annotations
- No JSDoc on function signatures in production code

**Python Docstrings:**
- Present on test modules and test classes
- Sparse in production service files
- `main.py` endpoint functions have no docstrings — route paths and parameter names are self-documenting

## Function Design

**Size:** Small to medium (5-40 lines typical). Store methods are larger orchestration functions (20-60 lines). Vue component `<script setup>` blocks can be 100-300 lines for complex components (`MarkdownEditor.vue`, `TreeCanvas.vue`).

**Parameters:**
- Nullable parameters use `string | null` rather than optional with `undefined`
- Options objects for configuration: `loadNode(nodeId, { replace?: boolean })`
- Destructured where multiple values needed: `const { isAuthenticated } = storeToRefs(authStore)`

**Return Values:**
- Async operations return `Promise<void>` for side effects, `Promise<boolean>` for success/failure
- Data fetching returns entity type or `null` on error: `Promise<QuizQuestion | null>`
- Store methods return promises for async, void for sync

**Function Declaration Style:**
- Named function declarations within composables/stores: `function loadNode(...)` rather than `const loadNode = (...) =>`
- Arrow functions for inline callbacks and computed conditions
- No function overloading

**Pinia Store Pattern:**
All stores use the Composition API (setup function) pattern:
```typescript
export const useNodeStore = defineStore('node', () => {
  // reactive state with ref()
  // computed properties
  // plain functions for actions
  return { /* all state, getters, actions */ };
});
```

## Module Design

**Exports:** Named exports exclusively throughout the codebase. No default exports except:
- Vue components (implicitly via SFC)
- The router instance in `frontend/src/router.ts`

**Barrel Files:**
- No barrel/index re-export files within most directories
- `frontend/src/adapters/index.ts` is the solo exception — exports `loadAdapters()` for dynamic adapter selection
- Each file exports its own public API directly

**Cross-Module Dependencies:**
- Stores reference each other via their `use*Store()` functions (not direct imports)
- Composables import stores and other composables as needed
- Type definitions in `frontend/src/types/` are the shared contract between adapters, stores, and composables
- `frontend/src/constants/` provides shared constants and UI strings

**Dependency Injection Pattern:**
- Adapters are injected into stores via module-level setter functions: `setDataAdapter()`, `setAuthAdapter()`, `setNavigator()`
- This enables swapping between `backendAdapter` and `localAdapter` without changing store code
- The injection happens in `frontend/src/main.ts` during bootstrap

## TypeScript Usage

**Strict Mode:** Enabled with all recommended linting flags.

**Constants with `as const`:**
```typescript
export const ViewStates = {
  DISPLAY: 'display',
  ADD: 'add',
  // ...
} as const;
```

**Generics:** Used for typed API responses:
```typescript
export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T>
```

**Optional Chaining:** Used for nullable adapter and DOM access: `authAdapter?.signOut()`, `navigator?.(path, replace)`, `nodeInfo?.id`

**Intersection Types:** For adapter composition: `export type DataAdapter = CoreDataAdapter & Partial<TreeDataAdapter>`

## Python Conventions (Backend)

**Naming:** `snake_case` universally for files, functions, variables, and URL path parameters.

**Type Hints:** Present on function signatures but not exhaustive:
```python
def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
def _generate_skeleton(tree_data, canvas_w=512, canvas_h=512):
```

**Error Handling:** 
- `HTTPException` with appropriate status codes (`401`, `404`, `422`, `500`)
- `ValueError` caught for business logic errors and re-thrown as `HTTPException`
- Generic `Exception` catch as last resort with `500` status

**Dependency Injection:** FastAPI's `Depends()` for auth: `user: dict = Depends(get_current_user)`

**Database:** Context manager pattern: `with get_db_ctx() as conn:`

---

*Convention analysis: 2026-04-27*
