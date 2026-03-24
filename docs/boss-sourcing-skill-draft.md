---
name: boss-sourcing
description: Use when operating BOSS recruitment sourcing workflows from a logged-in Chrome session, including syncing jobs, sourcing candidates, following up for resumes, and downloading resumes without duplication.
metadata:
  nanobot:
    emoji: 👔
    os:
      - darwin
allowed-tools: mcp__chrome-devtools__*
---

# BOSS Sourcing

## Overview

通过 `chrome-devtools` MCP 驱动已登录的 Chrome 招聘端，完成四类业务动作：

1. 同步岗位到本地后台和数据库
2. 推荐牛人寻源与打招呼
3. 定时执行沟通跟进，核心目标是索取简历
4. 下载候选人已发送的简历，写入本地目录并记录数据库路径，避免重复下载

核心原则：

- 本地后台数据库是主存储
- `data/candidates.json` 是兼容快照，不再是唯一事实来源
- 每个关键步骤都要调用本地后台 API，实时写入任务进度和候选人状态
- 所有回复策略都以“获取简历”为中心

## When To Use

在以下场景触发本 skill：

- 需要从 BOSS 招聘端同步最新岗位列表
- 需要按岗位批量筛选推荐牛人并打招呼
- 需要定时检查候选人回复并继续追要简历
- 需要识别聊天里的简历附件并下载到本地
- 需要把岗位、候选人、简历路径、任务进度实时写入本地后台数据库

不适用场景：

- Chrome 未登录 BOSS 招聘端
- `chrome-devtools` MCP 不可用
- 本地后台服务未启动

## Required Runtime Inputs

执行时优先从调用方消息中读取以下变量：

- `项目目录`
- `数据文件`
- `本地后台 API`
- `Agent Token`
- `运行任务 ID`，仅寻源/跟进/下载流程必填
- `目标岗位` 和 `目标岗位名称`

如果调用方未显式提供这些变量，默认：

```text
PROJECT_ROOT = ~/work/百融云创/search-boss
DATA_FILE    = $PROJECT_ROOT/data/candidates.json
RESUME_DIR   = $PROJECT_ROOT/resumes
LOCAL_API    = http://127.0.0.1:3000
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

- `--sync`：同步岗位
- `--source`：推荐牛人寻源并打招呼
- `--chat`：处理回复并继续索要简历
- `--download`：下载已收到的简历
- `--followup`：等价于 `--chat --download`
- `--status`：读取本地后台或快照，输出当前统计

## Local API Contract

所有请求默认使用：

```js
const API_BASE = "http://127.0.0.1:3000";
const TOKEN = "search-boss-local-agent";
```

调用方式示例：

```js
async function postLocal(path, payload) {
  const resp = await fetch(`${API_BASE}${path}?token=${encodeURIComponent(TOKEN)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) throw new Error(`Local API failed: ${resp.status}`);
  return resp.json();
}

async function getLocal(path) {
  const resp = await fetch(`${API_BASE}${path}?token=${encodeURIComponent(TOKEN)}`);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Local API failed: ${resp.status}`);
  return resp.json();
}
```

必须使用的接口：

- `POST /api/agent/jobs/batch`
- `GET /api/agent/jobs/:jobKey/candidates/:geekId`
- `POST /api/agent/runs/:runId/events`
- `POST /api/agent/runs/:runId/candidates`
- `POST /api/agent/runs/:runId/progress`
- `POST /api/agent/runs/:runId/complete`
- `POST /api/agent/runs/:runId/fail`

## Workflow

### 0. Bootstrap

1. 确认 Chrome 已打开并连接到 `chrome-devtools`
2. 确认 BOSS 招聘端已登录
3. 确保本地目录存在

```bash
mkdir -p ~/work/百融云创/search-boss/data
mkdir -p ~/work/百融云创/search-boss/resumes
```

4. 如果是带 `运行任务 ID` 的流程，先写一条启动事件：

```js
await postLocal(`/api/agent/runs/${RUN_ID}/events`, {
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

3. 更新 `DATA_FILE.jobs`
4. 立即调用：

```js
await postLocal('/api/agent/jobs/batch', { jobs });
```

### 2. 寻源打招呼 `--source`

业务目标：

- 选定岗位，抓取推荐牛人
- 按 JD 和岗位城市/学历要求筛选
- 只对未打过招呼的人打招呼
- 候选人状态、任务进度、统计实时写库

每页流程：

1. 发送 `page_fetch_started`
2. 拉取推荐牛人
3. 对每个候选人：
   - 判断是否满足岗位要求
   - 若命中且未打过招呼，执行打招呼
   - 立即调用 `/api/agent/runs/:runId/candidates`
4. 每页结束调用 `/progress`

候选人实时写库示例：

```js
await postLocal(`/api/agent/runs/${RUN_ID}/candidates`, {
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

### 3. 沟通跟进 `--chat`

业务目标：

- 定时处理候选人回复
- 回复的第一优先级永远是获取简历

回复策略：

- 候选人感兴趣：先简述岗位亮点，再索取简历
- 询问薪资福利：给范围，但落点仍然是“发简历便于推进”
- 只问地点/上班方式：简答后继续索要简历
- 明确拒绝：标记 `rejected`
- 已发简历：标记 `resume_received`

每次读取到候选人新消息后：

```js
await postLocal(`/api/agent/runs/${RUN_ID}/candidates`, {
  bossEncryptGeekId: geekId,
  name,
  status: hasResume ? 'resume_received' : isRejected ? 'rejected' : 'responded',
  lastMessageAt: new Date().toISOString(),
  notes: summary
});
```

### 4. 简历下载 `--download`

业务目标：

- 识别聊天中的简历附件
- 下载到 `resumes/{jobKey}/`
- 数据库保存 `resumePath`
- 不重复下载

下载前必须先查询本地后台：

```js
const existing = await getLocal(`/api/agent/jobs/${encodeURIComponent(JOB_KEY)}/candidates/${encodeURIComponent(GEEK_ID)}`);
if (existing?.resumeDownloaded && existing?.resumePath) {
  // 已下载，直接跳过
}
```

下载规则：

- 目录：`resumes/{jobKey}/`
- 文件名：`{候选人姓名}_{encryptGeekId}.pdf`
- 如果本地已存在同名文件，也视为已下载，直接写库确认即可

下载完成后立即写库：

```js
await postLocal(`/api/agent/runs/${RUN_ID}/candidates`, {
  bossEncryptGeekId: geekId,
  name,
  status: 'resume_downloaded',
  lastMessageAt: new Date().toISOString(),
  resumeDownloaded: true,
  resumePath: `resumes/${JOB_KEY}/${fileName}`,
  notes: '已下载简历'
});
```

### 5. 任务结束

成功结束：

```js
await postLocal(`/api/agent/runs/${RUN_ID}/complete`, {
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
  message: error.message
});
```

## Scheduled Follow-up

定时任务的目标不是“聊天活跃度”，而是“尽快拿到简历”。

建议调度频率：

- `--chat`：每 10 到 15 分钟执行一次
- `--download`：每 10 到 15 分钟执行一次
- 或统一执行 `--followup`

外部调度示例：

```bash
uv run nanobot agent --config "/Users/coldxiangyu/.nanobot-boss/config.json" --message "/boss-sourcing --job \"健康顾问_B0047007\" --followup"
```

## Error Handling

- 登录过期：立即停止并上报 `run_failed`
- API 返回非 0：记录事件，跳过当前候选人
- 本地后台 API 失败：重试 1 次，仍失败则停止当前任务
- 候选人已是好友：跳过打招呼，但仍可跟进聊天
- 简历已下载：禁止重复下载

## Common Mistakes

- 只更新 `candidates.json`，不调用本地后台 API
- 下载简历前不查询候选人当前状态，导致重复下载
- 回复候选人时只答问题，不继续索要简历
- 任务结束后没有调用 `/complete` 或 `/fail`
