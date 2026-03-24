# Search Boss Admin

本地 BOSS 寻源管理后台。支持：

- 从 BOSS 岗位列表同步岗位到后台
- 基于 PostgreSQL 存储岗位、候选人、寻源任务、任务事件与日统计
- 选择具体岗位发起寻源和打招呼
- 对已沟通候选人执行定时跟进，目标是持续索要简历
- 发现简历后下载到本地目录，并把文件路径写入数据库
- 简历下载防重，避免重复落盘
- 通过 SSE 在后台页面实时看到任务进度
- 在后台页面创建、启停、编辑、删除定时任务，并查看最近执行记录
- 从现有 `data/candidates.json` 和 JD markdown 做一次性历史导入
- 通过本机 `nanobot agent` 复用 `boss-sourcing` skill 执行同步与寻源
- 通过 Graphile Worker + PostgreSQL 执行跨平台定时调度

## 当前架构

- 后台页面负责岗位管理、任务管理、执行记录和候选人沉淀
- PostgreSQL 是主数据源，保存岗位、候选人、寻源任务、任务事件、日统计、定时任务和调度执行记录
- `nanobot agent` 是执行器，负责调用你已经加载的 `boss-sourcing` skill
- `boss-sourcing` skill 通过本地 Agent API 实时写库
- Graphile Worker 负责按 cron 表达式触发定时任务
- `data/candidates.json` 只保留为历史导入来源，不参与运行态读写

## 默认数据库

- Host: `127.0.0.1`
- Port: `5432`
- User: `coldxiangyu`
- Password: `coldxiangyu`
- Database: `search_boss_admin`

可通过 `.env` 或环境变量覆盖，示例见 [`.env.example`](/Users/coldxiangyu/work/百融云创/search-boss/.env.example)。

## Nanobot 依赖

- `nanobot` 可通过 `uv run nanobot agent ...` 正常执行
- 配置文件默认使用 `/Users/coldxiangyu/.nanobot-boss/config.json`
- workspace 默认使用 `/Users/coldxiangyu/.nanobot-boss/workspace`
- Chrome 已登录 BOSS 招聘端
- `chrome-devtools` MCP 可访问 `http://127.0.0.1:9222`
- skill 通过本地后台 API 实时写库，默认 `AGENT_API_BASE=http://127.0.0.1:3000`
- skill 调用本地后台 API 时使用 `AGENT_API_TOKEN`

## 使用方式

1. 安装依赖

```bash
npm install
```

2. 初始化数据库

```bash
npm run db:setup
```

3. 导入现有 JSON 历史数据

```bash
npm run db:import
```

4. 启动后台

```bash
npm start
```

打开 `http://127.0.0.1:3000`。

## 后台页面功能

- 岗位管理
  点击“同步岗位”后，后台会调用本机 `nanobot agent`，由 skill 同步 BOSS 岗位列表并实时写入数据库。
- 寻源执行
  在岗位详情里点击“开始寻源”后，会为该岗位创建一条 `sourcing_run`，并把过程事件流实时展示到页面。
- 候选人沉淀
  skill 在寻源、沟通、跟进、简历下载过程中会实时 upsert 候选人信息，包括状态、最后回复时间、简历路径。
- 定时任务管理
  页面支持创建两类任务：
  `sync_jobs`：定时同步岗位列表
  `followup`：定时跟进指定岗位的已沟通候选人，目标是获取简历

## 定时任务说明

- 定时任务配置存储在 `scheduled_jobs`
- 每次实际执行都会记录到 `scheduled_job_runs`
- 当前支持的任务类型：
  `sync_jobs`
  `followup`
- `followup` 任务必须提供 `payload.jobKey`
- cron 表达式会在写入前校验，非法表达式不会入库
- 点击“立即执行”时，不会阻塞页面；任务会进入 worker 队列异步执行
- 这套机制是跨平台的，不依赖 macOS `launchd`、Linux `cron` 或常驻 nanobot gateway

## 说明

- 后台按钮不会直接请求 BOSS 接口，而是调用本机 `nanobot agent`，由 nanobot 复用你现有的 `boss-sourcing` skill 执行。
- nanobot 执行过程中必须通过本地后台 API 实时写 PostgreSQL；运行态不再写入或导入 `data/candidates.json`。
- `followup` 模式会复用同一个 skill，但执行目标不是重新全量寻源，而是检查回复、继续沟通、获取简历、下载新简历。
- 简历文件路径会写入候选人表；如果数据库中已标记 `resume_downloaded=true`，skill 会跳过重复下载。
- 旧的 [`dashboard.html`](/Users/coldxiangyu/work/百融云创/search-boss/dashboard.html) 仍然保留，可作为历史静态看板参考。

## Skill 实时写库接口

- `POST /api/agent/jobs/batch?token=...`
  供 skill 在同步岗位后批量 upsert 岗位
- `GET /api/agent/jobs/:jobKey/candidates/:geekId?token=...`
  供 skill 在下载简历前判断候选人是否已存在、是否已下载简历
- `POST /api/agent/runs/:runId/events?token=...`
  记录过程事件，用于后台时间线和 SSE
- `POST /api/agent/runs/:runId/candidates?token=...`
  实时 upsert 候选人、回复、简历路径
- `POST /api/agent/runs/:runId/progress?token=...`
  更新任务统计
- `POST /api/agent/runs/:runId/complete?token=...`
  标记任务完成
- `POST /api/agent/runs/:runId/fail?token=...`
  标记任务失败

## 关键环境变量

- `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE`
  PostgreSQL 连接信息
- `NANOBOT_CONFIG`
  nanobot 配置文件路径
- `NANOBOT_WORKSPACE`
  nanobot workspace 路径
- `AGENT_API_TOKEN`
  skill 调用本地 Agent API 的认证 token
- `AGENT_API_BASE`
  skill 回写本地后台 API 的地址，默认是当前服务地址

完整示例见 [`.env.example`](/Users/coldxiangyu/work/百融云创/search-boss/.env.example)。

## 验证

- `npm test`
  运行 API、数据库和调度链路测试
- `GET /health`
  检查服务是否正常启动
- `GET /api/scheduled-jobs`
  检查定时任务管理接口是否可用
