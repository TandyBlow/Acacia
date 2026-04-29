# Roadmap: Acacia

## Overview

Acacia evolves from a hierarchical note-taking app into an AI-enhanced knowledge management platform through four phases. Phase 1 completes the SDF visual background -- a self-contained differentiator with four themes and smooth transitions -- unblocking all subsequent work. Phase 2 builds the keystone AI tree generation pipeline, enabling users to input scattered text and receive structured knowledge trees. Phase 3 transforms the quiz system into a behavioral engagement loop with scientifically accurate spaced repetition (FSRS), daily streak tracking, and positive reinforcement. Phase 4 wraps everything into a frictionless 5-minute onboarding flow with mastery visualization, delivering the promised "zero-to-first-quiz" experience.

In parallel, the CEO Plan (SCOPE EXPANSION) adds 6 non-tree optimization phases to harden infrastructure, fix bugs, polish UI, and improve deployment.

## Phases

- [ ] **Phase 1: SDF Background Completion** - Four themed background scenes with smooth transitions and GPU-safe rendering
- [ ] **Phase 2: AI Knowledge Tree Generation** - Async AI pipeline that generates structured knowledge trees from unstructured text
- [ ] **Phase 3: Quiz Feedback Loop** - Daily personalized quizzes with FSRS scheduling, streaks, and celebration feedback
- [ ] **Phase 4: Integration & Onboarding** - 5-minute guided onboarding from first input to first quiz with mastery visualization

## Phase Details

### Phase 1: SDF Background Completion
**Goal**: Users experience a visually rich, four-layer themed background that switches smoothly between four distinct styles and degrades gracefully on unsupported hardware.
**Depends on**: Nothing (first phase)
**Requirements**: SDF-01, SDF-02, SDF-03, SDF-04, SDF-05, SDF-06, SDF-07
**Success Criteria** (what must be TRUE):
  1. User sees a complete four-layer background scene (near trees, bottom ground 5-10%, midground buildings/landscape 60-80%, top sky 10-20%) for each of the 4 themes (default/sakura/cyberpunk/ink)
  2. User switches between themes and observes a 2-second smooth easeInOutCubic crossfade/interpolation between all geometric and color parameters
  3. When switching themes rapidly in succession, transitions start from the current interpolated state without visual jumps or resets
  4. If the GPU fails to compile the raymarch shader, the application detects the failure, logs it to console, and displays a CSS gradient fallback background (no blank or black screen)
  5. When the browser tab loses and regains focus (WebGL context loss), all custom ShaderMaterial instances rebuild automatically and rendering resumes
**Plans**: TBD
**UI hint**: yes

### Phase 2: AI Knowledge Tree Generation
**Goal**: Users can submit unstructured text and receive an AI-generated structured knowledge tree, review and confirm the result, and have it inserted at accurate positions in their existing tree.
**Depends on**: Phase 1 (non-blocking; Phase 1 de-risks rendering for the review UI)
**Requirements**: AI-01, AI-02, AI-03, AI-04, AI-05, AI-06
**Success Criteria** (what must be TRUE):
  1. User submits unstructured text (bullet points, paragraphs, or mixed content) and receives a structured knowledge tree with progress indication during generation
  2. User reviews the AI-generated tree in a confirmation panel and can accept, reject, or modify individual nodes before insertion into their workspace
  3. If the LLM response contains partial JSON errors, valid nodes are still extracted and presented (partial recovery instead of total failure); the user sees which nodes were recovered
  4. AI-generated knowledge points are automatically placed at semantically correct parent-child paths within the user's existing tree (using SequenceMatcher ratio > 0.7 for path matching)
  5. User can navigate away from the generation page and return to check task status without losing progress (async task persists independently)
**Plans**: TBD
**UI hint**: yes

### Phase 3: Quiz Feedback Loop
**Goal**: Users receive daily personalized quiz sessions that adapt to their learning performance, with visible streak tracking and positive reinforcement that drives return behavior.
**Depends on**: Phase 2 (quizzes require a populated tree with content to generate questions from)
**Requirements**: QUIZ-01, QUIZ-02, QUIZ-03, QUIZ-04, QUIZ-05, QUIZ-06
**Success Criteria** (what must be TRUE):
  1. User opens the app and sees a personalized daily quiz session with questions balanced across four tiers (40% due reviews / 30% new content / 20% retry wrong answers / 10% motivational easy wins), with spillover quotas when a tier is unfilled
  2. User's spaced repetition scheduling uses the scientifically validated FSRS algorithm (py-fsrs v6.x) that adapts intervals based on answer performance, with review history immutably logged in a dedicated review_log table
  3. After completing a daily quiz, user sees a celebration summary with specific positive metrics (e.g., "+3 knowledge points consolidated, 5-day streak maintained") and a clear next action
  4. User can view their current daily streak count and a calendar heatmap (StreakHeatmap.vue) showing their review consistency over time
  5. When user answers a question correctly, they see a celebratory particle/bounce animation; when incorrectly, they receive an encouraging prompt with the correct answer
  6. User receives a daily PWA push notification (desktop browser) reminding them to complete their quiz, and clicking the notification opens the daily quiz session directly
**Plans**: TBD
**UI hint**: yes

### Phase 4: Integration & Onboarding
**Goal**: New users complete a guided onboarding flow from their first knowledge input to their first quiz in approximately 5 minutes, with mastery visualization on the tree and contextual help that appears only when needed.
**Depends on**: Phase 2 (tree generation must be stable) and Phase 3 (quiz generation must be stable)
**Requirements**: ONB-01, ONB-02, ONB-03
**Success Criteria** (what must be TRUE):
  1. New user signs up and is guided through a single continuous flow: input knowledge points -> AI generates structured tree -> user confirms tree -> user completes first quiz, all without leaving the app or consulting external documentation
  2. User receives contextual help that follows a three-tier ladder: passive hints first (subtle UI cues), gentle nudges second (tooltip suggestions), direct assistance third (explicit guidance panel) -- help escalates only when the user appears stuck
  3. User sees color-coded mastery indicators (red/yellow/green rings or icons) on tree nodes reflecting their quiz performance history, making learning progress visible at a glance
  4. The onboarding experience requires zero external documentation -- all guidance, explanations, and next steps are embedded within the application flow
**Plans**: TBD
**UI hint**: yes

## CEO Plan: Non-Tree System Optimization

Phases from CEO Plan `2026-04-29-non-tree-optimization.md` (SCOPE EXPANSION mode). Implementation order: N1 -> N2 -> N3 -> N4 -> N5 -> N6.

### Phase N1: Non-Tree Foundations
**Goal**: Establish infrastructure foundations: rate limiting (login, global, LLM), migration versioning, request logging middleware, and debug log cleanup. Everything subsequent phases depend on.
**Depends on**: Nothing (first phase in expansion)
**Requirements**: NF-01 through NF-11 (derived from RESEARCH.md)
**Success Criteria** (what must be TRUE):
  1. Login: 5 failed attempts per IP within 15 minutes returns HTTP 429 with Chinese message "登录尝试过多，请15分钟后再试"
  2. Global: 100+ requests per minute from same IP returns 429
  3. LLM endpoints: 10+ requests per minute per user returns 429
  4. Rate limiter fails open on database error — legitimate requests are never blocked by storage failure
  5. Migration runner applies numbered SQL files in order, baselines existing schema at version 1
  6. Request logging middleware emits method, path, status_code, duration_ms, user_id for every request
  7. Logging middleware wraps rate limiting middleware: rate-limited 429 responses appear in access log
  8. No console.warn debug output from authStore.ts
**Plans**: 5 plans

Plans:
- [ ] N1-01-PLAN.md — Migration system: SQL files, db_migrate.py, init_db integration
- [ ] N1-02-PLAN.md — Rate limit middleware: pure ASGI class, 3 limit categories, fail-open
- [ ] N1-03-PLAN.md — Logging middleware + main.py wiring: structured key=value logs, middleware order
- [ ] N1-04-PLAN.md — Frontend cleanup: remove console.warn from authStore.ts
- [ ] N1-05-PLAN.md — Backend tests: rate limiter, logging, migration, middleware order coverage
**UI hint**: no

### Phase N2: Error Fixes
**Goal**: Fix silent failures in quiz submission, review error handling, and stats API failures.
**Depends on**: Phase N1 (requires request logging for debugging)
**Requirements**: NF-12 through NF-17 (derived from CEO Plan N2 scope)
**Plans**: 3 plans
**UI hint**: no

**Success Criteria** (what must be TRUE):
  1. When submitAnswer API fails, user sees error toast "提交答案失败，请检查网络连接" (not silent failure)
  2. Short-answer quiz questions use case-insensitive substring matching against stored keyword list
  3. Quiz question difficulty adjusts based on node's recent 3-answer accuracy (all correct -> hard, all wrong -> easy, mixed -> medium)
  4. When fetchReviewStats fails, error message is visible in StatsPanel (not silent null)
  5. Review card progress shows "第 X/Y 张卡片" format
  6. No console.warn debug output from authStore.ts or useLogoutFlow.ts

Plans:
- [ ] 02-01-PLAN.md — Quiz fixes: submitAnswer error toast, short-answer keyword matching, adaptive difficulty
- [ ] 02-02-PLAN.md — Review fixes: fetchReviewStats error visibility, progress bar "第 X/Y 张卡片"
- [ ] 02-03-PLAN.md — Debug cleanup: verify authStore.ts clean, remove console.warn from useLogoutFlow.ts

### Phase N3: UI Polish
**Goal**: Markdown editor enhancements (tables, mermaid, task lists, export), UI accessibility (ARIA labels, keyboard nav), Stats dashboard (trend charts, domain heatmap), Review heatmap.
**Depends on**: Phase N1 (foundations), Phase N2 (error fixes)
**Requirements**: TBD
**Plans**: TBD
**UI hint**: yes

### Phase N4: AI Streaming
**Goal**: SSE streaming for AI generate/analyze endpoints, LLM response caching, timeout improvements, raw response visibility.
**Depends on**: Phase N1 (rate limiting on LLM endpoints)
**Requirements**: TBD
**Plans**: TBD
**UI hint**: no

### Phase N5: Notifications
**Goal**: Browser push notifications for daily review reminders with VAPID keys and service worker push handler.
**Depends on**: Phase N1 (infra), Phase N4 (AI features stable)
**Requirements**: TBD
**Plans**: TBD
**UI hint**: no

### Phase N6: Deployment
**Goal**: Daily SQLite backups, logrotate config, zero-downtime deploy (port-swap), health check validation.
**Depends on**: All prior N phases (validates everything)
**Requirements**: TBD
**Plans**: TBD
**UI hint**: no

## Progress

**Execution Order:**
SDF phases execute in numeric order: 1 -> 2 -> 3 -> 4
CEO Plan phases execute in numeric order: N1 -> N2 -> N3 -> N4 -> N5 -> N6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. SDF Background Completion | TBD | Not started | - |
| 2. AI Knowledge Tree Generation | TBD | Not started | - |
| 3. Quiz Feedback Loop | TBD | Not started | - |
| 4. Integration & Onboarding | TBD | Not started | - |
| N1. Non-Tree Foundations | 0 of 5 | Planning complete | - |
| N2. Non-Tree Optimization: Error Fixes | 0 of 3 | Planning complete | - |
| N3. Non-Tree Optimization: UI Polish | TBD | Not started | - |
| N4. Non-Tree Optimization: AI Streaming | TBD | Not started | - |
| N5. Non-Tree Optimization: Notifications | TBD | Not started | - |
| N6. Non-Tree Optimization: Deploy | TBD | Not started | - |
