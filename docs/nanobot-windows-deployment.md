# Search-Boss + Nanobot Windows 专用部署文档

## 1. 适用范围

本文档专门说明如何把当前 `search-boss + nanobot + chrome-devtools MCP + PostgreSQL + skills` 这一整套系统迁移到 Windows 环境。

当前项目的真实形态更偏 Unix 本地自动化，不是为 Windows 原生优先设计的。因此在 Windows 上有两种部署路线：

### 路线 A：Windows + WSL2

推荐指数：高

特点：

- `search-boss`
- Nanobot
- workspace
- skills
- `uv`
- Node.js

全部跑在 WSL2 Linux 环境里。

Chrome 跑在 Windows 宿主机，通过远程调试端口 `9222` 给 WSL2 中的 `chrome-devtools-mcp` 使用。

### 路线 B：Windows 原生

推荐指数：中

特点：

- 所有服务都直接跑在 Windows
- 路径、Shell、环境变量、守护方式都要改成 Windows 风格
- skill 里的绝对路径需要更多替换

如果你的目标是“先稳定跑起来”，优先选路线 A。

## 2. 推荐结论

推荐你使用：

```text
Windows 11
  ├── Chrome（Windows）
  ├── PostgreSQL（Windows 或 Docker）
  └── WSL2 Ubuntu
      ├── /home/<user>/search-boss
      └── /home/<user>/.nanobot-boss
```

原因：

- 当前 skill 写法是 Unix 风格
- `uv run nanobot ...`、CLI 调用、目录结构都更适合 Linux
- PowerShell 和 Windows 路径转义会让 skill 和命令示例更脆弱
- WSL2 下更接近你现在的运行方式，迁移成本更低

## 3. 当前项目迁移到 Windows 时的核心变化

### 3.1 路径变化

当前代码和 skill 里有大量 Unix/macOS 风格路径：

- `/Users/coldxiangyu/.nanobot-boss/...`
- `~/work/百融云创/search-boss/...`
- `/opt/...`

Windows 下会变成两种可能：

WSL2：

- `/home/<user>/.nanobot-boss/...`
- `/home/<user>/search-boss/...`

Windows 原生：

- `C:\\search-boss\\...`
- `C:\\nanobot-boss\\...`

### 3.2 Shell 变化

Unix 文档里的：

- `mkdir -p`
- `touch`
- `export`

在 Windows 原生 PowerShell 里都要换写法。

### 3.3 Chrome 启动方式变化

Windows 下 Chrome 路径通常是：

```text
C:\Program Files\Google\Chrome\Application\chrome.exe
```

### 3.4 守护与开机自启变化

Windows 上常用：

- `Task Scheduler`
- `nssm`
- `pm2`
- Windows Service Wrapper

而不是：

- `systemd`
- `launchd`

## 4. 当前仓库里和 Windows 强相关的迁移点

这些地方如果不改，Windows 迁移基本会直接失败。

### 4.1 `search-boss` 服务配置

文件：[src/config.js](/Users/coldxiangyu/.config/superpowers/worktrees/search-boss/restore-a65695f/src/config.js)

默认值里写死了：

- `127.0.0.1:5432`
- `search-boss-local-agent`
- `/Users/coldxiangyu/.nanobot-boss/config.json`

### 4.2 回调 CLI

文件：[scripts/agent-callback-cli.js](/Users/coldxiangyu/.config/superpowers/worktrees/search-boss/restore-a65695f/scripts/agent-callback-cli.js)

默认值里写死了：

- `DEFAULT_API_BASE = 'http://127.0.0.1:3000'`
- `DEFAULT_TOKEN = 'search-boss-local-agent'`

### 4.3 skill 中的绝对路径

以下 skill 里写死了旧机器路径：

- `boss-sourcing/SKILL.md`
- `boss-resume-ingest/SKILL.md`

典型硬编码包括：

- `PROJECT_ROOT = ~/work/百融云创/search-boss`
- `CLI = node ~/work/百融云创/search-boss/scripts/agent-callback-cli.js`
- `NANOBOT_MEMORY_DIR = /Users/coldxiangyu/.nanobot-boss/workspace/memory`
- `RESUME_LEDGER_FILE = /Users/coldxiangyu/.nanobot-boss/workspace/memory/boss-sourcing-resume-ledger.jsonl`
- `LOCAL_API = http://127.0.0.1:3000`
- `TOKEN = search-boss-local-agent`

### 4.4 Nanobot 配置

当前 `config.json` 里写死了：

- workspace 路径
- `allowedUrls`
- `chrome-devtools` 的 `--browser-url=http://127.0.0.1:9222`

## 5. 路线 A：Windows + WSL2 部署

这是推荐路线。

## 5.1 目标结构

```text
Windows
  ├── Chrome
  ├── PostgreSQL（可在 Windows）
  └── WSL2 Ubuntu
      ├── /home/<user>/search-boss
      └── /home/<user>/.nanobot-boss
```

## 5.2 先装基础组件

Windows 宿主机安装：

- Google Chrome
- WSL2
- Ubuntu 22.04 或 24.04
- PostgreSQL for Windows 或 Docker Desktop

WSL2 内安装：

- Git
- Node.js 20+
- npm
- Python 3.11+
- `uv`

WSL2 命令：

```bash
sudo apt update
sudo apt install -y git curl unzip ca-certificates build-essential python3 python3-pip postgresql-client
```

Node.js 建议用 `nvm` 安装。

## 5.3 WSL2 目录规划

推荐目录：

```text
/home/<user>/search-boss
/home/<user>/.nanobot-boss/config.json
/home/<user>/.nanobot-boss/workspace
```

不建议把代码放在：

```text
/mnt/c/...
```

原因：

- 文件 IO 更慢
- 路径混杂
- 某些工具对挂载盘行为不稳定

## 5.4 部署 `search-boss`

在 WSL2 里执行：

```bash
git clone <your-search-boss-repo> ~/search-boss
cd ~/search-boss
npm install
mkdir -p resumes
```

## 5.5 部署 Nanobot 目录

```bash
mkdir -p ~/.nanobot-boss/workspace/skills
mkdir -p ~/.nanobot-boss/workspace/memory
mkdir -p ~/.nanobot-boss/workspace/sessions
mkdir -p ~/.nanobot-boss/workspace/tools
touch ~/.nanobot-boss/workspace/memory/MEMORY.md
touch ~/.nanobot-boss/workspace/memory/HISTORY.md
touch ~/.nanobot-boss/workspace/memory/boss-sourcing-resume-ledger.jsonl
```

## 5.6 复制 skills

把 skill 仓库复制到：

```text
~/.nanobot-boss/workspace/skills
```

至少包含：

- `boss-sourcing`
- `boss-resume-ingest`

## 5.7 修改 skill 中的路径

WSL2 下建议统一替换成：

```text
PROJECT_ROOT = /home/<user>/search-boss
RESUME_DIR   = /home/<user>/search-boss/resumes
CLI          = node /home/<user>/search-boss/scripts/agent-callback-cli.js
LOCAL_API    = http://127.0.0.1:3000
TOKEN        = <your-agent-token>
NANOBOT_MEMORY_DIR = /home/<user>/.nanobot-boss/workspace/memory
MEMORY_SUMMARY_FILE = /home/<user>/.nanobot-boss/workspace/memory/MEMORY.md
MEMORY_HISTORY_FILE = /home/<user>/.nanobot-boss/workspace/memory/HISTORY.md
RESUME_LEDGER_FILE = /home/<user>/.nanobot-boss/workspace/memory/boss-sourcing-resume-ledger.jsonl
```

必须修改的文件：

- `boss-sourcing/SKILL.md`
- `boss-resume-ingest/SKILL.md`

## 5.8 创建 WSL2 下的 Nanobot 配置

示例路径：

```text
/home/<user>/.nanobot-boss/config.json
```

推荐模板：

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
      "workspace": "/home/<user>/.nanobot-boss/workspace"
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
  }
}
```

## 5.9 启动 Windows Chrome 远程调试

在 PowerShell 中启动：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir=C:\chrome-search-boss
```

然后在这个 Chrome 实例里手动登录 BOSS 招聘端。

## 5.10 WSL2 访问 Windows Chrome 调试端口

优先使用：

```text
http://127.0.0.1:9222
```

如果 WSL2 内访问 `127.0.0.1:9222` 不通，再改成 Windows 宿主机 IP。

WSL2 中可先验证：

```bash
curl http://127.0.0.1:9222/json/version
```

如果失败，再找 Windows host IP：

```bash
cat /etc/resolv.conf
```

把其中的 `nameserver` IP 作为 Windows host IP，再把 `config.json` 改成：

```json
"args": [
  "-y",
  "chrome-devtools-mcp@latest",
  "--browser-url=http://<windows-host-ip>:9222"
]
```

## 5.11 数据库部署

有三种可行方式：

### 方式 1：PostgreSQL 跑在 Windows

连接串示例：

```bash
export DATABASE_URL='postgresql://search_boss:strong_password@127.0.0.1:5432/search_boss_ops'
```

如果 WSL2 内访问 `127.0.0.1:5432` 不通，再改成 Windows host IP。

### 方式 2：PostgreSQL 跑在 WSL2

最统一，维护简单，但数据库只在 WSL2 里。

### 方式 3：PostgreSQL 跑在 Docker Desktop

也可以，但网络要自己理顺。

推荐顺序：

1. WSL2 内 PostgreSQL
2. Windows 原生 PostgreSQL
3. Docker Desktop PostgreSQL

## 5.12 初始化数据库

在 WSL2 中：

```bash
cd ~/search-boss
export PORT=3000
export DATABASE_URL='postgresql://search_boss:strong_password@127.0.0.1:5432/search_boss_ops'
export AGENT_TOKEN='replace-with-long-random-token'
export NANOBOT_CONFIG_PATH='/home/<user>/.nanobot-boss/config.json'
npm run db:setup
```

如果还要导历史数据：

```bash
export SOURCE_DATABASE_URL='postgresql://legacy_reader:strong_password@127.0.0.1:5432/search_boss_admin'
npm run db:bootstrap-real
```

## 5.13 启动 `search-boss`

在 WSL2 中：

```bash
cd ~/search-boss
export PORT=3000
export DATABASE_URL='postgresql://search_boss:strong_password@127.0.0.1:5432/search_boss_ops'
export AGENT_TOKEN='replace-with-long-random-token'
export NANOBOT_CONFIG_PATH='/home/<user>/.nanobot-boss/config.json'
npm start
```

## 5.14 验证

WSL2 中依次验证：

```bash
curl http://127.0.0.1:3000/health
node ~/search-boss/scripts/agent-callback-cli.js dashboard-summary --api-base http://127.0.0.1:3000
uv run nanobot agent --config ~/.nanobot-boss/config.json --message '/boss-sourcing --status --run-id "win-wsl2-test-1"'
```

## 6. 路线 B：Windows 原生部署

如果你不想用 WSL2，就走这条。

## 6.1 推荐目录

```text
C:\search-boss
C:\search-boss\resumes
C:\nanobot-boss\config.json
C:\nanobot-boss\workspace
```

## 6.2 安装依赖

必须安装：

- Git for Windows
- Node.js 20+
- Python 3.11+
- `uv`
- PostgreSQL
- Google Chrome

## 6.3 部署代码

PowerShell：

```powershell
git clone <your-search-boss-repo> C:\search-boss
cd C:\search-boss
npm install
New-Item -ItemType Directory -Force C:\search-boss\resumes
```

## 6.4 部署 Nanobot 目录

```powershell
New-Item -ItemType Directory -Force C:\nanobot-boss\workspace\skills
New-Item -ItemType Directory -Force C:\nanobot-boss\workspace\memory
New-Item -ItemType Directory -Force C:\nanobot-boss\workspace\sessions
New-Item -ItemType Directory -Force C:\nanobot-boss\workspace\tools
New-Item -ItemType File -Force C:\nanobot-boss\workspace\memory\MEMORY.md
New-Item -ItemType File -Force C:\nanobot-boss\workspace\memory\HISTORY.md
New-Item -ItemType File -Force C:\nanobot-boss\workspace\memory\boss-sourcing-resume-ledger.jsonl
```

## 6.5 修改 skill 路径

Windows 原生下，建议把 skill 中的路径全部改成正斜杠形式，避免 Markdown 和 shell 示例里反斜杠转义混乱。

例如：

```text
PROJECT_ROOT = C:/search-boss
RESUME_DIR   = C:/search-boss/resumes
CLI          = node C:/search-boss/scripts/agent-callback-cli.js
LOCAL_API    = http://127.0.0.1:3000
TOKEN        = <your-agent-token>
NANOBOT_MEMORY_DIR = C:/nanobot-boss/workspace/memory
MEMORY_SUMMARY_FILE = C:/nanobot-boss/workspace/memory/MEMORY.md
MEMORY_HISTORY_FILE = C:/nanobot-boss/workspace/memory/HISTORY.md
RESUME_LEDGER_FILE = C:/nanobot-boss/workspace/memory/boss-sourcing-resume-ledger.jsonl
```

## 6.6 创建 Windows 原生 `config.json`

示例：

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
      "workspace": "C:/nanobot-boss/workspace"
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
  }
}
```

## 6.7 设置环境变量

PowerShell 当前会话：

```powershell
$env:PORT = "3000"
$env:DATABASE_URL = "postgresql://search_boss:strong_password@127.0.0.1:5432/search_boss_ops"
$env:SOURCE_DATABASE_URL = "postgresql://legacy_reader:strong_password@127.0.0.1:5432/search_boss_admin"
$env:AGENT_TOKEN = "replace-with-long-random-token"
$env:NANOBOT_CONFIG_PATH = "C:\nanobot-boss\config.json"
```

## 6.8 初始化数据库

```powershell
cd C:\search-boss
npm run db:setup
```

如果有源库：

```powershell
npm run db:bootstrap-real
```

## 6.9 启动服务

```powershell
cd C:\search-boss
npm start
```

## 6.10 启动 Chrome

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir=C:\chrome-search-boss
```

## 6.11 验证

```powershell
curl http://127.0.0.1:3000/health
node C:\search-boss\scripts\agent-callback-cli.js dashboard-summary --api-base http://127.0.0.1:3000
uv run nanobot agent --config C:\nanobot-boss\config.json --message '/boss-sourcing --status --run-id "win-native-test-1"'
```

## 7. Windows 上最容易踩的坑

### 7.1 路径没全部替换干净

表现：

- Nanobot 能启动
- skill 能被匹配
- 但执行到 CLI 时提示找不到脚本

根因：

- skill 里还残留 `~/work/...`
- 或 `/Users/...`

### 7.2 `AGENT_TOKEN` 不一致

表现：

- CLI 请求 401

根因：

- `src/config.js` 的 `AGENT_TOKEN`
- skill 里的 `TOKEN`
- CLI 命令里传的 `--token`

三者不一致

### 7.3 Chrome DevTools MCP 连不上

表现：

- `chrome-devtools-mcp` 启动失败
- 或 Nanobot 调浏览器时报连接错误

根因：

- Chrome 没带 `--remote-debugging-port=9222`
- 端口已被占用
- WSL2 内访问不到 Windows `127.0.0.1:9222`

### 7.4 PowerShell 路径转义问题

表现：

- 命令带空格路径时启动失败

根因：

- Chrome 路径没加引号
- Windows 路径反斜杠被错误处理

### 7.5 `resumes` 目录不可写

表现：

- 简历下载动作进行到最后落盘时报错

### 7.6 误以为调度会自动跑

当前仓库没有独立自动 scheduler daemon。

Windows 上如果要定时跑 follow-up，需要你自己加：

- `Task Scheduler`
- 定时 PowerShell 脚本
- pm2
- 额外 worker

## 8. Windows 部署后的推荐核对表

- 已安装 Node.js / npm
- 已安装 Python / `uv`
- 已安装 PostgreSQL
- 已安装 Chrome
- 已创建 `search-boss` 项目目录
- 已创建 Nanobot workspace 目录
- 已复制 skills
- 已替换 skill 里的旧绝对路径
- 已设置 `AGENT_TOKEN`
- 已设置 `DATABASE_URL`
- 已设置 `NANOBOT_CONFIG_PATH`
- 已执行 `npm run db:setup`
- 已创建 `resumes` 目录
- 已启动 Chrome 远程调试端口 `9222`
- 已登录 BOSS 招聘端
- 已验证 `/health`
- 已验证 `agent-callback-cli.js dashboard-summary`
- 已验证 `uv run nanobot agent --config ... --message '/boss-sourcing --status ...'`

## 9. 对你当前项目的最终建议

如果你的目标是：

### 先迁过去稳定可用

选：

- Windows + WSL2

### 完全 Windows 化、给不懂 Linux 的同事用

选：

- Windows 原生

但前提是你要继续做一轮配置改造，把这些地方改成真正跨平台：

- `[src/config.js](/Users/coldxiangyu/.config/superpowers/worktrees/search-boss/restore-a65695f/src/config.js)`
- `[scripts/agent-callback-cli.js](/Users/coldxiangyu/.config/superpowers/worktrees/search-boss/restore-a65695f/scripts/agent-callback-cli.js)`
- `boss-sourcing/SKILL.md`
- `boss-resume-ingest/SKILL.md`
- Nanobot `config.json`

---

如果你下一步要继续，我建议直接做两件事：

1. 把 skill 和配置里的硬编码路径改成“Windows/WSL2 可配置”。
2. 再补一个 `config.windows.example.json` 和 `deploy.windows.ps1`，让 Windows 部署真正可复制。
