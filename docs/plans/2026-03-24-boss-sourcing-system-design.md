# BOSS Sourcing System Design

Generated on 2026-03-24
Repo: `search-boss`
Status: Draft

## Problem Statement

在现有 `search-boss` 本地项目上，建设一套可运营的 BOSS 寻源管理系统，目标不是单次自动化脚本，而是让 HR 可以稳定地管理岗位、寻源、沟通、索要简历、简历落库和定时跟进，并把所有运行态数据沉淀到 PostgreSQL。

系统必须直接接入真实 BOSS 数据，不使用假数据；`nanobot agent` 继续作为浏览器自动化执行器，管理系统负责任务编排、状态沉淀、规则约束和可视化。

## Current State

- 项目已有 Express + PostgreSQL + Graphile Worker + 原生前端后台。
- 现有数据库已存在真实数据：`jobs=1`，`candidates=25`。
- 已有能力：岗位同步、手动寻源、定时跟进、SSE 事件流、Agent API 回写。
- 现有短板：候选人状态过粗、没有“索要简历”动作级去重、没有聊天回合记录、没有附件指纹、没有幂等事件键。

## Product Goal

让 HR 在一个后台里完成四件事：

1. 管理并同步 BOSS 岗位。
2. 针对岗位启动寻源和打招呼。
3. 对已回复候选人持续沟通，并在不骚扰的前提下索要简历。
4. 管理已打招呼、已沟通、已收简历、已下载简历的候选人资产。

## Non-Negotiable Constraints

- PostgreSQL 是唯一运行态事实来源。
- `nanobot agent` 是唯一浏览器侧执行器，不在后台内直接复刻 BOSS 自动化逻辑。
- skill 必须在关键步骤实时写库，不能任务结束后一次性补写。
- 不能重复索要简历。
- 不能重复更新简历。
- 不能因任务重跑而重复累计统计。
- 不新建与现有数据库冲突的库名；当前默认库沿用 `search_boss_admin`。

## Operating Premises

1. 这是一套内部招聘运营系统，不是对外产品，优先保证稳定和可追踪性。
2. 候选人不能只按 `job + boss_encrypt_geek_id` 扁平建模；需要拆分“人”和“岗位关系”，附件、消息和动作也要独立记录。
3. “是否已索要简历”不能从 `status` 反推，必须有显式动作记录。
4. 定时任务要以幂等为第一原则，同一候选人在一个冷却窗口内不能被重复催简历。
5. skill 是执行层，后台是规则层；重复控制应以后台校验为准，而不是只相信 skill 自觉。

## Approaches Considered

### Approach A: Keep Current Schema, Patch Rules

Summary: 在现有表上继续打补丁，用 `metadata` 塞入更多字段，尽量少改动。

Effort: S
Risk: High

Pros:
- 改动小，短期能快一点。
- 复用现有 API 和前端页面最多。

Cons:
- 动作去重和附件去重会越来越脆弱。
- `metadata` 过重后不可查询、不可审计。
- 后续做运营分析会很痛苦。

### Approach B: Extend Current Architecture with First-Class Workflow Tables

Summary: 保留 Express + Postgres + Graphile Worker + nanobot 架构，在现有项目上补齐动作表、消息表、附件表、候选人阶段字段与幂等键。

Effort: M
Risk: Low

Pros:
- 保持当前代码基础，不推翻已能运行的链路。
- 能明确解决重复索简历、重复下载简历、统计重复累计问题。
- 方便继续做 dashboard 和运营分析。

Cons:
- 需要一次数据库迁移和 skill 契约升级。
- 前端要从“列表页”升级到“运营工作台”。

### Approach C: Split Admin and Worker into Separate Services

Summary: 把后台 API/UI 和 agent orchestration 拆成两个独立服务，通过队列通讯。

Effort: L
Risk: Medium

Pros:
- 长期职责边界更清晰。
- 方便以后扩展多 agent、多渠道招聘。

Cons:
- 现在是过度设计。
- 当前单机本地运行场景没有必要承受额外复杂度。

## Recommendation

选择 Approach B。

原因很直接：现有 `search-boss` 已经把服务骨架、数据库、调度和 nanobot 调用都搭好了，真正缺的是招聘运营语义，而不是再造一套技术栈。继续沿着当前架构补齐一等数据结构，能最快把“能跑”升级成“能运营”。

## Target Architecture

### 1. Execution Layers

- Admin UI: 岗位、候选人、沟通、调度、运行记录的管理台。
- Admin API: 校验、编排、查询、SSE 推送、去重规则。
- Worker Layer: Graphile Worker 按 cron 调度 `sync_jobs` / `followup` / 后续 `resume_reconcile`。
- Agent Layer: `uv run nanobot agent ...` 调用 `/boss-sourcing` skill。
- Data Layer: PostgreSQL 保存岗位、候选人、沟通动作、附件、运行、统计、调度。

### 2. Candidate and Relationship Lifecycle

Oracle 的核心建议是：不要再让一个 `candidates` 表同时承担“候选人主档 + 岗位进展 + 消息历史 + 附件状态”四种职责。更稳妥的模型是把“人”和“岗位关系”分开：

- `people` / `candidate_profiles`: 保存跨岗位稳定存在的候选人主档
- `job_candidates`: 保存某个候选人在某个岗位下的流程状态
- `job_candidate_events`: 保存该关系上的时间线事实
- `outbound_actions`: 保存招呼、跟进、索简历等外发动作
- `resume_artifacts`: 保存简历附件和落盘结果

候选人主状态建议升级为：

- `discovered`
- `matched`
- `greeted`
- `responded`
- `resume_requested`
- `resume_promised`
- `resume_received`
- `resume_downloaded`
- `rejected`
- `closed`

其中 `resume_requested` 不是最终结果，而是一个关键运营动作；系统需要同时记录最近一次索简历时间和累计索简历次数。

### 3. Data Model Changes

#### Revised Core Model

1. `people`
   - `id`
   - `boss_encrypt_geek_id`
   - `name`
   - `city`
   - `education`
   - `experience`
   - `school`
   - `profile_metadata`
   - `UNIQUE(boss_encrypt_geek_id)`

2. `job_candidates`
   - `id`
   - `job_id`
   - `person_id`
   - `lifecycle_status`
   - `guard_status`
   - `last_inbound_at`
   - `last_outbound_at`
   - `last_resume_requested_at`
   - `resume_request_count`
   - `resume_state`
   - `resume_received_at`
   - `next_followup_after`
   - `source_run_id`
   - `UNIQUE(job_id, person_id)`

3. `job_candidate_events`
   - 以追加事件流记录状态变化和人工操作。

4. `outbound_actions`
   - 保存 `greet`、`followup`、`resume_request`、`resume_update` 等动作。
   - 必须有 `dedupe_key` 唯一约束。

5. `resume_artifacts`
   - 保存 BOSS 附件 ID、SHA256、文件路径、下载时间、解析状态。

6. `run_attempts` 或等价字段
   - 保存 run 的 attempt 维度，避免旧回调覆盖当前执行。

#### Keep

- `jobs`
- `daily_job_stats`
- `sourcing_runs`
- `sourcing_run_events`
- `scheduled_jobs`
- `scheduled_job_runs`

#### Replace or Demote

- 现有 `candidates` 不再承担全部运行态职责。
  - 可以过渡成兼容视图，或者逐步迁移为 `people + job_candidates`。

#### Add or Extend

1. `candidate_messages`
   - 每条候选人消息和每条 recruiter 消息各存一条。
   - 字段包含：`job_candidate_id`、`boss_message_id`、`direction`、`message_type`、`content_text`、`sent_at`、`raw_payload`。
   - `UNIQUE(job_candidate_id, boss_message_id)`，解决重复拉历史消息的问题。

2. `candidate_actions`
   - 记录行为级事实：`greet_sent`、`resume_request_sent`、`followup_sent`、`resume_marked_received`、`resume_downloaded`、`candidate_replied`。
   - 字段包含：`job_candidate_id`、`action_type`、`action_key`、`payload`、`created_at`。
   - `action_key` 用于幂等，例如 `resume_request:2026-03-24T13`。

3. `candidate_attachments`
   - 记录简历附件元信息：`job_candidate_id`、`boss_attachment_id`、`file_name`、`mime_type`、`file_size`、`sha256`、`stored_path`、`downloaded_at`。
   - 对 `boss_attachment_id` 和 `sha256` 建唯一约束，双重防重。

4. `run_idempotency_keys`
   - 保存 agent 回写时的幂等键，防止网络重试导致重复增量统计。

## Idempotency Rules

### Resume Request Deduplication

对同一候选人，仅在以下条件全部满足时允许再次索简历：

- `resume_downloaded = false`
- `resume_received_at IS NULL`
- 最近一次 `resume_request_sent` 超过冷却窗口
- 候选人最近有新回复，或超过人工定义的 follow-up 间隔

并且 worker 真正执行前要再次读取当前 `job_candidates` 状态；过期任务只能 `skipped`，不能盲发消息。

### Resume Update Deduplication

任一条件命中都视为已处理，不再重复下载或重复更新：

- `candidate_attachments.boss_attachment_id` 已存在
- `candidate_attachments.sha256` 已存在
- `candidates.resume_downloaded = true AND resume_path IS NOT NULL`
- 本地文件已存在且 SHA/文件名匹配

### Daily Stats Deduplication

不要通过“每次 upsert candidate 都试图推导增量”来累计统计。改为两层机制：

- 行为发生时先写 `candidate_actions`
- 再以 `action_key` 去重后做统计聚合

长期建议是把 `daily_job_stats` 改成事件驱动聚合结果，而不是在候选人 upsert 时顺手推导。

## Skill Contract Changes

现有 skill 草案方向是对的，但需要升级为“版本化动作回写协议”，而不只是候选人 upsert。

必须新增或调整：

1. skill 在发送索简历消息后，调用新的 action API，而不是只把候选人状态改成 `responded`。
2. skill 在拉取聊天消息时，按 message 粒度写入消息表。
3. skill 在检测到简历附件时，先查询候选人和附件状态，再决定是否下载。
4. skill 写候选人时必须附带幂等键，例如：
   - `candidate_sync:<runId>:<geekId>:<messageId or pageNo>`
   - `resume_request:<candidateId>:<ts bucket>`
   - `resume_download:<candidateId>:<attachmentId>`
5. `--followup` 逻辑要从“看见回复就继续聊”改成“按冷却规则决定是否追简历”。
6. 每个回调必须带 `run_id`、`attempt_id`、`event_id`、`sequence`、`timestamp`。
7. skill 不再依赖本地 JSON 或隐式本地状态判断运行结果，后台规则优先。

## API Changes

在现有 `/api/agent` 基础上，新增或调整：

- `POST /api/agent/runs/:runId/messages`
- `POST /api/agent/runs/:runId/actions`
- `GET /api/agent/candidates/:candidateId/followup-decision`
- `POST /api/agent/runs/:runId/attachments`
- 所有接口统一接收版本号和幂等字段

其中 `followup-decision` 由后台统一判断：

- 是否允许发送下一条追简历消息
- 推荐回复模板类型
- 冷却剩余时间
- 是否应该转人工处理

## UI Priorities

当前 `public/index.html` 的问题不是“颜色不像后台”，而是 IA 还停留在单页 dashboard：左侧 rail 不是菜单，而是说明卡；右侧把概览、调度、岗位、run timeline、候选人表全部堆在一页里。对于 TOB 场景，这种结构在数据量、角色分工和日常运营上都会迅速失控。

新的前端必须采用真正的企业后台壳层：

- 固定左侧导航菜单
- 顶部上下文栏（页面标题、面包屑、全局搜索/筛选、用户区）
- 中间内容区只承载当前模块
- 列表/详情、队列/处理、配置/审计分开

### Recommended Admin Shell

#### Global Structure

- `Sidebar`: 一级模块导航
- `Top Bar`: 面包屑、全局搜索、当前岗位/筛选上下文、账户入口
- `Content Outlet`: 当前模块页面
- `Utility Rail` 或页面级右栏：只在需要时展示详情、日志、详情抽屉

#### Recommended Primary Navigation

1. `Command Center`
2. `Triage Inbox`
3. `Job Operations`
4. `Candidate CRM`
5. `Automation Engine`
6. `System Health`

### Default Landing Page: Command Center

首页不再承担全部操作，只承担“总览 + 分发”：

- 今日漏斗指标
- 运行中任务与失败任务
- 待处理异常数量
- 待跟进候选人数量
- 快捷入口：进入 Inbox、岗位、调度中心

首页要回答的是：现在系统整体是否健康，今天先处理什么。

### 1. Dashboard

- 今日招呼数
- 今日回复数
- 今日索简历数
- 今日新收简历数
- 待跟进候选人数
- 需要人工介入人数

### 1.5. Triage Inbox

这是 TOB 场景里最关键的新模块，优先级高于普通看板。

- `Follow-up Queue`: 已回复但待继续沟通的候选人
- `Resume Processing`: 已检测到附件、待确认/待下载/待核验的简历
- `Exception Inbox`: 登录失效、agent 失败、并发冲突、重复候选人、简历下载失败

交互模式参考“邮件客户端”或“工单系统”：

- 左侧队列列表
- 右侧详情与操作面板
- 可批量处理、可筛选、可标记人工接管

### 2. Position Management

- BOSS 同步时间
- 岗位启停状态
- 岗位筛选条件摘要
- 该岗位今日寻源/回复/简历漏斗

这个模块应该是 `Job Operations` 页面，而不是首页中的一块面板。推荐结构：

- 左侧岗位列表
- 右侧岗位详情
- 岗位级操作：同步、手动发起寻源、查看历史 run、查看岗位漏斗

### 3. Candidate Workbench

- 候选人主列表按岗位、状态、是否已索简历、是否已下载简历筛选
- 候选人详情展示完整时间线：打招呼、回复、索简历、收到附件、下载完成
- 候选人详情显示该人是否在其他岗位也出现过，方便人工判断重复触达
- 明确显示：
  - 最近一次索简历时间
  - 已索要次数
  - 是否进入冷却期
  - 是否待下载简历

这个模块应该升级成 `Candidate CRM`：

- 高密度表格
- 多维筛选
- 保存视图
- 详情抽屉或右侧详情页
- 支持跨岗位查看同一候选人的关联情况

### 4. Scheduled Task Center

- 任务类型从当前 `sync_jobs` / `followup` 扩展成：
  - `sync_jobs`
- `source_job`
- `followup`
- `resume_reconcile`（可选）
- 每次任务运行都要能点开看 run timeline。

这个模块应归入 `Automation Engine`，与 run audit、cron 配置、worker 执行记录放在一起，不应出现在首页。

### 5. Exception Inbox

- 登录失效
- agent 执行失败
- 简历下载失败
- follow-up 并发冲突
- 重复候选人待人工合并

### 6. System Health

- SSE/agent 连接状态
- Nanobot 可用性
- 最近 run 失败率
- 调度器健康度
- API 错误趋势

当前左侧 rail 里的“实时信号”应该迁移到这里，同时在首页保留一个精简健康卡片。

## Visual Direction

现有页面的暖色渐变、编辑部式 serif 标题和长页滚动并不适合高频 TOB 运营。推荐改成 `Industrial / Utilitarian Command Center` 风格：

- 以冷灰、白、深蓝为主色，不走消费型营销感
- UI 字体统一为高可读 sans-serif，数据区强调 mono
- 减少大块装饰和说明文案，提升数据密度
- 用 split-pane、固定高度列表、独立滚动容器替代整页长滚动
- 桌面优先，移动端保证可读，不追求完整等功能体验

## Failure Modes to Guard Against

- agent 输出成功但没有调用 `/complete` 或 `/fail`
- 候选人重复回写导致日统计翻倍
- 候选人更换了新附件，但系统因为 `resume_downloaded=true` 直接跳过
- 候选人只是问问题，系统却在 5 分钟内连续多次索简历
- 跟进任务和人工操作同时写候选人，发生状态覆盖
- BOSS 页面消息列表顺序变化导致重复处理历史消息
- 同一岗位被两个 follow-up worker 同时处理
- 上一轮 run 的迟到回调覆盖当前 run 的最新状态

## Implementation Order

1. 先冻结后台拥有的状态机和版本化 Agent API 契约。
2. 再升级数据库模型，优先落地 `people/job_candidates/outbound_actions/resume_artifacts`。
3. 增加 attempt、幂等键、序列号和并发锁。
4. 再扩展 Agent API，使 skill 能写 messages/actions/attachments。
5. 接着改 skill 契约和 nanobot runner 提示词。
6. 然后完善 follow-up 判定服务和恢复语义。
7. 最后升级前端为候选人运营工作台。

## Success Criteria

- 可以同步真实 BOSS 岗位到本地后台。
- 可以针对真实岗位发起寻源并沉淀候选人。
- 定时任务只跟进应该跟进的人，不重复索简历。
- 同一份简历不会重复写数据库、不会重复下载到本地。
- HR 能在后台明确看到岗位漏斗、候选人状态和任务执行细节。
- 任何一次 agent 执行都可以通过 run timeline 复盘。
