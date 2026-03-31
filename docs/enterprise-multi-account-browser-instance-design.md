# search-boss 企业版多账号权限与多浏览器实例架构设计文档

## 1. 文档概述

### 1.1 背景

当前 `search-boss` 项目是一个面向单环境、单业务链路的 POC，已具备以下核心能力：

- 职位同步
- 候选人管理
- 寻源 / 跟进 / 简历下载
- 定时任务
- 基于 CDP 的浏览器自动化控制

当前实现粒度是：

- 一个 HR 对应一个 BOSS 账号
- 一个 BOSS 账号对应一个浏览器实例
- 系统尚未建立正式的企业账号、组织权限与多实例调度模型

### 1.2 目标

将当前 POC 演进为可供企业正式使用的系统，支持：

- 企业级账号体系（初期支持单企业，预留多租户扩展能力）
- 部门与管理员权限
- HR 账号归属管理
- 多 BOSS 账号隔离
- 多浏览器实例隔离
- 管理员视角看板
- HR 视角任务运营
- 基于账号级 `BOSS_CDP_ENDPOINT` 的浏览器实例调度

### 1.3 非目标

本阶段不包含：

- 多租户（多企业）支持 —— 初期只服务一个企业，以默认 tenant 占位
- 复杂 BI 报表系统
- 跨企业协作
- 统一 SSO/LDAP 集成
- 完整的云原生弹性执行平台
- 分布式 Worker 调度（初期 worker 信息作为浏览器实例属性存储）

## 2. 现状分析

### 2.1 当前系统特征

| 维度 | 现状 |
| --- | --- |
| CDP 地址 | 全局 `BOSS_CDP_ENDPOINT` 环境变量，`boss-cli.js` 在 `createDependencies()` 中创建单例 `BossCdpClient` |
| 并发锁 | `TaskLock` 为进程内内存单例，全局只允许一个 run 执行 |
| 服务初始化 | `server.js` 中所有 service 为单例拼装，单一 `BossCliRunner` 实例 |
| Nanobot 配置 | 全局 `NANOBOT_CONFIG_PATH`，MCP chrome-devtools 配置写死单一 CDP 地址 |
| 数据隔离 | 无任何租户、部门、用户字段，所有表全局共享 |
| 认证鉴权 | 无登录系统，agent callback 路由仅依赖 `AGENT_TOKEN` 简单校验 |
| 前端 | `public/index.html` 单页面，无路由/权限概念 |

### 2.2 核心改造点清单

基于代码分析，以下是从 POC 到企业版必须改造的核心代码路径：

#### 2.2.1 CDP 单例 → 多实例

- **`scripts/boss-cli.js`** 的 `createDependencies()` 固定从 `config.bossCdpEndpoint` 创建 `BossCdpClient`，需改为按 `boss_account_id` 或 `browser_instance_id` 动态查找 endpoint
- **`BossCliRunner`** 构造函数需接受 `cdpEndpoint` 参数，或每次调用从 DB 查找
- **`server.js`** 中 `new BossCliRunner()` 单例需改为工厂模式或参数化调用

#### 2.2.2 全局锁 → 分级锁

- **`TaskLock`** 从内存单锁改为按 `hr_account_id` 粒度的 DB 级锁（PostgreSQL advisory lock 或行级 `current_run_id`）
- **`SchedulerService.#tick()`** 中 `this.taskLock?.isBusy()` 全局检查需改为按 HR 维度检查

#### 2.2.3 数据查询 → 范围过滤

- **`AgentService`**、**`JobService`**、**`CandidateService`**、**`DashboardService`** 中所有查询需接受 `hrAccountId` 参数并在 WHERE 子句中过滤
- 所有 API 路由需通过鉴权中间件注入 `req.user`（含 role、hrAccountId 等）

#### 2.2.4 Nanobot 配置多实例化

- `NANOBOT_CONFIG_PATH` 需按 BOSS 账号生成独立配置文件（至少 MCP chrome-devtools 的 CDP 地址不同）
- 或在运行时动态注入 CDP 地址到环境变量供 nanobot 使用

## 3. 总体设计原则

### 3.1 组织与执行分离

系统分为两类核心对象：

- **管理对象**：企业、部门、用户（管理员 / HR）
- **执行对象**：BOSS 账号、浏览器实例

### 3.2 权限与数据范围一致

谁能看到什么数据，由其组织角色与分管范围决定。

### 3.3 HR 是业务运营粒度

HR 账号是实际负责岗位运营、寻源和定时任务的业务主体。

### 3.4 BOSS 账号是执行粒度

每个 BOSS 账号绑定一个浏览器实例，并通过独立 `BOSS_CDP_ENDPOINT` 控制。

### 3.5 浏览器实例必须强隔离

不同 BOSS 账号必须独立：

- CDP endpoint
- user-data-dir
- 下载目录
- 运行状态

### 3.6 渐进式改造

保持现有 API 路径不变，通过鉴权中间件注入上下文信息，在 service 层完成权限过滤。前端逐步适配，而非一次性全部重写。

## 4. 角色与组织模型

### 4.1 角色层级

```text
企业 (初期固定一个)
  └── 部门 (扁平结构)
        └── 管理员
              └── HR
                    └── BOSS账号
                          └── 浏览器实例
```

> 注：初期不做多租户，使用默认企业。不做树形部门，扁平结构即可。多租户和树形部门作为后续 SaaS 化时再引入。

### 4.2 角色定义

#### 企业管理员

企业级管理角色，负责：

- 管理本企业部门
- 管理本企业管理员 / HR
- 查看本企业数据看板
- 查看 HR、岗位、候选人、运行数据

#### 部门管理员

部门级管理角色，负责：

- 查看本部门 HR 数据
- 管理本部门 HR
- 查看本部门岗位与候选人情况

#### HR

业务执行角色，负责：

- 绑定自己的 BOSS 账号
- 管理岗位
- 发起寻源 / 跟进
- 配置定时任务
- 查看自己的候选人和执行结果

## 5. 核心业务模型

### 5.1 模型关系

```text
users (登录用户)
  ├── role = 'enterprise_admin' → 看全企业数据
  ├── role = 'dept_admin'       → 看本部门数据
  └── role = 'hr'               → 绑定一个 hr_accounts

hr_accounts (HR 业务账号)
  ├── user_id           → 该 HR 的登录用户 (users.id)
  ├── manager_user_id   → 分管管理员 (users.id)
  └── boss_accounts     → 1:1 当前有效 BOSS 账号

boss_accounts (BOSS 平台账号)
  └── browser_instances → 1:1 当前有效浏览器实例

browser_instances (浏览器实例)
  ├── cdp_endpoint
  ├── user_data_dir
  ├── download_dir
  └── host (所在机器)
```

### 5.2 关键约束

1. 一个 HR 只能绑定一个当前有效 BOSS 账号
2. 一个 BOSS 账号只能绑定一个当前有效浏览器实例
3. 一个浏览器实例同一时间只能执行一个 run
4. 一个 HR 同一时间只能有一个执行中的 run

## 6. 数据模型设计

### 6.1 新增核心表

#### departments

部门表（扁平结构，不做树形层级）。

```sql
create table if not exists departments (
  id bigserial primary key,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### users

系统登录用户表。

```sql
create table if not exists users (
  id bigserial primary key,
  department_id bigint references departments(id),
  name text not null,
  email text unique,
  phone text unique,
  password_hash text not null,
  role text not null check (role in ('enterprise_admin', 'dept_admin', 'hr')),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### hr_accounts

HR 业务账号表。

```sql
create table if not exists hr_accounts (
  id bigserial primary key,
  user_id bigint not null references users(id),
  department_id bigint references departments(id),
  manager_user_id bigint references users(id),
  name text not null,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

> `user_id` = 该 HR 本人的登录账号，`manager_user_id` = 分管该 HR 的管理员。

#### boss_accounts

BOSS 平台账号表。

```sql
create table if not exists boss_accounts (
  id bigserial primary key,
  hr_account_id bigint not null references hr_accounts(id),
  boss_login_name text,
  display_name text,
  status text not null default 'active',
  last_login_at timestamptz,
  risk_level text not null default 'normal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### browser_instances

浏览器实例表。

```sql
create table if not exists browser_instances (
  id bigserial primary key,
  boss_account_id bigint not null references boss_accounts(id),
  instance_name text,
  cdp_endpoint text not null,
  user_data_dir text not null,
  download_dir text not null,
  debug_port integer,
  host text not null default 'localhost',
  status text not null default 'idle',
  current_run_id bigint,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

> `host` 字段记录实例所在机器（如 `192.168.1.10`），初期阶段不需要独立的 `worker_nodes` 表。当后续需要多 worker 调度时，可将 `host` 抽出为 `worker_nodes` 表。

### 6.2 现有业务表改造

对现有核心表增加 `hr_account_id` 字段，建立与 HR 的归属关系。

**原则**：通过 `hr_account_id` 即可关联推导出 department、boss_account、browser_instance，不需要在每张表上冗余所有外键。仅在查询性能确实需要时才加冗余字段。

#### jobs

```sql
alter table jobs
  add column if not exists hr_account_id bigint references hr_accounts(id);
```

#### sourcing_runs

```sql
alter table sourcing_runs
  add column if not exists hr_account_id bigint references hr_accounts(id),
  add column if not exists browser_instance_id bigint references browser_instances(id);
```

#### job_candidates

```sql
alter table job_candidates
  add column if not exists hr_account_id bigint references hr_accounts(id);
```

#### scheduled_jobs

```sql
alter table scheduled_jobs
  add column if not exists hr_account_id bigint references hr_accounts(id);
```

#### candidate_messages / candidate_actions / candidate_attachments

通过 `job_candidate_id → job_candidates.hr_account_id` 关联推导，不加冗余字段。

### 6.3 数据迁移方案

现有数据库中已有 jobs、candidates、runs 等数据，需要以下迁移步骤：

```sql
-- Step 1: 创建默认部门
insert into departments (name) values ('默认部门');

-- Step 2: 创建默认管理员用户
insert into users (department_id, name, email, password_hash, role)
values (1, '默认管理员', 'admin@company.com', '<bcrypt_hash>', 'enterprise_admin');

-- Step 3: 创建默认 HR 用户
insert into users (department_id, name, email, password_hash, role)
values (1, '默认HR', 'hr@company.com', '<bcrypt_hash>', 'hr');

-- Step 4: 创建默认 HR 账号
insert into hr_accounts (user_id, department_id, manager_user_id, name)
values (2, 1, 1, '默认HR');

-- Step 5: 创建默认 BOSS 账号
insert into boss_accounts (hr_account_id, display_name)
values (1, '默认BOSS账号');

-- Step 6: 创建默认浏览器实例（使用当前环境的 CDP 配置）
insert into browser_instances (boss_account_id, instance_name, cdp_endpoint, user_data_dir, download_dir, host)
values (1, 'default', 'http://127.0.0.1:9222', '/path/to/user-data-dir', '/path/to/resumes', 'localhost');

-- Step 7: 将现有业务数据关联到默认 HR
update jobs set hr_account_id = 1 where hr_account_id is null;
update sourcing_runs set hr_account_id = 1 where hr_account_id is null;
update job_candidates set hr_account_id = 1 where hr_account_id is null;
update scheduled_jobs set hr_account_id = 1 where hr_account_id is null;

-- Step 8: 设置 NOT NULL 约束（在数据迁移完成后）
-- alter table jobs alter column hr_account_id set not null;
-- (根据业务需要决定是否强制，初期建议保持 nullable 以兼容)
```

> 迁移脚本应放在 `scripts/migrate-to-enterprise.sql`，在 Phase 1 完成表创建后执行。

## 7. 权限设计

### 7.1 权限原则

所有数据访问必须带范围过滤：

- 企业管理员：可见所有 HR 数据
- 部门管理员：可见 `department_id` 匹配的 HR 数据
- HR：仅可见自己的 `hr_account_id` 对应的数据

### 7.2 角色权限矩阵

| 能力 | 企业管理员 | 部门管理员 | HR |
| --- | --- | --- | --- |
| 查看本企业全部数据 | 是 | 否 | 否 |
| 查看本部门数据 | 是 | 是 | 否 |
| 查看自己 HR 数据 | 是 | 是 | 是 |
| 管理部门 | 是 | 否 | 否 |
| 管理 HR | 是 | 是(本部门) | 否 |
| 管理自己的岗位 / 任务 | 是 | 是 | 是 |
| 配置 BOSS 实例 | 是 | 可选 | 是(自己的) |

### 7.3 鉴权中间件设计

```js
// src/middleware/auth.js
function authMiddleware(pool) {
  return async (req, res, next) => {
    // 从 session/cookie 中获取 userId
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // 查询用户信息及关联的 hr_account
    const user = await pool.query(`
      select u.id, u.role, u.department_id,
             ha.id as hr_account_id
      from users u
      left join hr_accounts ha on ha.user_id = u.id
      where u.id = $1 and u.status = 'active'
    `, [userId]);

    if (!user.rows[0]) {
      return res.status(401).json({ error: 'user_not_found' });
    }

    req.user = user.rows[0];
    next();
  };
}

// 在 service 层使用
// const jobs = await jobService.listJobs({ hrAccountId: req.user.hr_account_id });
```

**现有路由过渡策略**：现有 API 路径不变（`/api/jobs`、`/api/candidates` 等），在中间件注入 `req.user` 后，service 层根据角色自动过滤范围。前端适配登录流程后，调用相同接口即可得到权限范围内的数据。

## 8. 认证与登录设计

### 8.1 登录对象

系统登录的是 `users`，不是 BOSS 账号。

- 管理员、HR 均通过 users 表登录后台系统
- BOSS 账号仅用于执行，不直接作为系统登录身份

### 8.2 认证方式

推荐采用 **Session + HttpOnly Cookie**：

- 使用 `express-session` + `connect-pg-simple`（复用现有 PostgreSQL）
- 无需额外引入 Redis
- Session 存储在 PG 中，服务重启不丢失

```js
// 依赖
// npm install express-session connect-pg-simple bcryptjs

const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);

app.use(session({
  store: new PgStore({ pool }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24h
  }
}));
```

### 8.3 登录 API

```
POST /api/auth/login    { email, password } → set session
POST /api/auth/logout   → destroy session
GET  /api/auth/me       → current user info
```

## 9. 浏览器实例与 CDP 设计

### 9.1 设计目标

每个 HR 对应一个 BOSS 账号，每个 BOSS 账号对应一个独立浏览器实例，通过不同 `BOSS_CDP_ENDPOINT` 控制。

### 9.2 每个实例必须独立的资源

| 资源 | 存储位置 |
| --- | --- |
| `cdp_endpoint` | `browser_instances.cdp_endpoint` |
| `user-data-dir` | `browser_instances.user_data_dir` |
| 下载目录 | `browser_instances.download_dir` |
| 浏览器 profile | 包含在 `user-data-dir` 中 |
| 运行锁 | `browser_instances.current_run_id` |

### 9.3 推荐部署形态

同一台云桌面可运行多个 Chrome 实例：

```text
cloud-desktop-01
  ├── boss-account-a -> 127.0.0.1:9222
  │     user-data-dir: D:\profiles\boss-a
  │     download-dir:  D:\downloads\boss-a
  ├── boss-account-b -> 127.0.0.1:9223
  │     user-data-dir: D:\profiles\boss-b
  │     download-dir:  D:\downloads\boss-b
  └── boss-account-c -> 127.0.0.1:9224
        user-data-dir: D:\profiles\boss-c
        download-dir:  D:\downloads\boss-c
```

示例启动方式：

```bash
chrome.exe --remote-debugging-port=9222 --user-data-dir=D:\profiles\boss-a
chrome.exe --remote-debugging-port=9223 --user-data-dir=D:\profiles\boss-b
chrome.exe --remote-debugging-port=9224 --user-data-dir=D:\profiles\boss-c
```

### 9.4 CDP 动态解析链路

运行任务时动态从 DB 获取 CDP 地址，而非从全局环境变量读取：

```text
run.hr_account_id
  → hr_accounts.id
    → boss_accounts.hr_account_id
      → browser_instances.boss_account_id
        → cdp_endpoint
```

### 9.5 代码改造方案

#### BossCliRunner 参数化

当前 `BossCliRunner` 不接受 CDP 参数，通过全局 `config.bossCdpEndpoint` 传递给 `boss-cli.js`：

```js
// 当前: server.js
const bossCliRunner = config.bossCliEnabled
  ? new BossCliRunner()
  : null;
```

改造方案 —— `BossCliRunner` 构造时接受 `cdpEndpoint`，并通过环境变量传递给 `boss-cli.js`：

```js
// 改造后: BossCliRunner 接受 cdpEndpoint 参数
class BossCliRunner {
  constructor({ cdpEndpoint, executeCliImpl = executeCli, env = process.env, envFilePath } = {}) {
    this.cdpEndpoint = cdpEndpoint;
    this.executeCliImpl = executeCliImpl;
    this.env = env;
    this.envFilePath = envFilePath;
  }

  async #run(argv) {
    const result = await this.executeCliImpl(argv, {
      env: {
        ...this.env,
        // 运行时覆盖 CDP endpoint
        BOSS_CDP_ENDPOINT: this.cdpEndpoint || this.env.BOSS_CDP_ENDPOINT
      },
      envFilePath: this.envFilePath
    });
    // ...
  }
}
```

#### BossCliRunner 工厂

```js
// src/services/boss-cli-runner-factory.js
class BossCliRunnerFactory {
  constructor({ pool, env = process.env }) {
    this.pool = pool;
    this.env = env;
    this.cache = new Map(); // boss_account_id → BossCliRunner
  }

  async getRunner(hrAccountId) {
    const result = await this.pool.query(`
      select bi.cdp_endpoint, bi.user_data_dir, bi.download_dir
      from browser_instances bi
      join boss_accounts ba on ba.id = bi.boss_account_id
      join hr_accounts ha on ha.id = ba.hr_account_id
      where ha.id = $1 and bi.status != 'disabled'
      limit 1
    `, [hrAccountId]);

    if (!result.rows[0]) {
      throw new Error('browser_instance_not_found');
    }

    const { cdp_endpoint } = result.rows[0];

    if (!this.cache.has(cdp_endpoint)) {
      this.cache.set(cdp_endpoint, new BossCliRunner({
        cdpEndpoint: cdp_endpoint,
        env: this.env
      }));
    }

    return this.cache.get(cdp_endpoint);
  }
}
```

## 10. 运行时配置设计

### 10.1 配置来源变化

| 配置项 | 当前来源 | 改造后来源 |
| --- | --- | --- |
| `BOSS_CDP_ENDPOINT` | 全局环境变量 | `browser_instances.cdp_endpoint` |
| 下载目录 | 全局 `resumes/` | `browser_instances.download_dir` |
| Nanobot config | 全局 `NANOBOT_CONFIG_PATH` | 按 BOSS 账号动态生成或模板化 |
| Session 目录 | 全局 `bossCliSessionDir` | 按 HR 账号独立目录 |

### 10.2 Nanobot 配置多实例化

每个 BOSS 账号需要独立的 Nanobot MCP 配置（chrome-devtools CDP 地址不同）。两种方案：

**方案 A（推荐）**：运行时模板化生成

```js
// 根据模板 + browser_instance 配置动态生成临时 nanobot config
function buildNanobotConfig(baseConfig, browserInstance) {
  const config = JSON.parse(JSON.stringify(baseConfig));
  // 替换 chrome-devtools MCP 的 CDP 地址
  config.mcpServers['chrome-devtools'].env.CDP_ENDPOINT = browserInstance.cdp_endpoint;
  return config;
}
```

**方案 B**：为每个 BOSS 账号维护独立配置文件目录

## 11. 调度与锁设计

### 11.1 最小调度单位

最小调度单位为 **HR Account**。

路由链路：

```text
用户发起任务 → 鉴权中间件获取 hrAccountId
  → 查找 boss_account → 查找 browser_instance
  → 检查 HR 锁 + 实例锁
  → 创建 run（绑定 hr_account_id + browser_instance_id）
  → 获取 BossCliRunner（使用对应 cdp_endpoint）
  → 执行
```

### 11.2 锁模型改造

当前 `TaskLock` 是进程内内存单例，需改为 DB 级别的分级锁：

#### HR 级锁（通过 browser_instances.current_run_id）

```sql
-- 获取锁：CAS 操作
update browser_instances
set current_run_id = $1, status = 'busy'
where boss_account_id = (
  select ba.id from boss_accounts ba
  join hr_accounts ha on ha.id = ba.hr_account_id
  where ha.id = $2
)
and current_run_id is null
returning id;

-- 释放锁
update browser_instances
set current_run_id = null, status = 'idle'
where current_run_id = $1;
```

#### 并发策略

初期保守建议：

- 每个 browser instance：并发 1
- 每个 hr_account：并发 1
- 每台机器：建议 1~2 个实例并发执行（可通过 host 维度统计）

### 11.3 SchedulerService 改造

当前 `SchedulerService.#tick()` 全局检查 `taskLock.isBusy()` 后轮询所有 schedule。改造后：

- 移除全局 `TaskLock` 单例
- `scheduled_jobs` 增加 `hr_account_id`
- tick 时按 `hr_account_id` 分组，检查每个 HR 的浏览器实例是否空闲
- 空闲的 HR 可以并行触发各自的任务

```js
async #tick() {
  const schedules = await this.listDueSchedules();
  // 按 hr_account_id 分组
  const grouped = groupBy(schedules, 'hr_account_id');

  for (const [hrAccountId, hrSchedules] of Object.entries(grouped)) {
    // 检查该 HR 的浏览器实例是否空闲
    const busy = await this.isHrBusy(hrAccountId);
    if (busy) continue;

    // 触发该 HR 的第一个到期任务
    const schedule = hrSchedules[0];
    await this.triggerSchedule(schedule.id);
  }
}
```

## 12. 管理后台设计

### 12.1 管理员看板

管理员只关心自己分管 HR 的业务结果，不负责直接运营 BOSS 账号。

#### HR 概览

| 字段 | 说明 |
| --- | --- |
| HR 名称 | hr_accounts.name |
| 绑定 BOSS 账号 | boss_accounts.display_name |
| 浏览器状态 | browser_instances.status |
| 当前岗位数 | count(jobs) |
| 今日打招呼数 | 统计 candidate_actions |
| 今日跟进数 | 统计 followup runs |
| 今日简历数 | 统计 candidate_attachments |
| 当前任务状态 | sourcing_runs.status |
| 最近失败任务 | 最近 failed run |

#### 岗位维度

| 字段 | 说明 |
| --- | --- |
| 岗位名称 | jobs.job_name |
| 所属 HR | hr_accounts.name |
| 候选人数 | count(job_candidates) |
| 今日新增 | 当日 created_at |

#### 候选人维度

| 字段 | 说明 |
| --- | --- |
| 姓名 | people.name |
| 岗位 | jobs.job_name |
| HR | hr_accounts.name |
| 当前状态 | job_candidates.lifecycle_status |
| 简历状态 | job_candidates.resume_state |
| 最后互动时间 | last_inbound_at / last_outbound_at |

### 12.2 HR 工作台

HR 仅关注自己的运营数据（即当前 POC 已有的功能，加上登录后的数据隔离）：

- 我的岗位
- 我的候选人
- 我的运行任务
- 我的定时任务
- 我的执行日志

## 13. API 设计

### 13.1 认证

```
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
```

### 13.2 组织管理（管理员专用）

```
GET    /api/admin/departments
POST   /api/admin/departments
GET    /api/admin/users
POST   /api/admin/users
GET    /api/admin/hr-accounts
POST   /api/admin/hr-accounts
PATCH  /api/admin/hr-accounts/:id
```

### 13.3 账号绑定（管理员 + HR）

```
POST   /api/hr-accounts/:id/boss-account
PATCH  /api/boss-accounts/:id
POST   /api/browser-instances
PATCH  /api/browser-instances/:id
```

### 13.4 现有业务路由（保持不变，通过中间件注入权限过滤）

```
GET    /api/jobs                    → 加 hr_account_id 过滤
POST   /api/jobs/sync               → 限定当前 HR 的 BOSS 账号
GET    /api/candidates               → 加 hr_account_id 过滤
GET    /api/schedules                → 加 hr_account_id 过滤
POST   /api/schedules                → 绑定 hr_account_id
POST   /api/jobs/:jobKey/tasks/:taskType/trigger → 校验 jobKey 归属
GET    /api/dashboard/summary        → 按角色范围聚合
```

### 13.5 管理员看板

```
GET    /api/admin/dashboard          → 聚合看板数据
GET    /api/admin/dashboard/hr-overview
GET    /api/admin/dashboard/jobs
GET    /api/admin/dashboard/candidates
```

所有接口必须基于当前登录用户自动过滤权限范围。

## 14. 安全设计

### 14.1 数据安全

- 管理员按部门 / 分管范围过滤
- HR 仅能访问自己 `hr_account_id` 下的数据
- 未来多租户时增加 `tenant_id` 一层隔离

### 14.2 浏览器安全

- `cdp_endpoint` 仅允许本机或内网访问
- 不直接暴露公网 CDP 端口
- CDP 连接信息不在前端 API 响应中返回

### 14.3 配置安全

- BOSS 登录态仅保存在浏览器 profile 中
- 密码使用 bcrypt 哈希存储
- Session secret 从环境变量读取

### 14.4 审计

记录关键操作日志（可选，Phase 5 引入）：

- 谁发起任务
- 操作了哪个 HR
- 使用了哪个 BOSS 账号
- 使用了哪个实例
- 结果与失败原因

## 15. 风控与运行建议

### 15.1 风控原则

虽然一台机器可托管多个实例，但不建议高密度并发执行。

### 15.2 建议

- 每个实例独立 profile 和下载目录
- 初期每台机器最多 1~2 个实例并发执行
- 按 HR 维度加锁
- 避免机械化高频操作
- 尽量保持部署地域稳定
- 不同实例错开执行时间（通过 cron 配置调节）

## 16. 实施阶段

### Phase 1：登录与基础权限

**目标**：让系统有认证门槛，数据按用户隔离。

**具体工作**：
1. 新增 `departments`、`users`、`hr_accounts` 表
2. 实现 `express-session` + `connect-pg-simple` 登录
3. 实现 `authMiddleware` 注入 `req.user`
4. 现有业务表增加 `hr_account_id` 字段
5. 执行数据迁移脚本，将现有数据关联到默认 HR
6. 修改 `JobService`、`CandidateService`、`DashboardService`、`SchedulerService` 的查询方法，增加 `hrAccountId` 过滤参数
7. 前端增加登录页面

**验证标准**：
- 未登录访问 API 返回 401
- HR 登录后只能看到自己的数据
- 管理员登录后能看到分管 HR 的数据

### Phase 2：BOSS 账号与浏览器实例模型

**目标**：支持多 BOSS 账号注册、多浏览器实例配置。

**具体工作**：
1. 新增 `boss_accounts`、`browser_instances` 表
2. 实现 BOSS 账号绑定与浏览器实例配置 API
3. `sourcing_runs` 增加 `browser_instance_id`
4. 实现管理端 BOSS 账号 / 实例管理页面

**验证标准**：
- 可为不同 HR 配置不同 BOSS 账号和浏览器实例
- 数据库中正确记录绑定关系

### Phase 3：CDP 动态化与多实例执行

**目标**：任务执行时从 DB 动态获取 CDP 地址，支持多 HR 并行执行。

**具体工作**：
1. `BossCliRunner` 改造，接受 `cdpEndpoint` 参数
2. `boss-cli.js` 的 `createDependencies()` 支持从参数获取 CDP 地址
3. 实现 `BossCliRunnerFactory`，按 `hrAccountId` 创建 Runner
4. `SourceLoopService`、`FollowupLoopService` 使用动态 Runner
5. `NanobotRunner` / Nanobot 配置动态化
6. `TaskLock` 从内存锁改为 DB 级锁
7. `SchedulerService.#tick()` 改为按 HR 维度调度

**验证标准**：
- 两个不同 HR 可以同时执行各自的任务
- 每个任务使用正确的 CDP 地址连接到对应的浏览器实例
- 任务之间不会互相干扰

### Phase 4：管理员看板

**目标**：管理员可直观查看分管 HR 的业务数据。

**具体工作**：
1. 实现管理员看板 API（HR 概览、岗位统计、候选人统计）
2. 实现管理员前端看板页面
3. 按角色展示不同的 UI 导航

**验证标准**：
- 管理员登录后看到聚合看板
- HR 登录后看到自己的工作台

### Phase 5（可选）：运维与审计

**目标**：增强系统可观测性。

**具体工作**：
1. 浏览器实例健康检查（定时 ping CDP endpoint）
2. 审计日志表
3. 实例状态监控面板

### Phase 6（远期）：多租户

当有第二个企业客户时再启动：

1. 增加 `tenants` 表
2. 所有表加 `tenant_id` 字段
3. 鉴权中间件增加租户隔离
4. `worker_nodes` 从 `browser_instances.host` 抽出为独立表

## 17. 最终架构

```text
控制面 (Express 后台)
  ├── 认证: express-session + PG
  ├── 用户: users (enterprise_admin / dept_admin / hr)
  ├── 组织: departments (扁平)
  ├── HR 账号: hr_accounts
  ├── BOSS 账号: boss_accounts
  ├── 浏览器实例: browser_instances (含 cdp_endpoint + host)
  ├── 业务数据: jobs / candidates / runs / schedules (均带 hr_account_id)
  ├── 锁: browser_instances.current_run_id (DB 级)
  └── 调度: SchedulerService 按 HR 维度并行

执行面
  └── 云桌面 (一台或多台)
        ├── Chrome Instance A -> 127.0.0.1:9222 (HR-张三)
        ├── Chrome Instance B -> 127.0.0.1:9223 (HR-李四)
        └── Chrome Instance C -> 127.0.0.1:9224 (HR-王五)

管理视角
  ├── 企业管理员 → 看所有 HR 聚合数据
  ├── 部门管理员 → 看本部门 HR 数据
  └── HR → 看自己的业务数据，操作自己的 BOSS 账号

调用链路 (以 source 任务为例)
  HR 登录 → 前端发起 /api/jobs/:jobKey/tasks/source/trigger
    → authMiddleware 注入 req.user.hr_account_id
    → SchedulerService.triggerJobTask() 校验 jobKey 归属
    → BossCliRunnerFactory.getRunner(hrAccountId) 获取对应 CDP 的 Runner
    → DB 级锁 (browser_instances.current_run_id CAS)
    → SourceLoopService.run() 使用该 Runner 执行
    → 完成后释放锁
```
