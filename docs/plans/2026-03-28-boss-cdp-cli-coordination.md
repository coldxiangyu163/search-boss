# Boss CDP CLI + Chrome DevTools Coordination Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a custom `boss-cli` that reuses the currently open BOSS直聘 tab through CDP, avoids opening new tabs or triggering duplicate-login warnings, and cooperates safely with the existing `chrome-devtools`-driven skill.

**Architecture:** Keep `search-boss` as the business orchestrator and callback authority. Add a small in-repo `boss-cli` that binds to an explicit BOSS browser target and executes deterministic commands inside that tab. Coordinate `boss-cli` and `chrome-devtools` through a shared run-scoped session file with `targetId`, `epoch`, `mode`, and ownership markers. Phase 1 is read-heavy and UI-write-light: `boss-cli` handles structured reads only, while `chrome-devtools` continues to own all UI-mutating actions.

**Tech Stack:** Node.js CommonJS, direct Chrome CDP over `9222`, existing `chrome-devtools` MCP workflow, `agent-callback-cli.js`, `node:test`, local JSON session files in `tmp/`.

---

## Why This Plan

The custom CLI is justified because:

1. `opencli boss` has the right adapter idea but does not treat "reuse the current BOSS tab" as a first-class constraint.
2. Your workflow must not open a second BOSS tab or cause repeat-login prompts.
3. The real stability problem is exploratory browser decision-making; structured reads from the already-open tab are the cleanest way to remove that failure mode.

This plan intentionally avoids replacing your whole skill stack. The new CLI becomes a deterministic helper under the current architecture, not a second orchestration system.

## Design Principles

- **Single-tab discipline:** All commands bind to one explicit BOSS target. No auto-open, no auto-new-tab, no silent target switching.
- **Read-first rollout:** Phase 1 only replaces high-noise read steps.
- **UI ownership is explicit:** `chrome-devtools` owns UI state changes; `boss-cli` owns structured reads.
- **Epoch invalidation:** Any UI-changing action invalidates stale CLI assumptions.
- **Backend authority remains unchanged:** `RUN_ID`, writeback, dedupe, and follow-up policy stay in `search-boss`.

## Session Contract

Create a run-scoped session file such as:

`tmp/boss-session-<runId>.json`

Recommended shape:

```json
{
  "runId": 92,
  "targetId": "CDP_TARGET_ID",
  "tabUrl": "https://www.zhipin.com/web/chat/index",
  "jobKey": "健康顾问_B0047007",
  "jobId": "8eca6cadddd93ddf0nVz39W7GFZT",
  "mode": "chat",
  "epoch": 12,
  "selectedUid": null,
  "lastOwner": "chrome-devtools",
  "updatedAt": "2026-03-28T10:00:00.000Z"
}
```

Rules:

- `targetId` is mandatory for all `boss-cli` commands.
- `epoch` increments after any UI-mutating action.
- `boss-cli` must refuse to run if the session file is missing or malformed.
- Commands that read thread-specific content must validate `epoch` before and after execution.

## Command Ownership Model

### Phase 1: `boss-cli` read-only

Implement these first:

- `boss-cli target bind`
- `boss-cli target inspect`
- `boss-cli joblist`
- `boss-cli job-detail --job-id`
- `boss-cli recommend --job-id --limit`
- `boss-cli chatlist --job-id --unread`
- `boss-cli chatmsg --uid --page`
- `boss-cli resume-panel --uid`

### Phase 1: `chrome-devtools` remains UI owner

Keep these in the skill:

- switch job in UI
- open candidate detail
- verify detail sections
- send message
- click greet
- detect and download attachments
- dismiss modals

### Phase 2: optional CLI write commands

Only after phase 1 is stable:

- `boss-cli greet --uid --job-id --text`
- `boss-cli send --uid --text`

These are optional because they mutate thread state and require stronger synchronization.

## Task 1: Add runtime configuration and session paths

**Files:**
- Modify: `src/config.js`
- Modify: `tests/config.test.js`
- Modify: `src/runtime-env.js`

**Step 1: Write failing config tests**

Add tests for:

- `BOSS_CDP_ENDPOINT`
- `BOSS_CDP_TARGET_URL_PREFIX`
- `BOSS_CLI_BIN`
- `BOSS_CLI_SESSION_DIR`

Recommended defaults:

- `bossCdpEndpoint: 'http://127.0.0.1:9222'`
- `bossCdpTargetUrlPrefix: 'https://www.zhipin.com/'`
- `bossCliBin: 'node ./scripts/boss-cli.js'` or equivalent runner path
- `bossCliSessionDir: '<repo>/tmp'`

**Step 2: Run test to verify failure**

Run:

```bash
node --test tests/config.test.js
```

Expected: FAIL because the new config keys are missing.

**Step 3: Implement config**

Expose optional runtime settings through `src/config.js`.

**Step 4: Run tests**

Run:

```bash
node --test tests/config.test.js
```

Expected: PASS.

## Task 2: Build a minimal CDP target binder

**Files:**
- Create: `src/services/boss-cdp-client.js`
- Create: `tests/boss-cdp-client.test.js`

**Step 1: Write failing tests**

Cover:

- fetch `/json` targets from a CDP endpoint
- select the current BOSS page target from URL/title
- reject `about:blank`, `devtools`, and non-BOSS targets
- preserve explicit `targetId`

**Step 2: Run test to verify failure**

Run:

```bash
node --test tests/boss-cdp-client.test.js
```

Expected: FAIL because the client does not exist.

**Step 3: Implement client**

Support:

- `listTargets()`
- `resolveBossTarget({ targetId?, urlPrefix? })`
- `connectToTarget(targetId)`
- `evaluate(targetId, expression)`

This client must never create a new target in phase 1.

**Step 4: Run tests**

Run:

```bash
node --test tests/boss-cdp-client.test.js
```

Expected: PASS.

## Task 3: Implement session coordination helpers

**Files:**
- Create: `src/services/boss-session-store.js`
- Create: `tests/boss-session-store.test.js`

**Step 1: Write failing tests**

Cover:

- create/read/update session file
- `epoch` increment
- owner handoff (`chrome-devtools` ↔ `boss-cli`)
- optimistic concurrency checks

**Step 2: Run test to verify failure**

Run:

```bash
node --test tests/boss-session-store.test.js
```

Expected: FAIL because the store does not exist.

**Step 3: Implement store**

Expose:

- `loadSession(runId)`
- `saveSession(runId, data)`
- `bumpEpoch(runId, owner)`
- `assertEpoch(runId, expectedEpoch)`
- `bindTarget(runId, targetId, meta)`

**Step 4: Run tests**

Run:

```bash
node --test tests/boss-session-store.test.js
```

Expected: PASS.

## Task 4: Implement `bossFetch()` inside the current tab

**Files:**
- Create: `src/services/boss-api-in-tab.js`
- Create: `tests/boss-api-in-tab.test.js`

**Step 1: Write failing tests**

Cover:

- XHR/fetch execution with browser credentials inside the bound target
- timeout handling
- non-zero BOSS API response codes
- auth-expired error normalization

**Step 2: Run test to verify failure**

Run:

```bash
node --test tests/boss-api-in-tab.test.js
```

Expected: FAIL.

**Step 3: Implement helper**

Provide:

- `bossFetch({ targetId, url, method, body, timeoutMs })`
- `assertBossOk(data)`
- `normalizeBossApiError(data)`

The fetch must run inside the existing BOSS page context so cookies are reused automatically.

**Step 4: Run tests**

Run:

```bash
node --test tests/boss-api-in-tab.test.js
```

Expected: PASS.

## Task 5: Build the read-only `boss-cli`

**Files:**
- Create: `scripts/boss-cli.js`
- Create: `tests/boss-cli.test.js`

**Step 1: Write failing CLI tests**

Cover:

- `target bind --run-id`
- `target inspect --run-id`
- `joblist`
- `job-detail --job-id`
- `recommend --job-id --limit`
- `chatlist --job-id --unread`
- `chatmsg --uid --page`
- `resume-panel --uid`

**Step 2: Run test to verify failure**

Run:

```bash
node --test tests/boss-cli.test.js
```

Expected: FAIL because the CLI does not exist.

**Step 3: Implement CLI**

Rules:

- all commands require `--run-id`
- all read commands load the session file and bind to `targetId`
- all commands default to JSON output
- no command auto-navigates
- no command auto-opens a new tab

**Step 4: Add `target bind` behavior**

`target bind` should:

- inspect current CDP targets
- choose the visible BOSS page target
- write `targetId` and baseline `epoch` into the session file

**Step 5: Run tests**

Run:

```bash
node --test tests/boss-cli.test.js
```

Expected: PASS.

## Task 6: Define the ownership handshake with the skill

**Files:**
- Modify: `/Users/coldxiangyu/.nanobot-boss/workspace/skills/boss-sourcing/SKILL.md`
- Modify: `/Users/coldxiangyu/.nanobot-boss/workspace/skills/boss-sourcing/references/runtime-contract.md`
- Modify: `/Users/coldxiangyu/.nanobot-boss/workspace/skills/boss-sourcing/references/browser-states.md`

**Step 1: Add protocol section to the skill**

Document:

- `chrome-devtools` must bind the session first
- after any click, navigation, job switch, thread switch, or modal handling, `epoch += 1`
- `boss-cli` reads are only valid against the latest epoch
- after every `boss-cli` call, the skill must re-snapshot before using prior refs again

**Step 2: Add role boundaries**

Document that:

- `boss-cli` is read-only in phase 1
- `chrome-devtools` owns all UI writes
- attachment handling remains outside `boss-cli`

**Step 3: Manual doc review**

Verify the skill no longer implies that both tools can mutate the same tab arbitrarily.

## Task 7: Backend wrapper for deterministic reads

**Files:**
- Create: `src/services/boss-cli-runner.js`
- Modify: `src/services/agent-service.js`
- Test: `tests/api.test.js`

**Step 1: Write failing integration tests**

Cover:

- source workflow using `boss-cli recommend` to get structured candidate feed
- chat workflow using `boss-cli chatlist/chatmsg`
- fallback to existing Nanobot-only flow if session binding is absent

**Step 2: Run test to verify failure**

Run:

```bash
node --test tests/api.test.js
```

Expected: FAIL on the new deterministic-read cases.

**Step 3: Implement wrapper**

The wrapper should:

- spawn `scripts/boss-cli.js`
- pass `--run-id`
- parse JSON output
- convert errors into backend-readable failure reasons

**Step 4: Add narrow `AgentService` usage**

Use `boss-cli` for:

- source candidate listing
- chat queue listing
- chat message retrieval

Do not move writeback logic out of `AgentService`.

**Step 5: Run tests**

Run:

```bash
node --test tests/api.test.js
```

Expected: PASS.

## Task 8: Manual runbook

**Files:**
- Create: `docs/boss-cdp-cli-runbook.md`

**Step 1: Document operator flow**

Include:

1. Start Chrome with `9222`
2. Open BOSS and log in manually
3. Bind current BOSS tab:

```bash
node scripts/boss-cli.js target bind --run-id 92
```

4. Run deterministic reads:

```bash
node scripts/boss-cli.js recommend --run-id 92 --job-id "<encryptJobId>" --limit 10
node scripts/boss-cli.js chatlist --run-id 92 --job-id "<encryptJobId>" --unread true
node scripts/boss-cli.js chatmsg --run-id 92 --uid "<encryptUid>" --page 1
```

5. Let the skill use `chrome-devtools` for UI-only actions

**Step 2: Document failure handling**

Cover:

- target not found
- target drifted to another page
- epoch mismatch
- duplicate login warning risk
- auth expired

## Task 9: Phase 2 write commands

**Files:**
- Modify: `scripts/boss-cli.js`
- Modify: `src/services/boss-api-in-tab.js`
- Test: `tests/boss-cli.test.js`

**Step 1: Only begin after phase 1 proves stable**

Add:

- `greet --uid --job-id --text`
- `send --uid --text`

**Step 2: Enforce exclusive ownership**

Before a write command:

- assert `lastOwner !== 'chrome-devtools-writing'`
- assert epoch is current
- mark ownership as `boss-cli-writing`

After the write:

- bump epoch
- clear ownership

**Step 3: Keep attachment flow out**

Do not implement attachment download in phase 2 unless the read-only path is already stable in production-like use.

## Verification Checklist

Before considering this shipped:

- `boss-cli` never opens a new tab
- `boss-cli` never auto-navigates without an explicit command
- `chrome-devtools` can continue operating after every `boss-cli` read
- stale refs are always discarded after epoch changes
- read-only phase reduces recovery loops in source/chat workflows
- no duplicate-login warning is triggered during normal use

## Recommendation

Build this in two releases:

1. **Release A:** read-only `boss-cli` + session/epoch protocol + skill integration
2. **Release B:** optional write commands (`greet`, `send`) if and only if Release A is stable

This sequence gives you the main benefit immediately: deterministic reads without breaking the logged-in browser session.
