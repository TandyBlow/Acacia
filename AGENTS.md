# Repository Guidelines

## Project Structure & Module Organization
This workspace is split into two parts:
- `frontend/`: Vue 3 + TypeScript + Vite client app. Main code lives in `frontend/src/` (`components/`, `views/`, `stores/`, `assets/`).
- `backend/`: FastAPI service scaffold with Docker packaging (`requirements.txt`, `DockerFile`). The container expects an ASGI entrypoint `main:app`.

Keep feature code near its domain (for example, UI in `src/components/*`, state in `src/stores/*`). Do not commit generated content such as `frontend/node_modules/` or local build outputs.

## Build, Test, and Development Commands
Run commands from the module directory unless noted.

- Frontend setup: `cd frontend && npm install`
- Frontend dev server: `npm run dev` (Vite hot reload)
- Frontend production build: `npm run build` (type-check + bundle)
- Frontend preview build: `npm run preview`
- Backend setup: `cd backend && pip install -r requirements.txt`
- Backend local run: `uvicorn main:app --reload --host 0.0.0.0 --port 7860`
- Backend container build (from repo root): `docker build -t seewhat-backend -f backend/DockerFile backend`

## Coding Style & Naming Conventions
- Use 2-space indentation in Vue/TS/CSS files, matching current frontend code.
- Vue SFCs use `<script setup>` where possible.
- Component filenames: `PascalCase.vue` (for example, `ConfirmPanel.vue`).
- Store and utility files: `camelCase` (for example, `nodeStore.js`).
- Python files/functions: `snake_case`.
- Keep style consistent within each file; avoid mixed formatting in a single change.

## Testing Guidelines
There is currently no committed automated test suite in either module. Minimum expectation for contributions:
- Frontend: run `npm run build` before opening a PR.
- Backend: start the API locally with `uvicorn` and verify changed endpoints manually.

When adding non-trivial logic, add tests alongside the change (`frontend/src/**/*.spec.ts` or `backend/tests/test_*.py`) and document how to run them.

## Commit & Pull Request Guidelines
`backend/` Git history uses short, imperative commit subjects (for example, `Add init files`). Follow that style:
- One clear action per commit subject.
- Keep subject concise and specific.

PRs should include:
- What changed and why.
- Modules touched (`frontend`, `backend`, or both).
- Verification evidence (commands run, screenshots for UI changes).
- Related issue/task link if available.

## Security & Configuration Tips
Never commit secrets (Supabase keys, tokens, `.env` files). Keep credentials in local environment variables and provide sanitized examples in documentation when needed.

## Working style

When the user gives a task, follow this workflow strictly.

Stage 1: Requirement clarification

Do not start coding immediately.

Ask clarification questions about:
- goal of the feature
- environment
- constraints
- expected input and output
- edge cases

Prefer multiple choice questions when possible.

Continue asking questions until the requirements are fully specified.

If information is missing, ask more questions.

Never assume requirements.


Stage 2: Design

After requirements are clear:

Write a short implementation plan including

- architecture
- main modules
- file structure
- algorithms or data structures used

Ask the user for confirmation before writing code.


Stage 3: Implementation

After the user confirms the design:

Write code step by step.

Explain what files are created or modified.

Do not generate unnecessary files.


Stage 4: Validation

After implementation:

Explain how to run the code.

Explain how to test the feature.

If tests fail, fix the code.


## Communication rules

Always ask questions when requirements are unclear.

Use concise language.

Prefer structured answers.

Wait for user confirmation before large changes.
