# BOSS Sourcing System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade `search-boss` from a basic local admin into a real BOSS sourcing operations system with backend-owned workflow state, idempotent follow-up, resume-request tracking, attachment dedupe, and a candidate operations workbench.

**Architecture:** Keep the current single-service Express app, Graphile Worker scheduler, and nanobot CLI integration. Refactor PostgreSQL around `people`, `job_candidates`, append-only events, outbound actions, and resume artifacts; move follow-up decisions, transition rules, idempotency, and attempt validation into the backend so the skill becomes a deterministic execution layer instead of holding the business rules.

**Tech Stack:** Node.js, Express, PostgreSQL, `pg`, Graphile Worker, vanilla HTML/CSS/JS, Node built-in test runner, local `nanobot agent`

---

### Task 1: Refactor persistence around people, job relationships, and idempotent artifacts

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/init.js`
- Modify: `tests/db.test.js`
- Modify: `tests/api.test.js`

**Step 1: Write failing schema assertions**

Add tests for new tables/columns:
- `people`
- `job_candidates`
- `job_candidate_events`
- `candidate_messages`
- `candidate_actions`
- `candidate_attachments`
- attempt/idempotency fields needed by agent callbacks

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="database bootstrap creates required tables|agent APIs"`

Expected: missing-table or missing-column failures.

**Step 3: Add minimal schema changes**

Implement:
- `people + job_candidates` core model
- unique keys for messages, actions, attachments, and callback idempotency
- indexes for candidate follow-up queries and per-job concurrency checks

**Step 4: Re-run targeted tests**

Expected: schema assertions pass.

---

### Task 2: Stop using candidate upsert as the only source of operational truth

**Files:**
- Modify: `src/services/index.js`
- Modify: `src/app.js`
- Modify: `tests/api.test.js`

**Step 1: Add failing API tests for new Agent endpoints**

Cover:
- `POST /api/agent/runs/:runId/messages`
- `POST /api/agent/runs/:runId/actions`
- `POST /api/agent/runs/:runId/attachments`
- callbacks carrying `attemptId`, `eventId`, `sequence`, `occurredAt`
- duplicate requests do not duplicate rows or stats

**Step 2: Implement message, action, and attachment APIs**

Requirements:
- authenticate with existing agent token
- reject writes to non-running runs
- reject stale or duplicate callbacks by attempt/idempotency rules
- upsert or ignore duplicates via unique keys
- create timeline events for important actions

**Step 3: Move stats increments behind action-level idempotency**

Requirements:
- greeting increments only once per distinct greeting action
- response increments only once per distinct candidate reply action
- resume download increments only once per distinct attachment/action

**Step 4: Re-run API tests**

Expected: duplicate writes are ignored safely.

---

### Task 3: Add a backend follow-up decision engine

**Files:**
- Modify: `src/services/index.js`
- Modify: `src/app.js`
- Modify: `tests/api.test.js`

**Step 1: Add failing tests for follow-up decision rules**

Cover cases:
- candidate already has resume downloaded
- candidate was asked for resume within cooldown window
- candidate replied after the last recruiter message
- candidate rejected or closed
- candidate is under `manual_hold` or `do_not_contact`
- queued task becomes stale before execution time

**Step 2: Implement a decision service**

Add backend logic that returns:
- `allowed`
- `reason`
- `cooldownRemainingMinutes`
- `recommendedAction`
- `timeBucket` or dedupe window token

**Step 3: Expose the decision as Agent API**

Add route:
- `GET /api/agent/candidates/:candidateId/followup-decision`

**Step 4: Re-run targeted tests**

Expected: the backend, not the skill, becomes the source of truth for whether a resume request may be sent.

---

### Task 4: Upgrade candidate state transitions and safe merge behavior

**Files:**
- Modify: `src/services/index.js`
- Modify: `tests/api.test.js`

**Step 1: Add failing tests for safe state progression**

Cover:
- `greeted -> responded -> resume_requested -> resume_received -> resume_downloaded`
- later stale updates do not downgrade a candidate from `resume_downloaded` back to `responded`
- repeated resume requests update timestamps without inflating counts incorrectly
- the same person can appear in multiple jobs without losing shared identity

**Step 2: Implement ordered state merge rules**

Requirements:
- add a deterministic state priority map
- update only forward unless the change is an explicit terminal override like `rejected`
- separate person-level profile data from job-level workflow data
- separate `conversationStage` from `status` if needed

**Step 3: Re-run tests**

Expected: out-of-order agent writes no longer corrupt candidate state.

---

### Task 5: Align nanobot runner prompts with the new contract

**Files:**
- Modify: `src/services/nanobot-runner.js`
- Modify: `tests/api.test.js`

**Step 1: Add failing tests for prompt shape**

Assert that sourcing/follow-up messages instruct the skill to:
- call messages/actions/attachments endpoints
- query follow-up decision before asking for a resume again
- avoid duplicate downloads
- attach `attemptId`, `eventId`, and `sequence` to every callback

**Step 2: Update prompt builders**

Requirements:
- sourcing prompt focuses on discovery/greeting writes
- follow-up prompt focuses on message ingestion, decision lookup, resume request action logging, and attachment dedupe
- every prompt explicitly forbids relying on local JSON or implicit local state
- sync prompt stays job-only

**Step 3: Re-run prompt tests**

Expected: backend and skill contract stay consistent.

---

### Task 6: Update the BOSS sourcing skill spec to match the backend contract

**Files:**
- Modify: `docs/boss-sourcing-skill-draft.md`

**Step 1: Rewrite the local API contract section**

Add:
- message endpoint usage
- action endpoint usage
- attachment endpoint usage
- follow-up decision endpoint usage

**Step 2: Rewrite `--followup` workflow**

Requirements:
- read new candidate replies
- write raw message records
- ask backend whether resume request is allowed
- only then send the next message
- if attachment exists, write attachment state before/after download
- stop immediately if backend rejects stale attempt or disallows follow-up

**Step 3: Add explicit idempotency examples**

Show sample keys for:
- message imports
- resume request actions
- resume downloads

---

### Task 7: Build a real TOB admin shell instead of a single-page dashboard

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

**Step 1: Add failing UI-level checks for shell structure**

Verify the frontend now has explicit module sections or route state for:
- `Command Center`
- `Triage Inbox`
- `Job Operations`
- `Candidate CRM`
- `Automation Engine`
- `System Health`

**Step 2: Replace the current side rail with true enterprise navigation**

Requirements:
- sidebar becomes module routing, not copywriting
- top bar adds page title, breadcrumb/context, and utility actions
- main outlet renders one module workspace at a time
- the page body stops being a single long dashboard

**Step 3: Implement the module workspaces**

Add:
- `Command Center` with KPI overview and priority queues
- `Triage Inbox` with queue/detail handling for follow-up, resume processing, and exceptions
- `Job Operations` as job list + detail + job-level actions
- `Candidate CRM` as dense table + filters + detail drawer/panel
- `Automation Engine` for scheduler, runs, and audit history
- `System Health` for runtime/signal visibility

**Step 4: Wire backend data into the new workspaces**

Requirements:
- show last resume request time
- show request count
- show whether cooldown is active
- show whether a resume is pending download or already downloaded
- show whether the current candidate is blocked, duplicated, or needs manual intervention
- move scheduler and run audit out of the homepage into dedicated workspaces

**Step 5: Manually verify in browser**

Run the local app and confirm the dashboard renders and the new candidate fields display correctly.

Also confirm:
- desktop first layout uses fixed navigation + module content area
- tables and timelines scroll independently instead of forcing whole-page vertical sprawl
- mobile remains readable even if operations are desktop-first

---

### Task 8: Add execution-time safety for scheduled jobs

**Files:**
- Modify: `src/services/index.js`
- Modify: `tests/api.test.js`

**Step 1: Add failing tests for safe scheduled execution**

Cover:
- same job cannot run overlapping follow-up workers
- stale queued jobs become `skipped`, not `failed`
- old run attempts cannot write into a newer active run

**Step 2: Implement per-job concurrency and stale-at-execution recheck**

Keep required now:
- `sync_jobs`
- `followup`

Optional later:
- `source_job`

---

### Task 9: Reconcile real database data safely

**Files:**
- Modify: `scripts/import-json.js`
- Modify: `src/services/import-service.js`
- Modify: `README.md`

**Step 1: Ensure imports populate new columns safely**

Requirements:
- old data should map into new candidate defaults
- no destructive reset against the real `search_boss_admin` database during normal usage

**Step 2: Document rollout steps**

Include:
- backup recommendation for current DB
- schema setup command
- restart steps
- expected post-migration checks

---

### Task 10: Verify end-to-end behavior

**Files:**
- Modify: `tests/api.test.js`
- Modify: `README.md`

**Step 1: Add end-to-end tests for the critical invariants**

Must cover:
- duplicate candidate upsert does not duplicate candidate row
- duplicate reply import does not duplicate response count
- duplicate resume request action does not duplicate request count
- duplicate attachment import/download does not duplicate resume row or stats
- stale attempt callback is rejected safely
- overlapping follow-up execution is prevented or skipped deterministically

**Step 2: Run full test suite**

Run: `npm test`

Expected: all tests pass.

**Step 3: Run live local validation**

Run:
- `npm run db:setup`
- `npm start`

Check:
- `GET /health`
- `GET /api/dashboard/summary`
- UI loads at `http://127.0.0.1:3000`

---

Plan complete and saved to `docs/plans/2026-03-24-boss-sourcing-system-implementation.md`.

Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints
