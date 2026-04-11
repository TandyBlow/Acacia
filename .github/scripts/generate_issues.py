"""
Auto Issue Generator for SeeWhat project.
"""

import os
import json
import subprocess
from pathlib import Path

REPO = os.environ["GH_REPO"]
DESIGN_DOC = os.environ.get("DESIGN_DOC", "")

def gh(args, input_text=None):
    result = subprocess.run(
        ["gh"] + args,
        capture_output=True, text=True,
        input=input_text,
        env={**os.environ},
    )
    return result.stdout.strip()

def existing_issue_titles():
    out = gh(["issue", "list", "--repo", REPO, "--state", "open", "--limit", "100", "--json", "title"])
    if not out:
        return set()
    return {i["title"] for i in json.loads(out)}

def create_issue(title, body, labels):
    existing = existing_issue_titles()
    if title in existing:
        print(f"  [skip] already exists: {title}")
        return
    label_args = []
    for lb in labels:
        label_args += ["--label", lb]
    if DESIGN_DOC:
        body += f"\n\n---\n## Project Design Document (for context)\n\n{DESIGN_DOC}"
    result = subprocess.run(
        ["gh", "issue", "create", "--repo", REPO, "--title", title, "--body", body] + label_args,
        capture_output=True, text=True, env={**os.environ},
    )
    output = result.stdout.strip()
    print(f"  [created] {title} -> {output}")

    # Assign Copilot separately via issue edit
    if output:
        issue_number = output.rstrip("/").split("/")[-1]
        assign_result = subprocess.run(
            ["gh", "issue", "edit", issue_number, "--repo", REPO, "--add-assignee", "Copilot"],
            capture_output=True, text=True, env={**os.environ},
        )
        if assign_result.returncode == 0:
            print(f"  [assigned] Copilot -> #{issue_number}")
        else:
            print(f"  [assign failed] {assign_result.stderr.strip()}")

def ensure_labels():
    needed = {
        "copilot":  ("0075ca", "Task for Copilot Coding Agent"),
        "frontend": ("e4e669", "Frontend (Vue3)"),
        "backend":  ("f29513", "Backend (FastAPI)"),
        "test":     ("d93f0b", "Testing"),
        "bug":      ("ee0701", "Something isn't working"),
    }
    existing_raw = gh(["label", "list", "--repo", REPO, "--limit", "100", "--json", "name"])
    existing = {lb["name"] for lb in json.loads(existing_raw or "[]")}
    for name, (color, desc) in needed.items():
        if name not in existing:
            gh(["label", "create", name, "--repo", REPO, "--color", color, "--description", desc])

def scan_empty_vue_components():
    issues = []
    scan_roots = [Path("frontend/src/components"), Path("frontend/src/views")]
    vue_files = []
    for root in scan_roots:
        if root.exists():
            vue_files += sorted(root.rglob("*.vue"))
    for vue_file in vue_files:
        text = vue_file.read_text(encoding="utf-8")
        has_template = "<template>" in text
        template_empty = "<template></template>" in text
        template_thin = has_template and len(text.split("<template>")[1].split("</template>")[0].strip()) < 20
        if not has_template or template_empty or template_thin:
            rel = vue_file.relative_to("frontend/src")
            issues.append({
                "title": f"[Frontend] Implement component: {vue_file.name}",
                "body": f"## Task\nImplement `frontend/src/{rel}`.\n\nThe component has an empty or near-empty template. Refer to the design doc for expected behaviour.\n\n## Acceptance Criteria\n- [ ] Template renders correct UI\n- [ ] Props/emits match parent expectations\n- [ ] `npm run build` passes\n",
                "labels": ["copilot", "frontend"],
            })
    return issues

def scan_empty_services():
    issues = []
    root = Path("frontend/src/services")
    if not root.exists():
        return issues
    all_files = sorted(root.rglob("*.js")) + sorted(root.rglob("*.ts"))
    for svc_file in all_files:
        text = svc_file.read_text(encoding="utf-8")
        if len(text.strip()) < 50 or "TODO" in text or text.strip() in ("", "export {}"):
            rel = svc_file.relative_to("frontend/src")
            issues.append({
                "title": f"[Frontend] Implement service: {svc_file.name}",
                "body": f"## Task\nImplement `frontend/src/{rel}`.\n\nThis service file is empty or stub-only. It should wrap Supabase RPC calls.\n\n## Acceptance Criteria\n- [ ] Exported functions match imports in components/stores\n- [ ] Uses TanStack Query patterns\n- [ ] `npm run build` passes\n",
                "labels": ["copilot", "frontend"],
            })
    return issues

def scan_empty_backend_endpoints():
    issues = []
    root = Path("backend/app/api")
    if not root.exists():
        return issues
    for py_file in sorted(root.rglob("*.py")):
        text = py_file.read_text(encoding="utf-8")
        lines = text.splitlines()
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped.startswith("@router.") or stripped.startswith("@app."):
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
                    endpoint_path = stripped.split("(")[1].split(")")[0].split(",")[0].strip("\"'") if "(" in stripped else "unknown"
                    issues.append({
                        "title": f"[Backend] Implement endpoint: {endpoint_path} in {py_file.name}",
                        "body": f"## Task\nImplement the unfinished FastAPI endpoint in `backend/{rel}`.\n\n**Decorator:** `{stripped}`\n\nBody is currently a placeholder. Use schemas in `pydantic_models.py` and service layer in `services/`.\n\n## Acceptance Criteria\n- [ ] Returns correct response schema\n- [ ] Proper HTTP error handling\n- [ ] `uvicorn main:app --reload` starts without errors\n",
                        "labels": ["copilot", "backend"],
                    })
    return issues

def scan_missing_tests():
    issues = []
    fe_specs = list(Path("frontend/src").rglob("*.spec.ts"))
    if not fe_specs:
        issues.append({
            "title": "[Test] Add frontend unit tests for core composables",
            "body": "## Task\nAdd Vitest unit tests for core composables and stores.\n\n## Suggested starting points\n- `src/composables/useNodeActions.js`\n- `src/composables/useKnobGesture.js`\n- `src/stores/nodeStore.js`\n\n## Acceptance Criteria\n- [ ] At least 3 test files under `frontend/src/**/*.spec.ts`\n- [ ] `npm run test` passes\n\n## Setup\n```bash\nnpm install -D vitest @vue/test-utils happy-dom\n```\n",
            "labels": ["copilot", "frontend", "test"],
        })
    be_tests = list(Path("backend/tests").rglob("test_*.py")) if Path("backend/tests").exists() else []
    if not be_tests:
        issues.append({
            "title": "[Test] Add backend API tests for node endpoints",
            "body": "## Task\nAdd pytest tests for FastAPI node endpoints.\n\n## Suggested starting points\n- `POST /nodes`\n- `GET /nodes/{id}`\n- `DELETE /nodes/{id}`\n\n## Acceptance Criteria\n- [ ] Test files under `backend/tests/test_*.py`\n- [ ] `pytest` passes from `backend/`\n\n## Setup\n```bash\npip install pytest pytest-asyncio httpx\n```\n",
            "labels": ["copilot", "backend", "test"],
        })
    return issues

def scan_pwa_setup():
    issues = []
    if not Path("frontend/public/manifest.json").exists():
        issues.append({
            "title": "[Frontend] Add PWA manifest.json",
            "body": "## Task\nCreate `frontend/public/manifest.json` for PWA support.\n\n## Acceptance Criteria\n- [ ] Includes `name`, `short_name`, `start_url`, `display`, `background_color`, `theme_color`, icons\n- [ ] Referenced by `vite-plugin-pwa` in `vite.config.ts`\n- [ ] `npm run build` passes\n",
            "labels": ["copilot", "frontend"],
        })
    if not Path("frontend/public/sw.js").exists():
        issues.append({
            "title": "[Frontend] Add service worker (sw.js) for offline support",
            "body": "## Task\nAdd a minimal service worker at `frontend/public/sw.js`.\n\n## Acceptance Criteria\n- [ ] Caches app shell on install\n- [ ] Serves cached assets offline\n- [ ] Registered via `vite-plugin-pwa`\n",
            "labels": ["copilot", "frontend"],
        })
    return issues

def main():
    print("Ensuring labels exist...")
    ensure_labels()

    all_issues = []
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
