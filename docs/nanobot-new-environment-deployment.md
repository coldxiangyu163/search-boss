# Search-Boss + Nanobot 新环境部署文档

## 1. 目标

本文档用于把当前 `search-boss` 项目迁移到一台新环境，并保证以下链路可运行：

1. `search-boss` 本地后台提供管理 UI、Agent API、调度入口和数据库写入能力。
2. `nanobot agent` 按指定 workspace 加载 skill。
3. Nanobot 通过 `chrome-devtools` MCP 驱动已登录 Chrome。
4. skill 通过本地 CLI 回调 `search-boss` API，持续回写 run / candidate / message / action / attachment。
5. PostgreSQL 保存业务数据。

当前项目不是“纯后端部署”结构，而是一个本地自动化编排系统。新环境必须同时具备：

- Node.js 运行时
- Python/`uv` 运行时
- Nanobot 配置与 workspace
- Chrome + 远程调试端口
- PostgreSQL
- `search-boss` 项目代码
- skill 仓库

## 2. 当前架构结论

基于当前代码和本机配置，系统实际由这几部分组成：

### 2.1 `search-boss` 服务

- 单个 Node.js 服务，入口是 `src/server.js`
- 提供 UI、`/health`、`/api/jobs`、`/api/candidates`、`/api/schedules`
- 提供 Agent 回调接口：
  - `POST /api/agent/jobs/batch`
  - `POST /api/agent/runs/:runId/events`
  - `POST /api/agent/runs/:runId/candidates`
  - `POST /api/agent/runs/:runId/messages`
  - `POST /api/agent/runs/:runId/actions`
  - `POST /api/agent/runs/:runId/attachments`
  - `POST /api/agent/runs/:runId/complete`
  - `POST /api/agent/runs/:runId/fail`

### 2.2 PostgreSQL

- 一个目标库，存 `jobs / people / job_candidates / sourcing_runs / sourcing_run_events / candidate_attachments / schedules`
- 一个可选源库，用于 `npm run db:bootstrap-real` 从旧系统导数

### 2.3 Nanobot

- 通过 `uv run nanobot agent --config <config.json>` 启动
- `config.json` 指定：
  - LLM provider
  - 默认 workspace
  - MCP server
  - 允许访问的本地 URL

### 2.4 Nanobot workspace

当前 workspace 目录结构依赖：

- `workspace/skills`
- `workspace/memory`
- `workspace/sessions`
- `workspace/tools`

### 2.5 Chrome DevTools MCP

- Nanobot 配置里当前使用 `npx -y chrome-devtools-mcp@latest --browser-url=http://127.0.0.1:9222`
- 说明 Chrome 必须以远程调试模式启动，并保持 BOSS 招聘端登录态

### 2.6 调度现状

当前仓库里只有“调度数据模型 + 手动触发入口”，没有独立 cron daemon 或 worker 进程。

- `scheduled_jobs` 和 `scheduled_job_runs` 表存在
- `POST /api/schedules/:id/trigger` 可以触发任务
- `POST /api/jobs/:jobKey/tasks/:taskType/trigger` 可以直接触发任务
- 但仓库里没有自动轮询 cron 表达式并执行的后台进程

这意味着新环境如果需要“自动定时运行”，你还需要额外部署一层外部调度：

- system cron
- `launchd`
- `systemd timer`
- CI/CD scheduler
- 你自己的 worker 进程

## 3. 新环境必须部署的内容

下面按“必须 / 可选”列出。

### 3.1 必须部署

- `search-boss` 项目代码
- Node.js 与 `npm`
- PostgreSQL
- Python 运行时
- `uv`
- Nanobot CLI 可执行能力
- Nanobot 配置文件
- Nanobot workspace
- skill 仓库内容
- Chrome 浏览器
- Chrome 远程调试端口 `9222`
- BOSS 招聘端登录态
- 本地简历落盘目录 `resumes/`

### 3.2 可选部署

- 源数据库，用于历史数据导入
- 外部定时调度器
- 反向代理
- systemd / pm2 / supervisor 守护
- secrets manager
- 日志采集

## 4. 当前代码里的硬编码与强绑定项

这是迁移时最容易漏掉的地方。

### 4.1 `search-boss` 服务硬编码

文件：`src/config.js`

- 默认端口：`3000`
- 默认目标库：`postgresql://...@127.0.0.1:5432/search_boss_ops_20260324`
- 默认源库：`postgresql://...@127.0.0.1:5432/search_boss_admin`
- 默认 Agent Token：`search-boss-local-agent`
- 默认 Nanobot 配置路径：`/Users/coldxiangyu/.nanobot-boss/config.json`

文件：`scripts/agent-callback-cli.js`

- 默认 API 地址：`http://127.0.0.1:3000`
- 默认 token：`search-boss-local-agent`

### 4.2 Nanobot 配置硬编码

文件：`~/.nanobot-boss/config.json`

- `agents.defaults.workspace` 当前写死为：
  - `/Users/coldxiangyu/.nanobot-boss/workspace`
- `tools.exec.allowedUrls` 当前只允许：
  - `http://127.0.0.1:3000/`
  - `http://localhost:3000/`
- `chrome-devtools` MCP 当前写死：
  - `--browser-url=http://127.0.0.1:9222`

### 4.3 skill 硬编码

文件：`workspace/skills/boss-sourcing/SKILL.md`

- `PROJECT_ROOT = ~/work/百融云创/search-boss`
- `LOCAL_API = http://127.0.0.1:3000`
- `CLI = node ~/work/百融云创/search-boss/scripts/agent-callback-cli.js`
- `TOKEN = search-boss-local-agent`
- `NANOBOT_MEMORY_DIR = /Users/coldxiangyu/.nanobot-boss/workspace/memory`
- `MEMORY_SUMMARY_FILE = /Users/coldxiangyu/.nanobot-boss/workspace/memory/MEMORY.md`
- `MEMORY_HISTORY_FILE = /Users/coldxiangyu/.nanobot-boss/workspace/memory/HISTORY.md`
- `RESUME_LEDGER_FILE = /Users/coldxiangyu/.nanobot-boss/workspace/memory/boss-sourcing-resume-ledger.jsonl`
- 示例命令里还写死了：
  - `uv run nanobot agent --config "/Users/coldxiangyu/.nanobot-boss/config.json" ...`

文件：`workspace/skills/boss-resume-ingest/SKILL.md`

- `PROJECT_ROOT = ~/work/百融云创/search-boss`
- `CLI = node ~/work/百融云创/search-boss/scripts/agent-callback-cli.js`
- `RESUME_LEDGER_FILE = /Users/coldxiangyu/.nanobot-boss/workspace/memory/boss-sourcing-resume-ledger.jsonl`

### 4.4 数据和运行目录强绑定

- 简历默认保存到：`$PROJECT_ROOT/resumes`
- skill 临时文件依赖：
  - `workspace/sessions`
  - `tmp/*.json`
- Nanobot 记忆文件依赖：
  - `workspace/memory/MEMORY.md`
  - `workspace/memory/HISTORY.md`
  - `workspace/memory/boss-sourcing-resume-ledger.jsonl`

## 5. 新环境推荐目录布局

建议不要继续依赖当前机器的绝对路径，直接在新环境统一规划。

示例：

```text
/opt/search-boss
  ├── package.json
  ├── src/
  ├── scripts/
  ├── public/
  ├── docs/
  └── resumes/

/opt/nanobot-boss
  ├── config.json
  └── workspace
      ├── skills
      ├── memory
      ├── sessions
      └── tools
```

如果你为了“最小改动迁移”，也可以在新环境保留兼容路径或建立软链，但这只是过渡方案，不是推荐长期方案。

## 6. 新环境变量与配置清单

当前项目没有内置 `dotenv`，所以你需要通过 shell、systemd、pm2、容器环境变量等方式注入。

### 6.1 `search-boss` 服务环境变量

必须：

- `PORT`
- `DATABASE_URL`
- `AGENT_TOKEN`
- `NANOBOT_CONFIG_PATH`

按需：

- `SOURCE_DATABASE_URL`

推荐示例：

```bash
export PORT=3000
export DATABASE_URL='postgresql://search_boss:strong_password@127.0.0.1:5432/search_boss_ops'
export SOURCE_DATABASE_URL='postgresql://legacy_reader:strong_password@127.0.0.1:5432/search_boss_admin'
export AGENT_TOKEN='replace-with-long-random-token'
export NANOBOT_CONFIG_PATH='/opt/nanobot-boss/config.json'
```

### 6.2 Nanobot 配置项

`/opt/nanobot-boss/config.json` 至少要包含：

- provider 配置
- 默认 agent model
- 默认 workspace 路径
- `exec.allowedUrls`
- `mcpServers.chrome-devtools`

建议模板：

```json
{
  "providers": {
    "custom": {
      "apiKey": "${LLM_API_KEY}",
      "apiBase": "https://your-llm-endpoint.example.com/v1"
    }
  },
  "agents": {
    "defaults": {
      "model": "gpt-5.4",
      "provider": "custom",
      "maxTokens": 8192,
      "temperature": 1.0,
      "maxToolIterations": 120,
      "workspace": "/opt/nanobot-boss/workspace"
    }
  },
  "tools": {
    "exec": {
      "allowedUrls": [
        "http://127.0.0.1:3000/",
        "http://localhost:3000/"
      ]
    },
    "mcpServers": {
      "sequential-thinking": {
        "command": "npx",
        "args": [
          "-y",
          "@modelcontextprotocol/server-sequential-thinking"
        ],
        "toolTimeout": 60
      },
      "chrome-devtools": {
        "command": "npx",
        "args": [
          "-y",
          "chrome-devtools-mcp@latest",
          "--browser-url=http://127.0.0.1:9222"
        ],
        "toolTimeout": 60
      }
    }
  },
  "gateway": {
    "port": 18791
  }
}
```

注意：不要把当前机器的真实 provider key、Slack token、Feishu secret 原样复制到新环境文档或代码库里，应改成密钥管理方式。

## 7. 新环境部署步骤

以下顺序是实际可执行顺序。

### 7.1 安装系统依赖

必须安装：

- Git
- Node.js 20+
- npm
- Python 3.11+
- `uv`
- PostgreSQL 14+
- Google Chrome

验证命令：

```bash
node -v
npm -v
python3 --version
uv --version
psql --version
google-chrome --version || /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --version
```

### 7.2 部署 `search-boss` 代码

```bash
git clone <your-search-boss-repo> /opt/search-boss
cd /opt/search-boss
npm install
mkdir -p resumes
```

### 7.3 创建数据库

至少准备目标库：

```sql
create user search_boss with password 'strong_password';
create database search_boss_ops owner search_boss;
```

如果需要历史导数，再准备源库访问账号：

```sql
create user legacy_reader with password 'strong_password';
grant connect on database search_boss_admin to legacy_reader;
```

### 7.4 初始化目标库

```bash
cd /opt/search-boss
export DATABASE_URL='postgresql://search_boss:strong_password@127.0.0.1:5432/search_boss_ops'
npm run db:setup
```

如果要从旧库导入：

```bash
export SOURCE_DATABASE_URL='postgresql://legacy_reader:strong_password@127.0.0.1:5432/search_boss_admin'
npm run db:bootstrap-real
```

### 7.5 部署 Nanobot 目录

```bash
mkdir -p /opt/nanobot-boss/workspace/skills
mkdir -p /opt/nanobot-boss/workspace/memory
mkdir -p /opt/nanobot-boss/workspace/sessions
mkdir -p /opt/nanobot-boss/workspace/tools
```

初始化记忆文件：

```bash
touch /opt/nanobot-boss/workspace/memory/MEMORY.md
touch /opt/nanobot-boss/workspace/memory/HISTORY.md
touch /opt/nanobot-boss/workspace/memory/boss-sourcing-resume-ledger.jsonl
```

### 7.6 部署 skill 仓库

把当前 skill 仓库内容复制到：

```text
/opt/nanobot-boss/workspace/skills
```

至少包括：

- `boss-sourcing/`
- `boss-resume-ingest/`

如果 `skills` 本身就是独立 Git 仓库，建议继续以独立仓库管理。

### 7.7 修复 skill 中的硬编码路径

这是迁移成功的关键步骤。你至少要替换以下值：

- `~/work/百融云创/search-boss` -> `/opt/search-boss`
- `node ~/work/百融云创/search-boss/scripts/agent-callback-cli.js` -> `node /opt/search-boss/scripts/agent-callback-cli.js`
- `/Users/coldxiangyu/.nanobot-boss/workspace/memory` -> `/opt/nanobot-boss/workspace/memory`
- `/Users/coldxiangyu/.nanobot-boss/config.json` -> `/opt/nanobot-boss/config.json`
- `http://127.0.0.1:3000` 如果你改端口或 host，需要同步替换
- `search-boss-local-agent` 如果换 token，需要同步替换

推荐直接改这两个文件：

- `workspace/skills/boss-sourcing/SKILL.md`
- `workspace/skills/boss-resume-ingest/SKILL.md`

### 7.8 创建 Nanobot 配置

把 `config.json` 放到：

```text
/opt/nanobot-boss/config.json
```

必须确认：

- `workspace` 指向 `/opt/nanobot-boss/workspace`
- `allowedUrls` 覆盖 `search-boss` 实际地址
- `chrome-devtools` 指向正确远程调试端口

### 7.9 启动 Chrome 远程调试

Chrome 必须带 `9222` 调试端口启动。

macOS 示例：

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-search-boss
```

Linux 示例：

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-search-boss
```

然后手动登录 BOSS 招聘端。

### 7.10 启动 `search-boss`

```bash
cd /opt/search-boss
export PORT=3000
export DATABASE_URL='postgresql://search_boss:strong_password@127.0.0.1:5432/search_boss_ops'
export AGENT_TOKEN='replace-with-long-random-token'
export NANOBOT_CONFIG_PATH='/opt/nanobot-boss/config.json'
npm start
```

### 7.11 验证后台可用

```bash
curl http://127.0.0.1:3000/health
```

预期：

```json
{"status":"ok"}
```

### 7.12 验证回调 CLI

```bash
cd /opt/search-boss
node scripts/agent-callback-cli.js dashboard-summary \
  --api-base http://127.0.0.1:3000
```

如果你换了 token，写接口命令要显式带：

```bash
node scripts/agent-callback-cli.js jobs-batch \
  --run-id 1 \
  --file ./tmp/payload.json \
  --api-base http://127.0.0.1:3000 \
  --token "$AGENT_TOKEN"
```

### 7.13 验证 Nanobot + skill + MCP

```bash
uv run nanobot agent \
  --config /opt/nanobot-boss/config.json \
  --message '/boss-sourcing --status --run-id "test-status-1"'
```

如果状态查询能正常执行，说明这几层已经打通：

- Nanobot CLI
- workspace
- skill 发现
- MCP 启动
- 本地 API 访问

## 8. 推荐的上线检查清单

### 8.1 服务检查

- `npm start` 启动无报错
- `GET /health` 返回 `ok`
- 首页静态资源可访问
- `GET /api/dashboard/summary` 返回数据

### 8.2 数据库检查

- `jobs`
- `people`
- `job_candidates`
- `candidate_messages`
- `candidate_actions`
- `candidate_attachments`
- `sourcing_runs`
- `sourcing_run_events`
- `scheduled_jobs`
- `scheduled_job_runs`

### 8.3 Nanobot 检查

- `uv run nanobot ...` 可正常启动
- 能找到 `/opt/nanobot-boss/workspace/skills`
- `chrome-devtools` MCP 能连接到 `9222`
- skill 中的 `CLI` 指向存在的脚本
- `allowedUrls` 包含实际 API 地址

### 8.4 浏览器检查

- Chrome 已登录 BOSS
- 远程调试端口 `9222` 可连接
- 打开职位页、沟通页、推荐页时没有登录跳转

### 8.5 文件系统检查

- `/opt/search-boss/resumes` 可写
- `/opt/nanobot-boss/workspace/memory` 可写
- `/opt/nanobot-boss/workspace/sessions` 可写

## 9. 自动化调度的额外部署

如果你想让 follow-up 自动跑，当前仓库还不够，需要额外加一层调度器。

最简单做法是外部 cron 定时调用：

```bash
curl -X POST http://127.0.0.1:3000/api/jobs/<jobKey>/tasks/followup/trigger
```

或者先写入 schedule，再由你自己的守护进程去轮询 `scheduled_jobs`。

当前代码并不会自动解析 `cron_expression` 并执行。

## 10. 最推荐的迁移策略

### 方案 A：兼容迁移，最快上线

- 新环境尽量复刻原路径结构
- 或通过软链模拟旧路径
- 只改少量配置

优点：

- 改动最小
- skill 几乎不用重写

缺点：

- 后续维护继续绑定旧机器目录
- 路径不可移植

### 方案 B：标准化迁移，推荐

- 统一新目录，如 `/opt/search-boss` 与 `/opt/nanobot-boss`
- 全量替换 skill、Nanobot config、CLI 默认地址
- secrets 改为环境变量或密钥管理

优点：

- 以后可重复部署
- 更适合服务器和多人协作

缺点：

- 首次梳理成本高一点

## 11. 建议马上做的加固项

这些不是“迁移必须”，但非常建议尽快补：

- 把 `src/config.js` 的默认数据库连接串移除，改为必须显式注入
- 把 `scripts/agent-callback-cli.js` 默认 `apiBase` 和 `token` 改为从环境变量读取
- 把 skill 里的 `PROJECT_ROOT`、`CLI`、`LOCAL_API`、`TOKEN`、`NANOBOT_MEMORY_DIR` 全部改成占位变量或明确的部署说明
- 把 Nanobot `config.json` 里的 provider key、Slack、Feishu 等敏感信息迁出代码文件
- 补一个真正的 `.env.example` 或 `deploy.env.example`
- 如果要长期自动运行，增加守护进程和真正的 scheduler worker

## 12. 最终迁移核对表

迁移完成前，逐项确认：

- 已部署 `search-boss` 代码
- 已安装 Node.js / npm
- 已安装 Python / `uv`
- 已安装 PostgreSQL
- 已创建目标数据库
- 已执行 `npm run db:setup`
- 已创建 `/opt/search-boss/resumes`
- 已部署 `/opt/nanobot-boss/config.json`
- 已部署 `/opt/nanobot-boss/workspace`
- 已复制 `skills`
- 已修正 `boss-sourcing` 的路径和 API 地址
- 已修正 `boss-resume-ingest` 的路径和 API 地址
- 已启动 Chrome 远程调试 `9222`
- Chrome 已登录 BOSS
- `GET /health` 正常
- `agent-callback-cli.js dashboard-summary` 正常
- `uv run nanobot agent --config ... --message '/boss-sourcing --status ...'` 正常

## 13. 你这个项目当前最关键的迁移风险

按优先级排序：

1. skill 里写死了旧电脑项目路径，导致 Nanobot 能启动但 CLI 回调失败。
2. Nanobot `workspace` 写死了旧用户家目录，导致找不到 skill / memory / sessions。
3. `allowedUrls` 只放行 `127.0.0.1:3000`，一旦新环境改端口或走域名，本地 API 会被 Nanobot 拒绝。
4. `AGENT_TOKEN` 与 skill 文档中的 `TOKEN` 不一致，导致写接口 401。
5. Chrome 没有用 `9222` 远程调试启动，`chrome-devtools` MCP 直接不可用。
6. 新环境没有 `resumes/` 写权限，附件下载流程会在落盘阶段失败。
7. 以为 `scheduled_jobs` 已经自动生效，实际上并没有独立调度进程。

---

如果你下一步要我继续，我建议直接做两件事：

1. 把这套文档再收敛成一份你可以直接执行的“部署检查表 + 配置模板”。
2. 顺手把仓库里的硬编码项改成可配置版本，至少先把 `src/config.js`、`scripts/agent-callback-cli.js` 和两个 skill 的路径改掉。
