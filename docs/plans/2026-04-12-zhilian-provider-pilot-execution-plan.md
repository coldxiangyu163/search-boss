# search-boss 首个非 BOSS Provider 试点执行计划（智联）

> 关联文档：
> - `docs/plans/2026-04-11-multi-channel-recruiting-architecture-design.md`
> - `docs/plans/2026-04-12-zhilian-first-provider-acceptance-checklist.md`

## 1. 计划目标

本计划的目标不是继续讨论“多渠道是否值得做”，而是把 **智联首个 Provider 样板** 拆成可以直接进入开发的执行包，尽快验证以下四件事：

1. 数据模型是否能从 `boss_*` 迁移到 `provider + external_id`
2. Control Plane 是否能按 provider 分发，而不是继续写死 Boss
3. callback / prompt / run event 协议是否能 provider 中立
4. 在不打断现有 BOSS 业务的前提下，智联最小闭环是否能跑通

## 2. 当前代码面结论（用于定 scope）

基于仓库检查，当前首要阻塞点已经比较明确：

### 2.1 数据层仍然是 BOSS 专有模型
- `src/db/schema.sql` 中 `jobs/people/candidate_messages/candidate_attachments` 仍以 `boss_encrypt_job_id`、`boss_encrypt_geek_id`、`boss_message_id`、`boss_attachment_id` 作为核心唯一键
- `src/db/enterprise-schema.sql` 仍使用 `boss_accounts`，`browser_instances` 也绑定 `boss_account_id`

### 2.2 调度与执行入口仍然写死 Boss
- `src/services/prompt-contract-builder.js` 统一生成 `/boss-sourcing ...`
- `src/services/run-orchestrator.js` 的同步链路仍然是 `bossCliRunner` / `boss cli sync fallback`
- `src/services/agent-service.js` 构造函数、runner 解析、deterministic sync 都以 Boss 命名为主

### 2.3 现有 callback CLI 还不是 provider 中立
- `scripts/agent-callback-cli.js` 在 `run-message` 归一化时仍自动补 `bossMessageId`
- 现有接口契约虽然能承接 run/event/candidate/message/attachment，但 payload 语义仍明显偏 Boss

因此，本次计划必须先打掉这些“路径依赖”，再接智联业务闭环；否则会变成“用新代码把 Boss 偶然兼容一次”，而不是做出可复用架构样板。

## 3. 范围边界

## 3.1 本次纳入范围
仅纳入智联首个 Provider 样板所必须的 5 个闭环：
1. provider 中立数据主键
2. provider registry / provider-aware 调度分发
3. provider 中立 callback 协议
4. 智联 job sync + source 最小业务闭环
5. 智联 message / attachment / run event 回写

## 3.2 本次明确不做
1. 同时接入猎聘、58、拉勾等第二个渠道
2. 大规模 UI 重构，只做必要的 provider 展示与筛选透出
3. 分布式拆服务
4. AI 策略层大改
5. 一次性删除全部 Boss 历史字段

## 4. 推荐 roadmap（4 个执行包）

## 包 A：平台中立主键与账号抽象

### 目标
把“平台”从 metadata 变成一等概念，让智联可以和 Boss 共存。

### 代码范围
- `src/db/schema.sql`
- `src/db/enterprise-schema.sql`
- `src/services/job-service.js`
- `src/services/candidate-service.js`
- 相关测试：`tests/db.test.js`、`tests/api.test.js`

### 交付项
1. `jobs` 新增 `provider`、`external_job_id`
2. `people` 新增 `provider`、`external_candidate_id`
3. `candidate_messages` 新增 `provider`、`external_message_id`
4. `candidate_attachments` 新增 provider 中立附件标识（建议 `external_attachment_id`）
5. `boss_accounts` 演进为 `provider_accounts`（可通过兼容视图/迁移保留旧读写）
6. `browser_instances` 从绑定 `boss_account_id` 改为绑定 `provider_account_id`
7. 唯一键和查询逐步切换到 `provider + external_id`

### 完成定义
- Boss 历史链路可继续运行
- 新增 schema 不要求立即删掉旧 Boss 字段
- Repository/service 层已能接受 provider 参数

## 包 B：Provider Registry + 控制面分发改造

### 目标
把运行入口从 Boss 专用实现改成 provider-aware 选择。

### 代码范围
- `src/services/agent-service.js`
- `src/services/run-orchestrator.js`
- `src/services/prompt-contract-builder.js`
- `src/services/browser-instance-manager.js`
- 新增目录建议：`src/services/providers/`
- 相关测试：`tests/prompt-contract-builder.test.js`、`tests/source-loop-service.test.js`、`tests/followup-loop-service.test.js`

### 交付项
1. 定义 provider registry（至少支持 `boss`、`zhilian`）
2. `sourcing_runs` 创建时显式写入 `provider`、`provider_account_id`
3. `AgentService` 根据 run/job/provider 解析 runner 与 prompt builder
4. `RunOrchestrator` 不再出现 Boss 专属 fallback/event naming
5. prompt 从 `/boss-sourcing` 收敛为 provider-aware 命令或统一入口

### 完成定义
- 同一条 control plane 路径可以按 provider 选择 adapter
- Boss 通过 registry 路径继续可用，不保留“Boss 是特例”的隐藏分支

## 包 C：Provider 中立 callback 协议

### 目标
把事件回写、消息回写、候选人回写改成跨平台复用协议。

### 代码范围
- `scripts/agent-callback-cli.js`
- `src/app.js`
- `src/services/agent-service.js`
- `src/services/run-contracts/*`
- 测试：`tests/agent-callback-cli.test.js`、`tests/skill-runtime-contract.test.js`、`tests/api.test.js`

### 交付项
1. payload 统一要求包含 `provider`
2. candidate/message/attachment 统一改用 `external*Id` 命名
3. Boss payload 兼容老字段输入，但服务层内部统一映射到 provider 中立结构
4. run event payload 补齐 provider/account/job/candidate 上下文
5. 明确失败回写 contract，禁止只在浏览器状态里保留错误

### 完成定义
- Boss 和智联都能用同一套 callback CLI/HTTP 契约回写
- 老 Skill 在兼容期内仍可运行

## 包 D：智联 Provider MVP

### 目标
跑通首个非 Boss provider 的完整最小闭环。

### 代码范围
- 新增 `src/services/providers/zhilian/`
- 必要时新增智联 prompt/skill contract 文档
- `scripts/agent-callback-cli.js` 与 run contracts 对接
- 相关集成测试 / 冒烟脚本

### 交付项
1. 智联岗位同步
2. 智联寻源 run 创建与执行
3. 候选人资料回写
4. 消息回写
5. 附件下载回写
6. run/event 成败回写

### 完成定义
- 至少 1 次端到端 run 完成从 job sync 到 candidate/message/attachment/event 的闭环
- UI/API 可区分 `boss` 与 `zhilian`
- 失败能在 PostgreSQL 事件流中定位

## 5. 推荐执行顺序（两周节奏）

### 第 1 周：先做“不会反复返工”的底座
- Day 1-2：包 A schema/migration/repository 改造
- Day 3-4：包 B provider registry 与 run dispatch 改造
- Day 5：包 C callback 协议收敛 + Boss 回归测试

### 第 2 周：做第一个真实 provider 样板
- Day 6-7：智联 job sync MVP
- Day 8-9：智联 source/message/event 回写 MVP
- Day 10：附件下载、联调、验收回归

## 6. 验收 checklist（执行态版本）

### Gate 1：基础抽象通过
- [ ] schema 已支持 `provider + external_id`
- [ ] `provider_accounts` / `browser_instances` 关系已中立化
- [ ] `sourcing_runs` 已具备 provider 上下文

### Gate 2：控制面通过
- [ ] registry 可选择 `boss` / `zhilian`
- [ ] prompt 与 runner 分发不再写死 Boss
- [ ] Boss 回归测试通过

### Gate 3：协议面通过
- [ ] callback CLI 与 API 接受 provider 中立 payload
- [ ] 事件流带 provider/account/job/candidate 上下文
- [ ] 失败事件可被统一检索

### Gate 4：业务样板通过
- [ ] 智联岗位同步成功 1 次
- [ ] 智联寻源 run 成功 1 次
- [ ] 至少 1 个 candidate/message/attachment 成功回写
- [ ] UI/API 可按 provider 查看结果

## 7. 建议直接创建的下一批 implementation 任务

### Task A1
**标题**：实现 provider 中立 schema migration（jobs/people/messages/attachments/provider_accounts）
- 输出：migration SQL + repository 兼容读写 + DB tests
- 依赖：无

### Task A2
**标题**：引入 provider registry 并改造 run creation / runner resolution / prompt dispatch
- 输出：registry 模块、AgentService/RunOrchestrator 改造、回归测试
- 依赖：A1

### Task A3
**标题**：把 agent callback CLI 与 API 契约改成 provider 中立
- 输出：callback payload 映射层、兼容旧 Boss 字段、契约测试
- 依赖：A1、A2

### Task A4
**标题**：实现 zhilian provider MVP（job sync + source + message/event/attachment callback）
- 输出：provider adapter、最小联调跑通记录、验收 checklist 勾选结果
- 依赖：A2、A3

## 8. 风险与控制

1. **风险：schema 一步到位替换导致 Boss 退化**
   - 控制：采用新增字段 + 双写/映射 + 渐进切流，不立即删旧字段
2. **风险：provider registry 只做表面封装，底层仍大量 Boss 特判**
   - 控制：以 `prompt-contract-builder.js`、`run-orchestrator.js`、`agent-service.js` 为必改检查点
3. **风险：智联接入前协议仍未中立，导致后续第二渠道重复返工**
   - 控制：把 callback contract 收敛作为包 C 的单独 gate，而不是边做边补

## 9. 结论

建议立即按 **A1 → A2 → A3 → A4** 四个执行包推进，其中前 3 个属于“底座改造”，A4 才是智联业务样板。只要按这个顺序推进，就能在不破坏现有 Boss 业务的前提下，用智联验证多渠道架构是否真正成立。