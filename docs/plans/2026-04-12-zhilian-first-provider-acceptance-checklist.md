# search-boss 首个 Provider 试点验收清单（智联）

> 关联方案：`docs/plans/2026-04-11-multi-channel-recruiting-architecture-design.md`

## 1. 这次试点要验证什么

本次试点的目标不是“再接一个渠道”本身，而是用 **智联** 作为第一个非 BOSS provider，验证以下抽象是否真的成立：

1. `provider + external_id` 是否足以替代 BOSS 专有主键思路
2. `provider_accounts / browser_instances` 是否能承载非 BOSS 账号执行
3. Control Plane 是否能通过 provider registry 选择实现，而不是继续写死 Boss 服务
4. Prompt / callback / 落库协议是否已经 provider 中立
5. run/event/candidate/message/attachment 是否还能回到统一 PostgreSQL 事实源

## 2. 为什么先选智联

优先选择智联作为样板，原因：

1. 原总方案已经把 `zhilian` 作为 provider 目录结构、skill 命名、callback 示例的主要示例，落地阻力最低
2. 它仍属于“岗位 + 候选人 + 沟通 + 简历”形态，更适合验证统一闭环
3. 相比 58，这类渠道与当前模型更接近，能把“架构问题”和“平台差异问题”尽量分开

## 3. 最小闭环范围（本次必须验收）

本次只验收 5 个核心闭环，不扩更多能力：

1. 岗位同步
2. 候选人寻源
3. 消息回写
4. 附件/简历下载
5. run / event 回写

## 4. 验收清单

### A. Provider 基础接入
- [ ] `provider_accounts` 已支持 `provider='zhilian'`
- [ ] `browser_instances` 可绑定智联执行账号
- [ ] provider registry 可注册并解析 `zhilian`
- [ ] `AgentService` / `JobService` / `RunOrchestrator` 不再写死 Boss 分发
- [ ] UI/API 创建 run 时可显式带 `provider=zhilian`

### B. 数据模型验收
- [ ] `jobs` 已能保存 `provider='zhilian'` 与 `external_job_id`
- [ ] `people` 已能保存 `provider='zhilian'` 与 `external_candidate_id`
- [ ] `candidate_messages` 已能保存 `provider` 与 `external_message_id`
- [ ] `candidate_attachments` 已能保存 provider 中立附件标识
- [ ] 唯一性和查询已转向 `provider + external_id`，不是继续依赖 `boss_encrypt_*`
- [ ] 老的 BOSS 读写链路仍可兼容运行

### C. 岗位同步闭环
- [ ] 智联 provider 可拉取岗位列表或岗位详情
- [ ] 岗位入库后带有 `provider='zhilian'`
- [ ] 能根据 `provider + external_job_id` 幂等更新
- [ ] UI 可区分查看 BOSS / 智联岗位

### D. 候选人寻源闭环
- [ ] 可为智联岗位创建 `sourcing_runs`
- [ ] run 创建时写入 `provider='zhilian'` 与 `provider_account_id`
- [ ] 执行器能按 provider 选择 `zhilian` skill / adapter
- [ ] 候选人资料能按统一结构回写到 `people` / `job_candidates`
- [ ] 候选人去重不依赖 BOSS 专有字段

### E. 消息回写闭环
- [ ] 智联消息可回写到统一 `/events|messages` 接口或等价控制面入口
- [ ] payload 至少包含 `provider`、`externalCandidateId`、`externalMessageId`
- [ ] 入库后 UI 可按 run 查看消息流
- [ ] inbound / outbound 方向、发送时间、文本内容可正常展示

### F. 附件下载闭环
- [ ] 智联 provider 能触发简历/附件下载动作
- [ ] 下载结果可回写到 `candidate_attachments`
- [ ] 附件记录可关联到统一 candidate / run
- [ ] 失败原因会以 event 形式回写，而不是静默丢失

### G. Run / Event 闭环
- [ ] 智联 run 能经历 `queued/running/succeeded/failed` 统一生命周期
- [ ] `sourcing_run_events` 能持续记录关键步骤
- [ ] event 里能区分 provider、account、job、candidate 上下文
- [ ] 失败时能落明确错误，而不是只在浏览器或 skill memory 中保留
- [ ] UI 侧可看到与 BOSS 一致的运行事件流

### H. 回归验收
- [ ] BOSS 现有同步、寻源、沟通、下载功能未退化
- [ ] Boss provider 仍可通过新的 provider registry 路径运行
- [ ] Boss callback 兼容 provider 中立协议
- [ ] 现有调度任务不会因新增 provider 字段而失败

## 5. 建议执行顺序

1. **先打基础面**：provider 字段、external_id、provider_accounts、registry
2. **再打协议面**：prompt builder provider 化、callback payload 中立化
3. **再打第一个业务面**：智联岗位同步
4. **再打核心闭环**：智联 source run + candidate/message/event 回写
5. **最后补资产闭环**：附件下载、UI 按渠道筛选、BOSS 回归

## 6. 验收通过的定义

只有同时满足以下条件，才算“首个 provider 样板通过”：

1. 智联从岗位到寻源到消息到附件到 run/event 全链路至少跑通 1 次
2. 全部关键对象都使用 provider 中立模型入库
3. UI/接口能够明确区分 `boss` 与 `zhilian`
4. BOSS 旧流程未退化
5. 失败能够通过统一事件流定位，而不是靠人工翻浏览器状态

## 7. 下一步建议

直接把后续实施拆成 3 个开发包：

1. **开发包 A：平台中立数据模型 + provider registry**
2. **开发包 B：prompt/callback 协议中立化 + Boss 兼容改造**
3. **开发包 C：智联 provider MVP（job sync / source / message / attachment）**
