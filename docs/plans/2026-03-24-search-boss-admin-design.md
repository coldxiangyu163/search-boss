# Search Boss Admin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local backend admin system for BOSS sourcing with job management, BOSS job sync, sourcing run tracking, live progress updates, and PostgreSQL persistence.

**Architecture:** Use a single Node.js Express service to serve both REST APIs and the admin UI. Persist jobs, candidates, sourcing runs, run events, and daily stats in PostgreSQL. Use Server-Sent Events to stream sourcing progress into the admin page. Keep BOSS integration local-first by allowing the backend to call BOSS APIs with a provided cookie string.

**Tech Stack:** Node.js, Express, PostgreSQL, `pg`, vanilla HTML/CSS/JS, Node built-in test runner

---

### Task 1: Bootstrap project

**Files:**
- Create: `package.json`
- Create: `src/config.js`
- Create: `src/server.js`
- Create: `src/app.js`
- Create: `tests/app.test.js`

**Step 1:** Add a failing smoke test for the health endpoint.

**Step 2:** Run the test and confirm it fails because the app does not exist yet.

**Step 3:** Add the minimal Express app and server bootstrap to make the test pass.

**Step 4:** Re-run the test suite.

### Task 2: Add PostgreSQL persistence

**Files:**
- Create: `src/db/schema.sql`
- Create: `src/db/init.js`
- Create: `src/db/pool.js`
- Create: `src/repositories/*.js`
- Create: `tests/db.test.js`

**Step 1:** Add failing tests for database initialization and JSON import behavior.

**Step 2:** Implement schema creation, database bootstrap, and repository methods.

**Step 3:** Re-run tests against the local PostgreSQL database.

### Task 3: Implement admin APIs

**Files:**
- Create: `src/routes/*.js`
- Create: `src/services/*.js`
- Modify: `src/app.js`
- Create: `tests/api.test.js`

**Step 1:** Add failing tests for job listing, dashboard summary, sourcing run creation, and SSE shape.

**Step 2:** Implement REST APIs and progress event streaming.

**Step 3:** Re-run API tests.

### Task 4: Build admin UI

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`
- Create: `public/styles.css`
- Keep: `dashboard.html` as legacy reference or redirect note

**Step 1:** Build a detailed admin page with job management, BOSS sync, sourcing controls, run timeline, and candidate list.

**Step 2:** Wire the page to REST APIs and SSE updates.

**Step 3:** Verify the page against live local APIs.

### Task 5: Import existing data and document usage

**Files:**
- Create: `.env.example`
- Create: `README.md`
- Create: `scripts/import-json.js`

**Step 1:** Add import support for `data/candidates.json` and JD markdown.

**Step 2:** Add usage docs for database creation, app start, JSON import, and BOSS sync.

**Step 3:** Run end-to-end verification locally.
