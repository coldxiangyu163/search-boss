---
name: boss-sourcing
description: Use when operating BOSS recruitment sourcing workflows from a logged-in Chrome session and the system must sync jobs, source candidates, follow up for resumes, and download resume attachments with backend-enforced idempotency.
metadata:
  nanobot:
    emoji: 👔
    os:
      - darwin
allowed-tools: mcp__chrome-devtools__*
---

# BOSS Sourcing

## Overview

通过 `chrome-devtools` MCP 驱动已登录的 Chrome 招聘端，完成以下业务动作：

1. 同步岗位到本地后台
2. 推荐牛人寻源与打招呼
3. 定时处理候选人回复并在允许时索要简历
4. 下载候选人发送的简历附件并记录到后台

核心原则：

- 后台 API 和 PostgreSQL 是唯一运行态事实来源
- skill 是浏览器执行层，不是业务规则层
- 每一步都必须实时写后台，禁止任务结束后一次性补写
- 所有重复控制都以后台返回结果为准

## When To Use

在以下场景触发本 skill：

- 需要从 BOSS 招聘端同步最新岗位列表
- 需要按岗位抓取推荐牛人并打招呼
- 需要按定时任务处理候选人回复并继续索简历
- 需要识别和下载候选人简历附件

不适用场景：

- Chrome 未登录 BOSS 招聘端
- `chrome-devtools` MCP 不可用
- 本地后台未启动
- 后台返回该候选人处于 `do_not_contact`、`manual_hold` 或岗位已关闭

## Required Runtime Inputs

执行时优先从调用方消息中读取以下变量：

- `项目目录`
- `本地后台 API`
- `Agent Token`
- `运行任务 ID`
- `运行尝试 ID` (`attempt_id`)
- `目标岗位` 和 `目标岗位名称`

如果调用方未显式提供这些变量，默认：

```text
PROJECT_ROOT = ~/work/百融云创/search-boss
RESUME_DIR   = $PROJECT_ROOT/resumes
LOCAL_API    = http://127.0.0.1:3000
API_VERSION  = 2026-03-24
```

## Modes

```text
/boss-sourcing --sync
/boss-sourcing --job "<job_key>" --source
/boss-sourcing --job "<job_key>" --chat
/boss-sourcing --job "<job_key>" --download
/boss-sourcing --job "<job_key>" --followup
/boss-sourcing --status
```

模式定义：

- `--sync`: 同步岗位
- `--source`: 推荐牛人寻源并打招呼
- `--chat`: 处理回复并在允许时继续索简历
- `--download`: 下载已收到的简历
- `--followup`: 等价于 `--chat + --download`
- `--status`: 读取本地后台统计

## Baseline Failure Scenarios To Guard Against

这是当前系统最容易出错的场景，skill 必须显式规避：

1. 候选人 10 分钟前刚被索要简历，定时任务又发一次，造成重复催要。
2. 候选人已经发过简历，系统只看聊天列表没看后台状态，重复下载和重复写库。
3. 同一条聊天消息被反复拉取，导致回复数、索简历数重复累计。
4. 上一次 run 的迟到回调写回当前 run，覆盖最新状态。
5. 跟进任务在入队时可执行，但真正执行时候选人已被人工处理，仍然继续自动发消息。

## Versioned Local API Contract

所有请求都必须带上：

- `token`
- `v=2026-03-24`
- `run_id`
- `attempt_id`
- `event_id`
- `sequence`
- `occurred_at`

调用方式示例：

```js
const API_BASE = "http://127.0.0.1:3000";
const TOKEN = "search-boss-local-agent";
const API_VERSION = "2026-03-24";

async function postLocal(path, payload) {
  const resp = await fetch(`${API_BASE}${path}?token=${encodeURIComponent(TOKEN)}&v=${API_VERSION}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) throw new Error(`Local API failed: ${resp.status}`);
  return resp.json();
}

async function getLocal(path) {
  const resp = await fetch(`${API_BASE}${path}?token=${encodeURIComponent(TOKEN)}&v=${API_VERSION}`);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Local API failed: ${resp.status}`);
  return resp.json();
}
```

必用接口：

- `POST /api/agent/jobs/batch`
- `POST /api/agent/runs/:runId/events`
- `POST /api/agent/runs/:runId/progress`
- `POST /api/agent/runs/:runId/candidates`
- `POST /api/agent/runs/:runId/messages`
- `POST /api/agent/runs/:runId/actions`
- `POST /api/agent/runs/:runId/attachments`
- `GET /api/agent/jobs/:jobKey/candidates/:geekId`
- `GET /api/agent/candidates/:candidateId/followup-decision`
- `POST /api/agent/runs/:runId/complete`
- `POST /api/agent/runs/:runId/fail`

## Event Identity Rules

每次回写都必须唯一可重放：

- `event_id`: 当前回写事件的全局唯一 ID
- `sequence`: 同一个 run/attempt 内单调递增
- `attempt_id`: 同一个 `run_id` 下的当前执行尝试

推荐 key：

- 岗位同步: `job-sync:<jobKey>`
- 候选人同步: `candidate-sync:<runId>:<attemptId>:<geekId>:<pageNo>`
- 消息写入: `message:<jobCandidateId or geekId>:<bossMessageId>`
- 索简历动作: `resume-request:<jobCandidateId>:<timeBucket>`
- 简历下载动作: `resume-download:<jobCandidateId>:<bossAttachmentId or sha256>`

## Workflow

### 0. Bootstrap

1. 确认 Chrome 已打开并连接到 `chrome-devtools`
2. 确认 BOSS 招聘端已登录
3. 确认本地后台可访问
4. 如果带 `运行任务 ID`，先写启动事件：

```js
await postLocal(`/api/agent/runs/${RUN_ID}/events`, {
  runId: RUN_ID,
  attemptId: ATTEMPT_ID,
  eventId: `bootstrap:${RUN_ID}:${ATTEMPT_ID}`,
  sequence: 1,
  occurredAt: new Date().toISOString(),
  eventType: 'agent_bootstrap',
  stage: 'bootstrap',
  message: '已进入 BOSS 招聘端，准备执行任务',
  progressPercent: 0
});
```

### 1. 岗位同步 `--sync`

1. 获取岗位列表
2. 规范化为：

```json
{
  "jobKey": "健康顾问_B0047007",
  "encryptJobId": "xxx",
  "jobName": "健康顾问（B0047007）",
  "salary": "5-6K",
  "city": "重庆",
  "status": "open"
}
```

3. 立即调用：

```js
await postLocal('/api/agent/jobs/batch', {
  runId: null,
  attemptId: null,
  eventId: `job-sync:${Date.now()}`,
  sequence: 1,
  occurredAt: new Date().toISOString(),
  jobs
});
```

禁止写入任何本地 JSON 作为运行态存储。

### 2. 寻源打招呼 `--source`

业务目标：

- 选定岗位，抓取推荐牛人
- 按岗位要求筛选
- 只对未打过招呼的人打招呼
- 每个候选人的事实、动作、进度实时写后台

每页流程：

1. 写 `page_fetch_started` 事件
2. 拉取推荐牛人
3. 对每个候选人：
   - 先调用 `GET /api/agent/jobs/:jobKey/candidates/:geekId`
   - 若后台显示已打招呼或处于不可联系状态，直接跳过
   - 否则执行打招呼
   - 立即写候选人当前快照
   - 再写一条 `greet` 动作
4. 每页结束调用 `/progress`

候选人快照示例：

```js
await postLocal(`/api/agent/runs/${RUN_ID}/candidates`, {
  runId: RUN_ID,
  attemptId: ATTEMPT_ID,
  eventId: `candidate-sync:${RUN_ID}:${ATTEMPT_ID}:${geek.encryptGeekId}:page-${PAGE}`,
  sequence: nextSequence(),
  occurredAt: new Date().toISOString(),
  bossEncryptGeekId: geek.encryptGeekId,
  name: geek.name,
  education: geek.degree,
  experience: geek.workYear,
  expectedSalary: geek.salary,
  city: geek.city,
  age: geek.age,
  school: geek.school,
  position: geek.position,
  status: greeted ? 'greeted' : matched ? 'matched' : 'filtered_out',
  greetedAt: greeted ? new Date().toISOString() : null,
  metadata: {
    expectId: geek.expectId,
    lid: geek.lid,
    securityId: geek.securityId,
    isFriend: geek.isFriend
  }
});
```

动作写入示例：

```js
await postLocal(`/api/agent/runs/${RUN_ID}/actions`, {
  runId: RUN_ID,
  attemptId: ATTEMPT_ID,
  eventId: `greet:${RUN_ID}:${ATTEMPT_ID}:${geek.encryptGeekId}`,
  sequence: nextSequence(),
  occurredAt: new Date().toISOString(),
  actionType: 'greet_sent',
  dedupeKey: `greet:${JOB_KEY}:${geek.encryptGeekId}`,
  bossEncryptGeekId: geek.encryptGeekId,
  payload: { page: PAGE }
});
```

### 3. 消息处理 `--chat`

业务目标：

- 读取候选人新消息
- 按消息粒度写后台
- 只有后台允许时才继续索简历

#### 3a. 先写消息，再做决策

每读到一条消息，先写：

```js
await postLocal(`/api/agent/runs/${RUN_ID}/messages`, {
  runId: RUN_ID,
  attemptId: ATTEMPT_ID,
  eventId: `message:${bossMessageId}`,
  sequence: nextSequence(),
  occurredAt: messageTime,
  bossEncryptGeekId: geekId,
  bossMessageId,
  direction: 'inbound',
  messageType: 'text',
  contentText: messageText,
  rawPayload: rawMessage
});
```

#### 3b. 跟进前必须问后台

在发送下一条消息前，必须查询：

```js
const decision = await getLocal(`/api/agent/candidates/${candidateId}/followup-decision`);
```

只有 `decision.allowed === true` 才允许继续索简历。

如果 `allowed === false`：

- 不发送消息
- 写一条 `followup_skipped` 动作
- 原因使用后台返回的 `reason`

#### 3c. 允许发送时再写动作

发送索简历消息后：

```js
await postLocal(`/api/agent/runs/${RUN_ID}/actions`, {
  runId: RUN_ID,
  attemptId: ATTEMPT_ID,
  eventId: `resume-request:${candidateId}:${decision.timeBucket}`,
  sequence: nextSequence(),
  occurredAt: new Date().toISOString(),
  actionType: 'resume_request_sent',
  dedupeKey: `resume-request:${candidateId}:${decision.timeBucket}`,
  bossEncryptGeekId: geekId,
  payload: {
    templateType: decision.recommendedAction,
    reason: decision.reason
  }
});
```

### 4. 简历下载 `--download`

业务目标：

- 识别聊天中的简历附件
- 下载到 `resumes/{jobKey}/`
- 以附件 ID 或 SHA 去重

下载前必须做两次检查：

1. 查询候选人当前状态：

```js
const existing = await getLocal(`/api/agent/jobs/${encodeURIComponent(JOB_KEY)}/candidates/${encodeURIComponent(GEEK_ID)}`);
```

2. 先登记附件元信息：

```js
const attachmentRecord = await postLocal(`/api/agent/runs/${RUN_ID}/attachments`, {
  runId: RUN_ID,
  attemptId: ATTEMPT_ID,
  eventId: `attachment:${bossAttachmentId}`,
  sequence: nextSequence(),
  occurredAt: new Date().toISOString(),
  bossEncryptGeekId: GEEK_ID,
  bossAttachmentId,
  fileName,
  mimeType,
  fileSize,
  sha256: null,
  status: 'discovered'
});
```

如果后台返回 `alreadyProcessed=true`，直接跳过，不下载。

下载完成后再回写：

```js
await postLocal(`/api/agent/runs/${RUN_ID}/attachments`, {
  runId: RUN_ID,
  attemptId: ATTEMPT_ID,
  eventId: `attachment-downloaded:${bossAttachmentId}`,
  sequence: nextSequence(),
  occurredAt: new Date().toISOString(),
  bossEncryptGeekId: GEEK_ID,
  bossAttachmentId,
  fileName,
  sha256,
  storedPath: `resumes/${JOB_KEY}/${fileName}`,
  status: 'downloaded'
});
```

然后写一条动作：

```js
await postLocal(`/api/agent/runs/${RUN_ID}/actions`, {
  runId: RUN_ID,
  attemptId: ATTEMPT_ID,
  eventId: `resume-download:${candidateId}:${bossAttachmentId || sha256}`,
  sequence: nextSequence(),
  occurredAt: new Date().toISOString(),
  actionType: 'resume_downloaded',
  dedupeKey: `resume-download:${candidateId}:${bossAttachmentId || sha256}`,
  bossEncryptGeekId: GEEK_ID,
  payload: { storedPath: `resumes/${JOB_KEY}/${fileName}` }
});
```

### 5. 任务结束

成功结束：

```js
await postLocal(`/api/agent/runs/${RUN_ID}/complete`, {
  runId: RUN_ID,
  attemptId: ATTEMPT_ID,
  eventId: `run-complete:${RUN_ID}:${ATTEMPT_ID}`,
  sequence: nextSequence(),
  occurredAt: new Date().toISOString(),
  pagesProcessed,
  candidatesSeen,
  candidatesMatched,
  greetingsSent,
  message: 'skill 执行完成'
});
```

失败结束：

```js
await postLocal(`/api/agent/runs/${RUN_ID}/fail`, {
  runId: RUN_ID,
  attemptId: ATTEMPT_ID,
  eventId: `run-fail:${RUN_ID}:${ATTEMPT_ID}`,
  sequence: nextSequence(),
  occurredAt: new Date().toISOString(),
  message: error.message
});
```

## Scheduled Follow-up

定时任务目标不是“保持聊天活跃”，而是“在合适时机拿到简历”。

推荐频率：

- `--chat`: 每 10-15 分钟一次
- `--download`: 每 10-15 分钟一次
- 或统一执行 `--followup`

但注意：即使任务被调度，也必须在执行时再次读取后台决策。任务排队不等于允许发消息。

## Quick Reference

| 场景 | 必做动作 | 禁止动作 |
|---|---|---|
| 新候选人同步 | 写 candidate 快照 | 只打印日志不写库 |
| 打招呼成功 | 写 candidate + `greet_sent` action | 仅更新 status |
| 收到候选人回复 | 先写 `messages` | 先回复再补写消息 |
| 准备索简历 | 先查 `followup-decision` | 直接发消息 |
| 发现附件 | 先登记 attachment | 先下载后判断是否重复 |
| 下载完成 | 写 attachment + `resume_downloaded` action | 只改 `resumeDownloaded=true` |

## Common Mistakes

- 只在任务结束时一次性写后台
- 不带 `attempt_id`、`event_id`、`sequence`
- 定时任务不查后台 decision 就重复索简历
- 看到附件就直接下载，不先登记附件元信息
- 只更新 candidate `status`，不写 `messages/actions/attachments`
- 仍然依赖本地 JSON 或隐式本地状态判断是否已处理

## Error Handling

- 登录过期: 立即停止并调用 `/fail`
- 本地后台 API 失败: 重试 1 次，仍失败则终止当前任务
- API 返回“不允许发送”: 记录 `followup_skipped`，不要硬发
- 发现重复附件: 记录跳过事件，不下载
- 发现旧 `attempt_id` 被拒绝: 立即停止当前 run，避免覆盖新执行
