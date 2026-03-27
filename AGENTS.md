# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the Node/Express app: `app.js` routes requests, `server.js` starts the service, `services/` holds orchestration logic, and `db/` holds schema and pool code. `public/` serves the admin UI directly. `scripts/` contains operational tools such as DB setup and `agent-callback-cli.js`. `tests/` mirrors runtime modules with `*.test.js` files. `docs/` stores deployment notes, runtime contracts, and architecture plans.

## Architecture & Call Flow
This repo is the backend control plane; browser automation runs through Nanobot, not inside Express. Typical flow:
1. UI or API triggers `JobService` / `SchedulerService`, which creates a `sourcing_runs` record.
2. `AgentService` builds the prompt, pins `PROJECT_ROOT`, `JOB_KEY`, `RUN_ID`, and the repo callback CLI path.
3. `NanobotRunner` starts `uv run nanobot agent --config "$NANOBOT_CONFIG_PATH"`.
4. Nanobot loads its external workspace (`skills`, `memory`, `sessions`, `tools`) plus MCP config such as `chrome-devtools`.
5. The skill drives logged-in Chrome, then calls `scripts/agent-callback-cli.js`.
6. The CLI writes back to `/api/agent/runs/:runId/events|candidates|messages|actions|attachments|complete|fail`.
7. PostgreSQL is the source of truth; skill memory and local JSON are execution aids only.

## Build, Test, and Development Commands
Use `npm install` to install dependencies. Run `npm start` to launch the server on `PORT` (default `3000`). Run `npm test` for the full suite. Use `npm run db:setup` to initialize Postgres, `npm run db:bootstrap-real` to load source data, and `npm run db:export-job-execution` to export run data. There is no frontend build step.

## Coding Style & Naming Conventions
Follow the existing CommonJS style: 2-space indentation, semicolons, single quotes, and small focused modules. Keep filenames lowercase and kebab-cased, especially in `src/services/` (for example, `scheduler-service.js`). Use `camelCase` for functions, `PascalCase` for classes, and stable route/resource names such as `/api/jobs/:jobKey`. No formatter or linter is configured, so match surrounding files exactly.

## Testing Guidelines
Tests use `node:test`, `node:assert/strict`, and `supertest`. Add new tests under `tests/` with names ending in `.test.js`, usually matching the module or route, such as `scheduler-service.test.js` or `agent-callback-cli.test.js`. Cover both happy paths and failure modes, especially callback payload shape, run-event idempotency, and Nanobot prompt generation. Run `npm test` before opening a PR.

## Commit & Pull Request Guidelines
Recent commits use short, single-purpose messages, often in Chinese, such as `修复执行问题` or `增加部署文档`. Keep that pattern: one change per commit, imperative tone, and no mixed concerns. PRs should include a short summary, note any env or schema changes, list commands run for verification, and attach screenshots when `public/` UI behavior changes.

## Agent Integration Notes
The current local Nanobot workspace is `/Users/coldxiangyu/.nanobot-boss/workspace`, but repo code and skills should still prefer runtime placeholders over machine-specific paths. Keep `DATABASE_URL`, `AGENT_TOKEN`, `NANOBOT_CONFIG_PATH`, `SEARCH_BOSS_API_BASE`, and `SEARCH_BOSS_AGENT_TOKEN` env-driven. When changing the agent contract, update backend routes, `scripts/agent-callback-cli.js`, related tests, and the skill/deployment docs together.
