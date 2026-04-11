# search-boss 多渠道招聘平台改造设计方案

> 面向对象：产品负责人、架构设计、后端开发、自动化执行开发、运维
>
> 适用项目：`/Users/coldxiangyu/work/百融云创/search-boss`
>
> 文档用途：作为从“BOSS 直聘专用系统”演进到“多招聘渠道统一控制平台”的总体设计文档，可直接复制到飞书文档使用。

---

## 1. 背景与目标

当前 `search-boss` 已经具备以下能力：

- 岗位同步
- 候选人管理
- 寻源 / 打招呼 / 跟进 / 下载简历
- 定时调度
- 运行事件回写
- 多 HR / 多浏览器实例的企业版雏形

但当前系统的执行链路、数据模型、Prompt 契约、浏览器自动化实现均明显围绕 BOSS 直聘构建，尚不具备平滑扩展到智联、猎聘、58 等渠道的能力。

### 1.1 本次改造目标

将 `search-boss` 从单渠道系统升级为“多渠道招聘控制平台”，支持：

1. 统一管理多个招聘平台账号
2. 统一编排岗位同步、候选人寻源、沟通跟进、简历下载
3. 保持 PostgreSQL 为唯一运行态事实来源
4. 保持现有后台、调度、运行记录、回写机制继续可用
5. 允许不同渠道采用不同执行方式，但回到统一的数据与任务模型

### 1.2 本次改造非目标

本阶段不包含：

- 一次性同时完整接入所有新渠道
- 分布式多服务彻底拆分
- SaaS 多租户彻底重构
- BI 报表体系重建
- AI 策略层大幅改造

本阶段的核心目标是：

> 先把“平台/渠道”抽象成一等概念，再接入第一个新渠道验证架构正确性。

---

## 2. 现状问题分析

基于对当前代码库的检查，现状存在以下核心问题。

### 2.1 数据模型对 BOSS 强耦合

当前核心表直接内置 BOSS 字段：

- `jobs.boss_encrypt_job_id`
- `people.boss_encrypt_geek_id`
- `candidate_messages.boss_message_id`
- `candidate_attachments.boss_attachment_id`
- `boss_recruit_snapshots`

这意味着系统默认把 BOSS 的 ID 体系视为通用主键体系，导致：

- 多渠道无法共享统一唯一键设计
- 新渠道接入后必须继续堆叠平台专有字段
- 查询、去重、统计、迁移复杂度急剧升高

### 2.2 执行器接口对 BOSS 强耦合

当前核心执行模块直接以 BOSS 命名：

- `boss-cdp-client.js`
- `boss-browser-commands.js`
- `boss-cli-runner.js`
- `boss-context-store.js`
- `boss-session-store.js`

说明当前系统并未建立“平台适配层”，而是将“BOSS 平台本身”直接写进核心运行时。

### 2.3 Prompt / Skill / 回写契约对 BOSS 强耦合

当前 Prompt builder 生成的执行指令统一为：

- `/boss-sourcing --source`
- `/boss-sourcing --followup`
- `/boss-sourcing --chat`
- `/boss-sourcing --download`
- `/boss-sourcing --sync`

同时，回写契约要求：

- `bossEncryptGeekId`
- `bossEncryptJobId`

这意味着就算后端表先扩了新平台，AI 执行层仍然无法自然支持多渠道。

### 2.4 浏览器自动化逻辑对 zhipin.com 强耦合

现有实现中，URL、页面结构、操作流程都默认指向 BOSS：

- 推荐页
- 聊天页
- 岗位筛选
- 简历预览与下载
- CDP target URL 前缀

如果继续沿此路径扩智联/猎聘/58，将在页面识别、流程控制、错误恢复、反风控策略等方面形成大量分叉逻辑。

### 2.5 企业版多账号能力尚未抽象到“平台账号”层

当前企业版模型中已有：

- `hr_accounts`
- `boss_accounts`
- `browser_instances`

说明系统已经具备“HR -> 执行账号 -> 浏览器实例”的雏形，但执行账号仍然是 `boss_accounts`，而不是通用的渠道账号。

---

## 3. 总体设计原则

### 3.1 平台是第一层抽象，不再是 metadata

后续所有核心对象都必须显式带有 `provider` / `channel` 概念，而不是把渠道差异塞进 `metadata`。

### 3.2 控制平面统一，执行平面可差异化

统一的是：

- 任务模型
- 运行记录
- 回写契约
- 候选人资产沉淀
- 调度与权限

可差异化的是：

- 页面自动化方式
- 平台接口适配方式
- 账号登录与会话保持方式
- 渠道专属的风控策略

### 3.3 PostgreSQL 继续作为唯一事实来源

任何平台执行结果，都必须实时沉淀到 PostgreSQL，而不是只保存在 skill memory、临时文件或浏览器状态中。

### 3.4 兼容迁移优先，避免一次性推翻

不建议一次性删除所有 BOSS 字段，而是应采取：

- 新增平台中立字段
- 保留旧字段兼容
- 逐步迁移读写路径
- 最终清理历史字段

### 3.5 第一个新渠道必须作为架构验收样板

不建议三家同时接。先通过一个新渠道验证：

- 数据模型是否足够中立
- 任务模型是否足够复用
- 执行器抽象是否正确
- 回写协议是否足够稳定

---

## 4. 目标架构

## 4.1 架构分层

建议将系统明确划分为五层：

### A. Admin UI 层

负责：

- 岗位管理
- 候选人管理
- 任务发起
- 运行监控
- 渠道账号管理
- 浏览器实例管理

### B. Control Plane 层

负责：

- 统一任务编排
- 统一运行生命周期
- 调度
- 幂等控制
- 权限校验
- 平台适配器选择

### C. Provider Adapter 层

按平台实现统一接口，例如：

- `boss`
- `zhilian`
- `liepin`
- `wuba`

每个 provider 负责：

- 岗位同步实现
- 候选人寻源实现
- 沟通跟进实现
- 附件下载实现
- 平台上下文构建

### D. Executor 层

用于承接实际浏览器 / agent / 脚本执行：

- Nanobot skill
- CDP runner
- 浏览器自动化指令
- 平台 API / DOM 操作

### E. Data Layer

统一沉淀：

- jobs
- people
- job_candidates
- candidate_messages
- candidate_actions
- candidate_attachments
- sourcing_runs
- sourcing_run_events
- scheduled_jobs
- scheduled_job_runs
- provider_accounts
- browser_instances

---

## 4.2 目标调用链

统一调用链建议如下：

1. UI / API 发起任务
2. Control Plane 创建 `sourcing_runs`
3. 根据任务的 `provider` 选择对应 `Provider Adapter`
4. Adapter 构建平台执行上下文
5. Executor 执行平台动作
6. 执行结果通过统一 callback 协议回写
7. Control Plane 写入 PostgreSQL 并更新 run 状态
8. UI 实时展示事件流与业务结果

---

## 5. 核心领域模型改造

## 5.1 核心变化总览

当前系统需要从“BOSS 平台内建主键”改为“平台 + 外部 ID”的组合模型。

### 目标原则

所有跨平台实体统一采用以下模式：

- `provider`：平台类型
- `external_*_id`：平台外部 ID
- `raw_payload` / `metadata`：保留平台原始结构

---

## 5.2 jobs 表改造建议

### 当前问题

- 使用 `boss_encrypt_job_id` 作为主外部标识
- `source` 字段虽存在，但只是标签，不是核心约束的一部分

### 目标结构

建议新增：

- `provider text not null`
- `external_job_id text not null`
- `provider_job_code text null`
- `provider_metadata jsonb not null default '{}'::jsonb`

建议唯一约束改为：

- `unique(provider, external_job_id)`

保留兼容字段：

- `boss_encrypt_job_id` 暂时保留，只作为 Boss provider 的兼容字段

---

## 5.3 people / candidate_profiles 改造建议

### 当前问题

- `people` 表以 `boss_encrypt_geek_id` 为唯一键
- 这隐含“候选人跨平台身份可忽略”的假设

### 目标策略

建议拆分为两层：

#### 方案 A：温和演进（推荐）

保留 `people`，新增：

- `provider text`
- `external_candidate_id text`
- `identity_confidence text`
- `merge_key text`（用于后续跨平台合并）

唯一约束：

- `unique(provider, external_candidate_id)`

#### 方案 B：长期理想模型

拆成：

- `person_profiles`：内部人才主档
- `provider_candidates`：平台侧候选人映射

本阶段建议先用方案 A，避免改造过重。

---

## 5.4 candidate_messages 改造建议

### 当前问题

当前唯一性围绕：

- `boss_message_id`

### 目标结构

建议新增：

- `provider text not null`
- `external_message_id text`
- `thread_external_id text`
- `raw_payload jsonb not null default '{}'::jsonb`

唯一约束建议改为：

- `unique(job_candidate_id, provider, external_message_id)`

若某些平台没有稳定消息 ID，则允许：

- `external_message_id` 为空
- 退化使用消息指纹 dedupe key

---

## 5.5 candidate_attachments 改造建议

### 当前问题

当前字段：

- `boss_attachment_id`

### 目标结构

建议新增：

- `provider text not null`
- `external_attachment_id text`
- `attachment_fingerprint text`
- `download_source_url text`

唯一性建议：

- `unique(provider, external_attachment_id)` where not null
- `unique(sha256)` where not null

这样既能兼容平台原始附件 ID，也能继续保持按内容去重。

---

## 5.6 渠道账号模型改造建议

### 当前问题

当前是：

- `boss_accounts`

它无法承载：

- 智联账号
- 猎聘账号
- 58 账号

### 目标结构

新增或重构为：

#### `provider_accounts`

字段建议：

- `id`
- `hr_account_id`
- `provider` 例如 `boss | zhilian | liepin | wuba`
- `account_login_name`
- `display_name`
- `status`
- `session_strategy`
- `metadata`
- `created_at`
- `updated_at`

唯一约束建议：

- `unique(hr_account_id, provider, account_login_name)`

### 兼容方式

- 短期：保留 `boss_accounts`，新增 `provider_accounts`
- 中期：通过迁移脚本将 boss 数据转入 `provider_accounts`
- 长期：废弃 `boss_accounts`

---

## 5.7 浏览器实例模型改造建议

### 当前问题

当前浏览器实例依赖 `boss_account_id`。

### 目标结构

建议 `browser_instances` 关联改为：

- `provider_account_id`

并补充：

- `provider`
- `worker_host`
- `execution_mode`（`cdp`, `nanobot`, `api`, `hybrid`）
- `capabilities jsonb`

能力示例：

- `supports_job_sync`
- `supports_chat`
- `supports_resume_download`
- `supports_unread_filter`

这样未来可以容纳不同平台使用不同执行模式。

---

## 6. Provider Adapter 设计

## 6.1 目标

为每个平台定义统一接口，Control Plane 只依赖接口，不依赖具体实现。

## 6.2 推荐目录结构

```text
src/providers/
  index.js
  shared/
    provider-types.js
    provider-errors.js
    provider-contracts.js
  boss/
    boss-provider.js
    boss-job-sync.js
    boss-source.js
    boss-chat.js
    boss-download.js
  zhilian/
    zhilian-provider.js
    zhilian-job-sync.js
    zhilian-source.js
    zhilian-chat.js
    zhilian-download.js
  liepin/
    liepin-provider.js
    liepin-job-sync.js
    liepin-source.js
    liepin-chat.js
    liepin-download.js
  wuba/
    wuba-provider.js
    wuba-job-sync.js
    wuba-source.js
    wuba-chat.js
    wuba-download.js
```

## 6.3 统一 Provider 接口

每个 provider 应至少实现：

- `syncJobs()`
- `startSourceRun()`
- `startFollowupRun()`
- `startChatRun()`
- `startDownloadRun()`
- `buildJobContext()`
- `normalizeCandidate()`
- `normalizeMessage()`
- `normalizeAttachment()`
- `resolveExecutionAccount()`

## 6.4 能力声明机制

不同平台能力不同，不应强行假设完全一致。

建议 provider 声明能力：

```json
{
  "supportsJobSync": true,
  "supportsSource": true,
  "supportsChat": true,
  "supportsResumeDownload": true,
  "supportsUnreadFilter": false,
  "supportsDeterministicLoop": true
}
```

Control Plane 根据能力来决定：

- 是否允许某类任务
- UI 是否展示某类按钮
- 调度是否创建某类任务

---

## 7. 执行器与 Prompt 合约改造

## 7.1 从 `/boss-sourcing` 升级为平台中立入口

当前问题：

- Prompt builder 写死 `/boss-sourcing`
- 这会迫使所有新平台都伪装成 BOSS

### 推荐方案

升级为两层：

#### 方案 A：统一入口

例如：

- `/recruiting-source --provider boss`
- `/recruiting-source --provider zhilian`

#### 方案 B：平台子 skill + 上层统一 builder

例如：

- `boss-sourcing`
- `zhilian-sourcing`
- `liepin-sourcing`

但 Prompt builder 不再直接写死 Boss，而是通过 provider 选择。

### 推荐结论

本项目更适合 **方案 B**：

- 平台执行流程差异大
- 每个平台单独维护 skill 更自然
- Control Plane 仍保持统一

---

## 7.2 统一 callback 协议

当前回写协议中的业务字段带 Boss 命名，不利于多平台。

### 目标协议原则

所有 callback 顶层必须显式携带：

- `provider`
- `runId`
- `jobKey`
- `externalJobId`
- `externalCandidateId`
- `externalMessageId`
- `externalAttachmentId`

Boss 特有字段可放入：

- `providerPayload`
- `metadata`
- `rawPayload`

### 示例

#### 候选人回写

```json
{
  "provider": "boss",
  "jobKey": "xxx",
  "externalJobId": "boss_job_xxx",
  "externalCandidateId": "boss_geek_xxx",
  "name": "张三",
  "status": "greeted",
  "city": "北京",
  "education": "本科",
  "experience": "5年",
  "metadata": {},
  "providerPayload": {
    "bossEncryptGeekId": "xxx"
  }
}
```

#### 消息回写

```json
{
  "provider": "zhilian",
  "jobKey": "xxx",
  "externalCandidateId": "zl_candidate_xxx",
  "externalMessageId": "zl_msg_xxx",
  "direction": "inbound",
  "messageType": "text",
  "contentText": "您好",
  "sentAt": "2026-04-11T10:00:00Z",
  "rawPayload": {}
}
```

---

## 7.3 执行方式抽象

不同渠道不一定都适合完全相同的执行模式。

建议支持以下执行模式：

- `cdp_dom`：CDP + DOM 操作
- `nanobot_skill`：agent skill 驱动
- `http_api`：页面内 fetch / 平台 API
- `hybrid`：多方式混合

Control Plane 不应假设所有 provider 都走相同技术路径。

---

## 8. 调度与任务模型改造

## 8.1 sourcing_runs 增加 provider 维度

建议新增：

- `provider text not null`
- `provider_account_id bigint`
- `execution_mode text`

这样一条 run 的身份从：

- `job + mode`

升级为：

- `provider + provider_account + job + mode`

---

## 8.2 scheduled_jobs 增加 provider 维度

当前定时任务主要围绕 job 与 HR。

未来需要支持：

- 同一个 HR 不同渠道的不同任务
- 不同渠道的工作时间与风控策略

建议新增：

- `provider`
- `provider_account_id`
- `capability_required`

---

## 8.3 锁模型改造

当前已有按浏览器实例占用的能力，但未来锁粒度建议明确为：

1. `provider_account` 级并发锁
2. `browser_instance` 级并发锁
3. `job` 级冷却与幂等锁
4. `candidate` 级行为冷却锁

目的：

- 防止同一账号多任务并发打架
- 防止同一候选人在多个 run 中重复骚扰
- 支持不同渠道各自并发执行

---

## 9. UI / 产品层改造建议

## 9.1 先在 UI 中把“渠道”升成显式字段

建议所有核心页面增加渠道标识：

- 岗位列表
- 候选人列表
- 运行记录
- HR 账号页
- 浏览器实例页

显示示例：

- `BOSS`
- `智联`
- `猎聘`
- `58`

---

## 9.2 账号管理页从“Boss 账号”改为“渠道账号”

建议原有“Boss 账号管理”升级为：

- 渠道账号管理
- 按 provider 分组
- 每个 HR 可绑定多个渠道账号

页面能力包括：

- 绑定账号
- 查看状态
- 绑定浏览器实例
- 查看当前运行任务
- 配置工作时间

---

## 9.3 运行中心增加 provider 过滤

运行中心建议支持：

- 按渠道过滤
- 按执行模式过滤
- 按账号过滤
- 按岗位过滤
- 按失败原因聚合

---

## 10. 渠道接入优先级建议

## 10.1 推荐优先级

### 第一优先级：智联或猎聘

原因：

- 更接近当前招聘工作台形态
- 更容易复用现有“岗位 + 候选人 + 沟通 + 简历”的流程模型
- 更适合作为架构验证样板

### 第二优先级：58

原因：

- 业务形态可能更混杂
- 页面结构、招聘产品线、简历流转方式可能差异更大
- 更适合在 provider 抽象稳定后接入

---

## 10.2 首个新增渠道验收标准

接入第一个新渠道时，至少要跑通以下闭环：

1. 渠道账号绑定
2. 岗位同步
3. 发起 source run
4. 候选人回写
5. 跟进 / chat 回写
6. 简历下载与附件入库
7. 事件流和 run 状态正确展示
8. UI 可按渠道区分查看

只有第一个新渠道闭环通过，才建议扩第二个平台。

---

## 11. 迁移实施路线

## 11.1 Phase 1：平台中立字段落库

### 目标

在不破坏现有 BOSS 运行链路前提下，为未来多渠道接入埋好结构。

### 工作项

1. 为核心表新增 `provider` / `external_*_id`
2. 为 run / schedule / account / browser_instance 新增 provider 维度
3. 保留旧 BOSS 字段兼容
4. 新增数据迁移脚本，将现有 Boss 记录补齐 `provider='boss'`

### 验收

- BOSS 旧功能不受影响
- 新字段已可查询
- 新旧字段可并行读写

---

## 11.2 Phase 2：抽象 Provider Registry 与统一接口

### 目标

让 Control Plane 不再直接依赖 `Boss*` 服务命名。

### 工作项

1. 引入 `src/providers/`
2. 封装 provider registry
3. 将 `AgentService` / `JobService` / `RunOrchestrator` 改为通过 provider 接口分发
4. 将 Boss 实现迁移到 `providers/boss`

### 验收

- Boss 仍然可运行
- Control Plane 已通过 provider 选择实现
- 新 provider 可空壳注册

---

## 11.3 Phase 3：统一 Prompt / Callback 协议

### 目标

让 agent 执行层不再以 Boss 语义作为唯一契约。

### 工作项

1. Prompt builder provider 化
2. callback payload provider 中立化
3. Boss skill 兼容升级
4. 新增 provider-specific skill 模板

### 验收

- Boss provider 通过新协议回写成功
- event / candidate / message / attachment 均按新协议落库

---

## 11.4 Phase 4：接入第一个新渠道

### 目标

以智联或猎聘为试点，验证架构。

### 工作项

1. 新增 provider account 支持
2. 实现对应 provider adapter
3. 打通岗位同步
4. 打通 source / followup / download
5. 打通 UI 展示与筛选

### 验收

- 第一个新渠道跑通完整闭环
- Boss 功能未退化
- 运行记录与数据模型统一

---

## 11.5 Phase 5：评估是否拆执行 Worker

### 目标

在 provider 抽象稳定后，视复杂度决定是否拆分执行层。

### 何时需要拆

如果出现以下情况之一，可考虑拆为多 worker：

- 平台之间的运行环境依赖显著不同
- 浏览器实例需要分机房 / 分机器部署
- 发布节奏和变更风险差异大
- 反风控与稳定性要求差异过大

### 当前结论

本阶段不建议先拆服务，先把 provider abstraction 做对。

---

## 12. 风险分析

## 12.1 最大风险：表结构中立化不彻底

如果只是增加 `source` 字段，却继续沿用 `boss_encrypt_*` 作为核心键，后续仍会陷入多平台泥球。

### 应对

必须把唯一性约束切换到：

- `provider + external_id`

---

## 12.2 第二风险：Prompt 与回写协议改造不彻底

如果后端表改了，但 skill 仍按 Boss 语义输出，平台扩展还是会卡住。

### 应对

Prompt、callback、落库三层必须一起改。

---

## 12.3 第三风险：第一个新渠道选错

如果一开始选择 58 这类差异更大的渠道，容易把架构验证与平台特性问题混在一起。

### 应对

优先选择智联或猎聘作为试点。

---

## 12.4 第四风险：一次性重构范围过大

如果试图同时重构数据库、UI、provider、worker、skill，周期和风险都会显著放大。

### 应对

采用“兼容迁移 + 首个试点渠道”策略。

---

## 13. 最终建议

### 13.1 架构结论

`search-boss` 当前不是“多渠道平台差一点配置”，而是一个：

> **以 BOSS 直聘为核心执行模型构建的招聘运营系统。**

因此，扩智联 / 猎聘 / 58 的正确方式不是继续堆渠道分支，而是：

> **先把平台抽象做成一等能力，再接入第一个新渠道作为样板。**

### 13.2 推荐路线

1. 保持当前 monolith 控制台不拆
2. 先做数据库平台中立化
3. 先做 provider registry 与适配层
4. 先做 prompt / callback 协议中立化
5. 先接智联或猎聘
6. 等第一个新渠道稳定后，再考虑接 58
7. 等平台适配层成熟后，再评估是否拆执行 worker

### 13.3 一句话判断

**可扩，但必须先重构成“多 provider 招聘控制平台”，不能继续把多平台能力堆在 BOSS 专用架构上。**

---

## 14. 附录：建议新增的核心概念命名

为避免未来继续在命名层面绑定 Boss，建议逐步引入以下命名：

- `provider`
- `provider_accounts`
- `provider_adapter`
- `external_job_id`
- `external_candidate_id`
- `external_message_id`
- `external_attachment_id`
- `provider_payload`
- `execution_mode`
- `capabilities`

建议逐步淡化以下命名在核心路径中的地位：

- `boss_accounts`
- `boss_encrypt_job_id`
- `boss_encrypt_geek_id`
- `boss_message_id`
- `boss_attachment_id`
- `/boss-sourcing`

---

## 15. 推荐下一步动作

如果按本方案继续推进，建议下一步立即输出两份配套文档：

1. **数据库迁移设计文档**
   - 列出每张表新增字段、索引、迁移脚本、兼容策略

2. **Provider 接口与目录改造实施计划**
   - 明确要改哪些文件、拆哪些类、按什么顺序落地

这两份文档可以直接作为开发执行蓝图。
