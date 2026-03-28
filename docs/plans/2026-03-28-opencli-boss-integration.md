# OpenCLI Boss Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate `opencli boss` as a deterministic executor for BOSS data fetch and low-risk actions, while keeping `search-boss` as the source of truth for run orchestration, idempotent writeback, and attachment workflow handling.

**Architecture:** Add a local `OpenCliRunner` service behind a feature flag so the backend can switch selected workflows from high-freedom Nanobot browser exploration to structured `opencli boss` commands. Keep `AgentService`, `agent-callback-cli.js`, and PostgreSQL contracts unchanged as the authoritative business boundary; `opencli` only supplies structured inputs and executes bounded recruiting actions such as greet/send. Do not move attachment download into `opencli` in phase 1.

**Tech Stack:** Node.js CommonJS service layer, `child_process.spawn`, existing `AgentService` / `NanobotRunner`, global `opencli` binary or configured path, existing `agent-callback-cli.js`, `node:test`.

---

## Recommended Approach

Use a **hybrid integration**, not a full replacement:

1. **Keep backend authority**: `AgentService`, local API routes, and callback CLI remain unchanged.
2. **Replace exploratory browser reads first**: use `opencli boss joblist`, `detail`, `recommend`, `chatlist`, and `chatmsg` for structured retrieval.
3. **Use bounded actions selectively**: use `opencli boss greet` and `send` only after backend policy allows the action.
4. **Leave attachments on the existing skill path**: `opencli` currently does not provide resume attachment download parity.

Do **not** make phase 1 depend on a global Browser Bridge extension assumption. The integration must detect capability at startup and fall back cleanly to Nanobot.

## Non-Goals

- Replacing all Nanobot workflows in one pass
- Moving resume attachment download into `opencli`
- Moving run writeback logic out of `search-boss`
- Depending on hand-maintained browser state inside the skill once `opencli` data commands are available

## Task 1: Add OpenCLI runtime configuration

**Files:**
- Modify: `src/config.js`
- Test: `tests/config.test.js`

**Step 1: Add failing config test**

Add assertions for new env-backed config values:

- `OPENCLI_ENABLED`
- `OPENCLI_BIN`
- `OPENCLI_CDP_ENDPOINT`
- `OPENCLI_CDP_TARGET`

Expected defaults:

- `opencliEnabled: false`
- `opencliBin: 'opencli'`
- `opencliCdpEndpoint: ''`
- `opencliCdpTarget: ''`

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/config.test.js
```

Expected: FAIL because new config fields are missing.

**Step 3: Implement config support**

Update `src/config.js` to expose the new fields without changing existing required env validation.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/config.test.js
```

Expected: PASS.

## Task 2: Introduce `OpenCliRunner`

**Files:**
- Create: `src/services/opencli-runner.js`
- Test: `tests/opencli-runner.test.js`

**Step 1: Write failing tests**

Cover:

- command construction with env passthrough
- JSON stdout parsing
- stderr / non-zero exit handling
- capability probe failure
- support for `OPENCLI_CDP_ENDPOINT` and `OPENCLI_CDP_TARGET`

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/opencli-runner.test.js
```

Expected: FAIL because the runner does not exist.

**Step 3: Implement minimal runner**

Create a small service that:

- shells out to `opencli`
- injects `OPENCLI_CDP_ENDPOINT` and `OPENCLI_CDP_TARGET` when configured
- supports commands:
  - `doctor`
  - `boss joblist`
  - `boss detail`
  - `boss recommend`
  - `boss chatlist`
  - `boss chatmsg`
  - `boss greet`
  - `boss send`
- parses `-f json` output
- returns structured `{ ok, data, stdout, stderr }`

**Step 4: Add capability probe**

Expose methods:

- `checkAvailability()`
- `listJobs()`
- `getJobDetail()`
- `listRecommendations()`
- `listChats()`
- `getChatMessages()`
- `greetCandidate()`
- `sendMessage()`

`checkAvailability()` must detect:

- binary missing
- extension/CDP connection failure
- unsupported environment

**Step 5: Run tests to verify they pass**

Run:

```bash
node --test tests/opencli-runner.test.js
```

Expected: PASS.

## Task 3: Add hybrid execution mode to backend orchestration

**Files:**
- Modify: `src/server.js`
- Modify: `src/services/agent-service.js`
- Test: `tests/api.test.js`

**Step 1: Add failing service tests**

Add tests for:

- selecting `OpenCliRunner` when `OPENCLI_ENABLED=true` and capability probe succeeds
- falling back to `NanobotRunner` when probe fails
- source-mode prompt or execution branch no longer requiring exploratory browser sourcing when `opencli` mode is active
- chat-mode execution using deterministic fetch + policy gate + send

**Step 2: Run targeted tests to verify failure**

Run:

```bash
node --test tests/api.test.js
```

Expected: FAIL on the new opencli integration cases.

**Step 3: Inject runner**

Update `src/server.js` to build and pass `opencliRunner` into `AgentService`.

**Step 4: Add execution branch**

Update `AgentService` with a feature-flagged branch:

- `sync_jobs`: prefer `opencli joblist/detail`
- `source`: prefer `opencli recommend` for candidate feed
- `chat`: prefer `opencli chatlist/chatmsg`
- `followup`: same as `chat`, then route attachment-type messages to existing attachment workflow

Keep the existing Nanobot path intact as fallback.

**Step 5: Preserve existing contracts**

The opencli branch must still:

- reuse the provided `RUN_ID`
- write through existing service methods / callback routes
- preserve `jobKey` scoping
- preserve `followup-decision`
- preserve run terminal behavior

**Step 6: Run tests to verify they pass**

Run:

```bash
node --test tests/api.test.js
```

Expected: PASS.

## Task 4: Define phase-1 workflow boundaries

**Files:**
- Modify: `src/services/agent-service.js`
- Modify: `docs/boss-sourcing-skill-draft.md`
- Modify: `/Users/coldxiangyu/.nanobot-boss/workspace/skills/boss-sourcing/SKILL.md`

**Step 1: Document phase-1 command mapping**

Document the exact split:

- backend/opencli:
  - job list
  - job detail
  - recommend list
  - chat list
  - chat history
  - greet
  - send
- Nanobot skill:
  - attachment discovery fallback if needed
  - attachment download
  - hard UI recovery only when opencli path is unavailable

**Step 2: Remove obsolete exploration guidance from source/chat path**

Do not delete all browser-state guidance. Narrow it so the skill becomes a fallback path instead of the primary read path.

**Step 3: Run documentation sanity check**

Manually verify the docs describe one primary path and one fallback path, not two conflicting primaries.

## Task 5: Add operational observability and fallback evidence

**Files:**
- Modify: `src/services/agent-service.js`
- Modify: `src/services/opencli-runner.js`
- Test: `tests/api.test.js`

**Step 1: Add stream or event annotations**

When opencli mode is used, emit run events such as:

- `opencli_probe_started`
- `opencli_probe_failed`
- `opencli_command_started`
- `opencli_command_succeeded`
- `opencli_command_failed`
- `opencli_fallback_to_nanobot`

**Step 2: Add failing tests**

Verify events are recorded for:

- successful opencli branch
- fallback to Nanobot
- terminal failure due to both executors being unavailable

**Step 3: Implement minimal event emission**

Reuse existing run event infrastructure; do not invent a second log channel.

**Step 4: Run tests**

Run:

```bash
node --test tests/api.test.js
```

Expected: PASS.

## Task 6: Verify end-to-end execution manually

**Files:**
- None

**Step 1: Verify opencli availability**

Run:

```bash
OPENCLI_CDP_ENDPOINT=http://127.0.0.1:9222 opencli doctor
```

Expected:

- either successful browser connectivity
- or a clear, captured reason for fallback

**Step 2: Verify data commands manually**

Run:

```bash
OPENCLI_CDP_ENDPOINT=http://127.0.0.1:9222 opencli boss joblist -f json
OPENCLI_CDP_ENDPOINT=http://127.0.0.1:9222 opencli boss recommend --limit 3 -f json
OPENCLI_CDP_ENDPOINT=http://127.0.0.1:9222 opencli boss chatlist --limit 3 -f json
```

Expected:

- structured JSON output when the environment is supported
- otherwise explicit fallback evidence

**Step 3: Verify backend fallback**

Run one source and one chat workflow with `OPENCLI_ENABLED=true` in an environment where opencli probe fails.

Expected:

- run remains successful through Nanobot fallback
- no duplicate callbacks
- run events show why the fallback happened

**Step 4: Verify backend primary path**

Run the same workflows in an environment where opencli is available.

Expected:

- significantly fewer browser recovery events
- same candidate/message/action writeback contracts
- no attachment regression

## Risk Notes

- `opencli` currently blocks execution when Browser Bridge daemon is running but the extension is disconnected, even if `OPENCLI_CDP_ENDPOINT` is set. This must be treated as an environment capability issue, not as business workflow failure.
- `opencli boss resume` reads the right-side profile panel, but does not replace attachment download.
- `opencli` is an external dependency with its own release cadence. Keep the backend integration behind a feature flag and preserve Nanobot fallback until production behavior is stable.

## Recommendation

Phase 1 should ship only after these two gates are satisfied:

1. The environment can reliably run the selected `opencli boss` commands.
2. Nanobot fallback remains intact and fully observable.

Do not attempt a one-shot replacement of the sourcing skill.
