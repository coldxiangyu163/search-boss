# Boss Deterministic Executor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a deterministic BOSS execution layer that reuses the already-open logged-in BOSS tab, replaces high-noise browser exploration for read-heavy sourcing/chat flows, and coordinates safely with the existing `chrome-devtools`-driven Nanobot skill.

**Architecture:** Keep `search-boss` as the control plane and source of truth. Add an in-repo BOSS bridge stack with three layers: a CDP target client, a run-scoped session store, and a read-first `boss-cli` that executes structured reads inside the bound BOSS tab. `AgentService` will prefer `boss-cli` for structured reads and keep `chrome-devtools` / Nanobot for UI-mutating actions, attachment handling, and hard recovery. This follows the layering pattern validated in the `ai-extensions-wxt` reference project, but without introducing a browser extension shell.

**Tech Stack:** Node.js CommonJS, direct Chrome CDP against `http://127.0.0.1:9222`, repo-local CLI under `scripts/`, run-scoped JSON files in `tmp/`, existing `NanobotRunner`, existing callback contract, `node:test`.

---

## Scope

Phase 1 replaces these exploratory reads with deterministic commands:

- current BOSS target detection
- job list and job detail reads
- recommend list reads
- chat list reads
- chat thread message reads
- resume-side-panel reads

Phase 1 does **not** move these actions into the CLI:

- switching jobs in UI
- opening candidate details in UI
- sending messages
- greeting candidates
- downloading attachment resumes
- popup dismissal and emergency page recovery

## Reference Pattern To Borrow

Use the following design lessons from the reference implementation:

- [`server.mjs`](/Users/coldxiangyu/work/百融云创/ai-extensions-wxt/packages/agent-browser-bridge/server.mjs): thin local bridge around browser control
- [`bridgeClient.ts`](/Users/coldxiangyu/work/百融云创/ai-extensions-wxt/apps/extension-auto/src/services/agentBrowserBridge/bridgeClient.ts): small transport client with `exec` / `batch`
- [`bridgeCommands.ts`](/Users/coldxiangyu/work/百融云创/ai-extensions-wxt/apps/extension-auto/src/services/agentBrowserBridge/bridgeCommands.ts): semantic browser command layer
- [`candidateDiscovery.ts`](/Users/coldxiangyu/work/百融云创/ai-extensions-wxt/apps/extension-auto/src/services/agentBrowserBridge/candidateDiscovery.ts): page-specific deterministic sourcing helpers
- [`chatWorkflow.ts`](/Users/coldxiangyu/work/百融云创/ai-extensions-wxt/apps/extension-auto/src/services/agentBrowserBridge/chatWorkflow.ts): chat-specific fallback strategy (`eval` first, snapshot/ref second)

Do **not** copy the extension shell, `browser.storage.local`, or IndexedDB persistence into this repo. PostgreSQL and existing callback routes remain the truth source here.

## Session Contract

Create one run-scoped session file at:

`tmp/boss-session-<runId>.json`

Recommended shape:

```json
{
  "runId": 92,
  "targetId": "TARGET_123",
  "tabUrl": "https://www.zhipin.com/web/chat/recommend?jobid=...",
  "jobKey": "健康顾问_B0047007",
  "jobId": "8eca6cadddd93ddf0nVz39W7GFZT",
  "mode": "source",
  "epoch": 4,
  "selectedUid": null,
  "lastOwner": "boss-cli",
  "updatedAt": "2026-03-28T10:00:00.000Z"
}
```

Rules:

- `targetId` is mandatory once bound.
- `epoch` increments after every UI-mutating action.
- `boss-cli` must reject stale or malformed session state.
- `chrome-devtools` actions must refresh state before using prior `uid` references.
- `boss-cli` read commands must validate the current `epoch` before returning thread-sensitive data.

## Task 1: Extend runtime configuration

**Files:**
- Modify: `src/config.js`
- Modify: `tests/config.test.js`

**Step 1: Write the failing config test**

Add assertions for these optional env-backed fields:

- `BOSS_CDP_ENDPOINT`
- `BOSS_CDP_TARGET_URL_PREFIX`
- `BOSS_CLI_SESSION_DIR`
- `BOSS_CLI_ENABLED`

Expected defaults:

- `bossCdpEndpoint: 'http://127.0.0.1:9222'`
- `bossCdpTargetUrlPrefix: 'https://www.zhipin.com/'`
- `bossCliSessionDir: '<repo>/tmp'`
- `bossCliEnabled: false`

**Step 2: Run the test to verify failure**

Run:

```bash
node --test tests/config.test.js
```

Expected: FAIL because the new config keys are missing.

**Step 3: Implement minimal config support**

Expose the new optional config fields in `src/config.js` without relaxing existing required env validation.

**Step 4: Run the test to verify pass**

Run:

```bash
node --test tests/config.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/config.js tests/config.test.js
git commit -m "增加 boss cli 配置"
```

## Task 2: Build the CDP target client

**Files:**
- Create: `src/services/boss-cdp-client.js`
- Create: `tests/boss-cdp-client.test.js`

**Step 1: Write the failing test**

Cover:

- loading `/json` targets from the configured CDP endpoint
- selecting an existing BOSS page by explicit `targetId`
- selecting an existing BOSS page by URL prefix when `targetId` is absent
- rejecting `about:blank`, `devtools://`, and non-BOSS targets

**Step 2: Run the test to verify failure**

Run:

```bash
node --test tests/boss-cdp-client.test.js
```

Expected: FAIL because the client does not exist.

**Step 3: Implement the minimal client**

Expose:

- `listTargets()`
- `resolveBossTarget({ targetId, urlPrefix })`
- `evaluate({ targetId, expression })`

Use plain HTTP against the CDP endpoint for target discovery. Do not create a new tab or navigate anywhere in phase 1.

**Step 4: Run the test to verify pass**

Run:

```bash
node --test tests/boss-cdp-client.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/boss-cdp-client.js tests/boss-cdp-client.test.js
git commit -m "增加 boss cdp client"
```

## Task 3: Add the run-scoped session store

**Files:**
- Create: `src/services/boss-session-store.js`
- Create: `tests/boss-session-store.test.js`

**Step 1: Write the failing test**

Cover:

- bind target to `tmp/boss-session-<runId>.json`
- load and save session state
- bump `epoch`
- switch `lastOwner`
- reject mismatched `expectedEpoch`

**Step 2: Run the test to verify failure**

Run:

```bash
node --test tests/boss-session-store.test.js
```

Expected: FAIL because the store does not exist.

**Step 3: Implement the minimal store**

Expose:

- `loadSession(runId)`
- `saveSession(runId, session)`
- `bindTarget(runId, data)`
- `bumpEpoch(runId, owner)`
- `assertEpoch(runId, expectedEpoch)`

Persist only the coordination metadata. Business truth remains in PostgreSQL.

**Step 4: Run the test to verify pass**

Run:

```bash
node --test tests/boss-session-store.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/boss-session-store.js tests/boss-session-store.test.js
git commit -m "增加 boss session store"
```

## Task 4: Implement browser command helpers

**Files:**
- Create: `src/services/boss-browser-commands.js`
- Create: `tests/boss-browser-commands.test.js`

**Step 1: Write the failing test**

Cover:

- reading current URL from the bound target
- evaluating JS inside the bound target
- extracting JSON payloads from evaluated code
- normalizing timeout and auth-expired failures

**Step 2: Run the test to verify failure**

Run:

```bash
node --test tests/boss-browser-commands.test.js
```

Expected: FAIL because the helper does not exist.

**Step 3: Implement the minimal helper**

Expose:

- `getUrl({ cdpClient, targetId })`
- `evaluateJson({ cdpClient, targetId, expression })`
- `bossFetch({ cdpClient, targetId, url, method, body, timeoutMs })`

This layer should follow the `bridgeCommands.ts` pattern: small semantic wrappers over raw browser execution, not workflow logic.

**Step 4: Run the test to verify pass**

Run:

```bash
node --test tests/boss-browser-commands.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/boss-browser-commands.js tests/boss-browser-commands.test.js
git commit -m "增加 boss browser commands"
```

## Task 5: Build recommend/chat workflow helpers

**Files:**
- Create: `src/services/boss-workflows/recommend-workflow.js`
- Create: `src/services/boss-workflows/chat-workflow.js`
- Create: `tests/recommend-workflow.test.js`
- Create: `tests/chat-workflow.test.js`

**Step 1: Write the failing tests**

Cover:

- recommend shell detection vs iframe-ready detection
- recommend card extraction from the current tab
- unread filter detection on the chat page
- chat thread list extraction
- current thread message extraction

Mock the evaluated DOM payloads rather than a live browser.

**Step 2: Run the tests to verify failure**

Run:

```bash
node --test tests/recommend-workflow.test.js tests/chat-workflow.test.js
```

Expected: FAIL because the workflows do not exist.

**Step 3: Implement recommend helpers**

Expose:

- `ensureRecommendShellReady()`
- `ensureRecommendIframeReady()`
- `readRecommendCards({ jobId, limit })`

Use the real-page insights already captured in the skill docs: outer shell is not enough; iframe anchors must be present before cards are considered readable.

**Step 4: Implement chat helpers**

Expose:

- `ensureChatShellReady()`
- `ensureUnreadFilterReady()`
- `readChatThreads({ unreadOnly })`
- `readCurrentThreadMessages({ uid })`

Follow the `chatWorkflow.ts` strategy: `eval` first, snapshot/ref fallback only where needed.

**Step 5: Run the tests to verify pass**

Run:

```bash
node --test tests/recommend-workflow.test.js tests/chat-workflow.test.js
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/services/boss-workflows/recommend-workflow.js src/services/boss-workflows/chat-workflow.js tests/recommend-workflow.test.js tests/chat-workflow.test.js
git commit -m "增加 boss workflow helpers"
```

## Task 6: Build the read-only `boss-cli`

**Files:**
- Create: `scripts/boss-cli.js`
- Create: `tests/boss-cli.test.js`

**Step 1: Write the failing CLI test**

Cover:

- `target bind --run-id`
- `target inspect --run-id`
- `joblist --run-id`
- `job-detail --run-id --job-id`
- `recommend --run-id --job-id --limit`
- `chatlist --run-id --job-id --unread`
- `chatmsg --run-id --uid`
- `resume-panel --run-id --uid`

**Step 2: Run the test to verify failure**

Run:

```bash
node --test tests/boss-cli.test.js
```

Expected: FAIL because the CLI does not exist.

**Step 3: Implement the CLI**

Rules:

- every command requires `--run-id`
- `target bind` records `targetId` and initial `epoch`
- all read commands must load the run session before reading
- all outputs are JSON
- no command may auto-open a tab
- no command may auto-navigate in phase 1

**Step 4: Run the test to verify pass**

Run:

```bash
node --test tests/boss-cli.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/boss-cli.js tests/boss-cli.test.js
git commit -m "增加只读 boss cli"
```

## Task 7: Integrate `boss-cli` into backend orchestration

**Files:**
- Modify: `src/server.js`
- Modify: `src/services/agent-service.js`
- Modify: `tests/api.test.js`

**Step 1: Write the failing service tests**

Add cases for:

- constructing `AgentService` with a `bossCli` runner dependency
- source mode preferring `boss-cli recommend` when `BOSS_CLI_ENABLED=true`
- chat/followup preferring `boss-cli chatlist` and `boss-cli chatmsg`
- fallback to existing Nanobot behavior when CLI bind/read fails

**Step 2: Run the tests to verify failure**

Run:

```bash
node --test tests/api.test.js
```

Expected: FAIL on the new deterministic-executor cases.

**Step 3: Add the runner wiring**

Update `src/server.js` so `AgentService` receives the new deterministic executor dependencies alongside `NanobotRunner`.

**Step 4: Add the read-first branch**

In `src/services/agent-service.js`, add a feature-flagged path:

- `source`: read recommend list through `boss-cli`, then decide whether UI detail is needed
- `chat`: read unread list and thread history through `boss-cli`
- `followup`: same read path, but keep attachments and UI actions on the Nanobot path

Keep callback writeback and run lifecycle unchanged.

**Step 5: Run the tests to verify pass**

Run:

```bash
node --test tests/api.test.js
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/server.js src/services/agent-service.js tests/api.test.js
git commit -m "接入 boss cli 读路径"
```

## Task 8: Update the skill protocol

**Files:**
- Modify: `docs/boss-sourcing-skill-draft.md`
- Modify: `/Users/coldxiangyu/.nanobot-boss/workspace/skills/boss-sourcing/SKILL.md`
- Modify: `/Users/coldxiangyu/.nanobot-boss/workspace/skills/boss-sourcing/references/browser-states.md`

**Step 1: Narrow the skill’s role**

Document that the primary read path is now:

- `boss-cli` for structured facts
- `chrome-devtools` only for UI mutation, confirmation, and recovery

**Step 2: Add the coordination protocol**

Document:

- session file path
- `epoch` invalidation rules
- ownership handoff between `boss-cli` and `chrome-devtools`
- when to refresh snapshot after a UI mutation

**Step 3: Keep the fallback states**

Do not delete the browser state machine. Reposition it as the fallback and recovery layer rather than the primary source of truth.

**Step 4: Sanity check the docs**

Manually verify there is only one primary path and one fallback path.

**Step 5: Commit**

```bash
git add docs/boss-sourcing-skill-draft.md /Users/coldxiangyu/.nanobot-boss/workspace/skills/boss-sourcing/SKILL.md /Users/coldxiangyu/.nanobot-boss/workspace/skills/boss-sourcing/references/browser-states.md
git commit -m "更新 boss skill 协议"
```

## Task 9: Add observability and rollout controls

**Files:**
- Modify: `src/services/agent-service.js`
- Modify: `tests/api.test.js`

**Step 1: Write the failing tests**

Cover emitted run events or logs for:

- `boss_cli_bind_started`
- `boss_cli_bind_failed`
- `boss_cli_command_started`
- `boss_cli_command_succeeded`
- `boss_cli_command_failed`
- `boss_cli_fallback_to_nanobot`

**Step 2: Run the tests to verify failure**

Run:

```bash
node --test tests/api.test.js
```

Expected: FAIL because deterministic executor events are missing.

**Step 3: Implement lightweight observability**

Emit structured progress markers so failed runs can be diagnosed without reading raw browser logs.

**Step 4: Run the tests to verify pass**

Run:

```bash
node --test tests/api.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/agent-service.js tests/api.test.js
git commit -m "增加 boss cli 可观测性"
```

## Task 10: Verify rollout in layers

**Files:**
- Modify: `docs/plans/2026-03-28-boss-deterministic-executor-implementation.md`

**Step 1: Run unit and integration tests**

Run:

```bash
npm test
```

Expected: PASS.

**Step 2: Run manual deterministic checks**

Verify in a real logged-in browser:

- `target bind` reuses the existing BOSS tab
- `recommend` works without creating a new tab
- `chatlist` works on the same tab family
- after a UI click, stale `epoch` is rejected until refreshed

**Step 3: Enable rollout in stages**

Roll out in this order:

1. `sync_jobs`
2. `source`
3. `chat`
4. `followup` read path

Do not enable write commands in the CLI until the read path is stable in production-like runs.

**Step 4: Record rollout notes**

Update this plan with any deviations discovered during manual validation so follow-up implementation stays aligned with reality.

## Suggested Execution Order

If implementing in this repo, use this order:

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 6
6. Task 5
7. Task 7
8. Task 8
9. Task 9
10. Task 10

Reason: configuration, target resolution, and session coordination are the hard prerequisites. The CLI shell can be added once the low-level pieces exist, and workflow helpers can be refined while the CLI contract is already fixed.

Plan complete and saved to `docs/plans/2026-03-28-boss-deterministic-executor-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
