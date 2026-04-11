"""
Auto Issue Generator for SeeWhat project.
Scans frontend and backend for unimplemented areas and creates
GitHub Issues assigned to Copilot.
"""

import os
import json
import subprocess
from pathlib import Path

REPO = os.environ["GH_REPO"]

# ── helpers ──────────────────────────────────────────────────────────────────

def gh(args: list[str], input_text: str | None = None) -> str:
    result = subprocess.run(
        ["gh"] + args,
        capture_output=True, text=True,
        input=input_text,
        env={**os.environ},
    )
    return result.stdout.strip()


def existing_issue_titles() -> set[str]:
    out = gh(["issue", "list", "--repo", REPO,
              "--state", "open", "--limit", "100",
              "--json", "title"])
    if not out:
        return set()
    return {i["title"] for i in json.loads(out)}


def create_issue(title: str, body: str, labels: list[str]) -> None:
    existing = existing_issue_titles()
    if title in existing:
        print(f"  [skip] already exists: {title}")
        return

    label_args = []
    for lb in labels:
        label_args += ["--label", lb]

    gh(["issue", "create",
        "--repo", REPO,
        "--title", title,
        "--body", body,
        "--assignee", "copilot",
        ] + label_args)
    print(f"  [created] {title}")


def ensure_labels() -> None:
    """Create labels if they don't exist yet."""
    needed = {
        "copilot": ("0075ca", "Task for Copilot Coding Agent"),
        "frontend": ("e4e669", "Frontend (Vue3)"),
        "backend":  ("f29513", "Backend (FastAPI)"),
        "test":     ("d93f0b", "Testing"),
        "bug":      ("ee0701", "Something isn't working"),
    }
    existing_raw = gh(["label", "list", "--repo", REPO,
                        "--limit", "100", "--json", "name"])
    existing = {lb["name"] for lb in json.loads(existing_raw or "[]")}
    for name, (color, desc) in needed.items():
        if name not in existing:
            gh(["label", "create", name,
                "--repo", REPO,
                "--color", color,
                "--description", desc])


# ── scanners ─────────────────────────────────────────────────────────────────

def scan_empty_vue_components() -> list[dict]:
    """Find Vue components whose <template> block is empty or missing."""
    issues = []
    # Scan all Vue source directories, explicitly excluding node_modules
    scan_roots = [
        Path("frontend/src/components"),
        Path("frontend/src/views"),
    ]

    vue_files = []
    for root in scan_roots:
        if root.exists():
            vue_files += sorted(root.rglob("*.vue"))

    for vue_file in vue_files:
        text = vue_file.read_text(encoding="utf-8")
        # Empty template: <template></template> or no template at all
        if "<template>" not in text or "<template></template>" in text or \
                text.count("<template>") == 1 and len(text.split("<template>")[1].split("</template>")[0].strip()) < 20:
            rel = vue_file.relative_to("frontend/src")
            issues.append({
                "title": f"[Frontend] Implement component: {vue_file.name}",
                "body": f"""## Task
Implement the `{vue_file.name}` component located at `frontend/src/{rel}`.

## Context
The component currently has an empty or near-empty template.  
Refer to the project design document and `GUIDELINES.md` for the expected behaviour and visual style.

## Acceptance Criteria
- [ ] Template renders the correct UI described in the design doc
- [ ] Component emits / receives props as expected by its parent
- [ ] Follows 2-space indentation and `<script setup>` convention
- [ ] `npm run build` passes without errors

## Notes
Use Tailwind CSS utility classes for layout. Glass-morphism styles live in `src/assets/styles/glass.css`.
""",
                "labels": ["copilot", "frontend"],
            })
    return issues


def scan_empty_backend_endpoints() -> list[dict]:
    """Find FastAPI route functions whose body is only `pass` or a TODO."""
    issues = []
    root = Path("backend/app/api")
    if not root.exists():
        return issues

    for py_file in sorted(root.rglob("*.py")):
        text = py_file.read_text(encoding="utf-8")
        lines = text.splitlines()
        for i, line in enumerate(lines):
            stripped = line.strip()
            # Detect route decorators
            if stripped.startswith("@router.") or stripped.startswith("@app."):
                # Look at the next non-blank lines for function body
                body_lines = []
                for j in range(i + 1, min(i + 10, len(lines))):
                    bl = lines[j].strip()
                    if bl:
                        body_lines.append(bl)
                    if len(body_lines) >= 3:
                        break
                body_text = " ".join(body_lines)
                if any(kw in body_text for kw in ("pass", "TODO", "raise NotImplementedError", "...")):
                    rel = py_file.relative_to("backend")
                    # Try to grab the endpoint path from the decorator
                    endpoint_path = stripped.split("(")[1].split(")")[0].split(",")[0].strip('"\'') \
                        if "(" in stripped else "unknown"
                    issues.append({
                        "title": f"[Backend] Implement endpoint: {endpoint_path} in {py_file.name}",
                        "body": f"""## Task
Implement the unfinished FastAPI endpoint in `backend/{rel}`.

**Decorator line:** `{stripped}`

## Context
The endpoint body currently contains only a placeholder (`pass` / `TODO` / `...`).  
Refer to `backend/app/schemas/pydantic_models.py` for request/response schemas and  
`backend/app/services/` for the service layer.

## Acceptance Criteria
- [ ] Endpoint returns the correct response schema
- [ ] Calls the appropriate service function (do not put business logic in the route)
- [ ] Handles errors with proper HTTP status codes
- [ ] Backend starts without errors: `uvicorn main:app --reload`

## Notes
Supabase client is initialised in `backend/app/core/config.py`.  
Auth dependency is in `backend/app/api/deps.py`.
""",
                        "labels": ["copilot", "backend"],
                    })
    return issues


def scan_empty_services() -> list[dict]:
    """Find service files in frontend/src/services that are empty or stub-only."""
    issues = []
    root = Path("frontend/src/services")
    if not root.exists():
        return issues

    for js_file in sorted(root.rglob("*.js")) + sorted(root.rglob("*.ts")):
        text = js_file.read_text(encoding="utf-8")
        if len(text.strip()) < 50 or "TODO" in text or text.strip() in ("", "export {}"):
            rel = js_file.relative_to("frontend/src")
            issues.append({
                "title": f"[Frontend] Implement service: {js_file.name}",
                "body": f"""## Task
Implement the service file `frontend/src/{rel}`.

## Context
The file is currently empty or contains only a stub.  
Services should encapsulate API calls to Supabase RPC functions.  
Refer to `frontend/src/api/supabase.js` for the Supabase client and `frontend/src/api/rpc.js` for existing RPC wrappers.

## Acceptance Criteria
- [ ] All functions exported match what's imported in components/stores
- [ ] Uses TanStack Query patterns consistent with `frontend/src/api/queryClient.js`
- [ ] `npm run build` passes without errors
""",
                "labels": ["copilot", "frontend"],
            })
    return issues
    """Suggest adding tests for components/endpoints that have none."""
    issues = []

    # Frontend: check if any spec files exist at all
    fe_specs = list(Path("frontend/src").rglob("*.spec.ts"))
    if not fe_specs:
        issues.append({
            "title": "[Test] Add frontend unit tests for core composables",
            "body": """## Task
The project currently has no frontend automated tests.  
Add Vitest unit tests for the core composables and store logic.

## Suggested starting points
- `src/composables/useNodeActions.js` — node CRUD operations
- `src/composables/useKnobGesture.js` — long-press detection logic
- `src/stores/nodeStore.js` — state mutations

## Acceptance Criteria
- [ ] At least 3 test files created under `frontend/src/**/*.spec.ts`
- [ ] Tests run with `npm run test` (add the script to `package.json` if missing)
- [ ] All tests pass

## Setup hint
```bash
npm install -D vitest @vue/test-utils happy-dom
```
Add to `vite.config.ts`:
```ts
test: { environment: 'happy-dom' }
```
""",
            "labels": ["copilot", "frontend", "test"],
        })

    # Backend: check if any test files exist
    be_tests = list(Path("backend/tests").rglob("test_*.py")) if Path("backend/tests").exists() else []
    if not be_tests:
        issues.append({
            "title": "[Test] Add backend API tests for node endpoints",
            "body": """## Task
The project currently has no backend automated tests.  
Add pytest tests for the FastAPI node endpoints.

## Suggested starting points
- `POST /nodes` — create node
- `GET /nodes/{id}` — fetch node with path
- `DELETE /nodes/{id}` — delete with cascade option

## Acceptance Criteria
- [ ] Test files created under `backend/tests/test_*.py`
- [ ] Tests runnable with `pytest` from the `backend/` directory
- [ ] Uses `httpx.AsyncClient` with FastAPI's test client
- [ ] All tests pass

## Setup hint
```bash
pip install pytest pytest-asyncio httpx
```
""",
            "labels": ["copilot", "backend", "test"],
        })

    return issues


def scan_pwa_setup() -> list[dict]:
    """Check if PWA manifest and service worker are configured."""
    issues = []
    manifest = Path("frontend/public/manifest.json")
    sw = Path("frontend/public/sw.js")

    if not manifest.exists():
        issues.append({
            "title": "[Frontend] Add PWA manifest.json",
            "body": """## Task
Create `frontend/public/manifest.json` for PWA support.

## Acceptance Criteria
- [ ] `manifest.json` includes `name`, `short_name`, `start_url`, `display`, `background_color`, `theme_color`, and at least one icon entry
- [ ] `vite.config.ts` references the manifest via `vite-plugin-pwa`
- [ ] `npm run build` passes

## Reference
The project uses `vite-plugin-pwa`. See its docs: https://vite-pwa-org.netlify.app/
""",
            "labels": ["copilot", "frontend"],
        })

    if not sw.exists():
        issues.append({
            "title": "[Frontend] Add service worker (sw.js) for offline support",
            "body": """## Task
Add a minimal service worker at `frontend/public/sw.js` so the app works offline.

## Acceptance Criteria
- [ ] Service worker caches the app shell on install
- [ ] Serves cached assets when offline
- [ ] Registered via `vite-plugin-pwa` in `vite.config.ts`
""",
            "labels": ["copilot", "frontend"],
        })

    return issues


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    print("Ensuring labels exist...")
    ensure_labels()

    all_issues: list[dict] = []
    all_issues += scan_empty_vue_components()
    all_issues += scan_empty_services()
    all_issues += scan_empty_backend_endpoints()
    all_issues += scan_missing_tests()
    all_issues += scan_pwa_setup()

    if not all_issues:
        print("Nothing to create — project looks complete!")
        return

    print(f"\nCreating {len(all_issues)} issue(s)...")
    for issue in all_issues:
        create_issue(issue["title"], issue["body"], issue["labels"])

    print("\nDone.")


if __name__ == "__main__":
    main()
