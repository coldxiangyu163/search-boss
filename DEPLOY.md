# search-boss 企业版 — 交付与部署手册

---

## 全局角色说明

| 角色 | 说明 |
|------|------|
| **供应商** | 拥有源码，负责构建镜像、生成授权、交付安装包 |
| **客户** | 拥有服务器，负责安装部署、日常运维、浏览器登录 |

---

# 第一部分：供应商操作

> 本部分在供应商开发机上执行，客户不需要阅读。

## 1. 构建交付包

### 前置条件

- 已 clone 源码仓库
- 本机 Docker 已启动

### 执行构建

```bash
./pack.sh 1.0.0
```

构建过程（全自动）：

```
源码 JS 文件
  → Docker 内 bytenode 编译为 V8 字节码 (.jsc)
  → 生成生产镜像 search-boss:1.0.0
  → 导出 search-boss + postgres 离线镜像 tar
  → 组装交付目录
  → 打包为 dist/search-boss-enterprise-v1.0.0.tar.gz
```

产出物中不包含任何可读 JS 源码。

### 交付包内容

```
search-boss-enterprise-v1.0.0/
├── docker-compose.yml        # 容器编排
├── install.sh                # 一键管理脚本
├── .env.template             # 配置模板
├── DEPLOY.md                 # 部署文档
├── images/                   # 离线 Docker 镜像
│   ├── search-boss-1.0.0.tar
│   └── postgres-16-alpine.tar
├── license/                  # 授权文件目录（待放入）
├── resumes/                  # 简历存储目录
└── backups/                  # 备份目录
```

## 2. 生成授权文件

### 场景 A：试用 / POC（不绑定机器）

```bash
node scripts/generate-license.js generate \
  --customer "某某公司" \
  --fingerprint "*" \
  --expires 2026-07-01 \
  --max-hr 3 \
  --output dist/search-boss-enterprise-v1.0.0/license/license.key
```

### 场景 B：正式交付（绑定机器指纹）

先让客户在目标服务器上获取指纹（见第二部分步骤 5），拿到指纹后：

```bash
node scripts/generate-license.js generate \
  --customer "某某公司" \
  --fingerprint "客户提供的64位hex字符串" \
  --expires 2027-04-03 \
  --max-hr 10 \
  --output dist/search-boss-enterprise-v1.0.0/license/license.key
```

### 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `--customer` | 是 | 客户名称 |
| `--fingerprint` | 是 | 机器指纹，`*` 表示不绑定 |
| `--expires` | 否 | 到期日期 YYYY-MM-DD，默认 1 年后 |
| `--max-hr` | 否 | HR 账号上限，0 表示不限 |
| `--output` | 否 | 输出路径，默认 `license/license.key` |

## 3. 交付给客户

将以下内容发送给客户：

```
search-boss-enterprise-v1.0.0.tar.gz    # 安装包
```

授权文件已包含在包内 `license/license.key`。如需单独发送，客户放入 `license/` 目录即可。

---

# 第二部分：客户部署

> 以下所有操作在客户服务器上执行。

## 运行架构

```
┌─────────────────────────────────────────────┐
│                 客户服务器                    │
│                                             │
│  ┌─── Docker ─────────────────────────┐     │
│  │                                    │     │
│  │  search-boss 容器 (:3000)          │     │
│  │    └─ 管理后台 + API + 自动化引擎   │     │
│  │                                    │     │
│  │  PostgreSQL 容器 (:5432)           │     │
│  │    └─ 业务数据                     │     │
│  │                                    │     │
│  └────────────────────────────────────┘     │
│                    │                         │
│                    │ CDP (9222)               │
│                    ▼                         │
│  Chrome 浏览器（宿主机运行）                  │
│    └─ BOSS 招聘端登录态                      │
│                                             │
│  resumes/  ← 简历文件（本地磁盘）             │
│  license/  ← 授权文件（本地磁盘）             │
└─────────────────────────────────────────────┘
                    │
                    │ HTTPS（仅此一个外部连接）
                    ▼
            私有化 LLM 端点
```

所有数据留在客户本地，唯一的外部请求是 LLM 推理接口（可部署在客户内网）。

## 环境要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10/11、Ubuntu 20.04+、macOS 12+ |
| Docker | 20.10+，含 Docker Compose V2 |
| 内存 | 4 GB+ |
| 磁盘 | 20 GB+ |
| Chrome | 宿主机安装 |
| 网络 | 内网即可（LLM 端点可内网部署） |

## 部署步骤

### 步骤 1：解压安装包

```bash
tar xzf search-boss-enterprise-v1.0.0.tar.gz
cd search-boss-enterprise-v1.0.0
```

### 步骤 2：安装 Docker（已有则跳过）

**Linux：**

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# 重新登录终端
```

**Windows / macOS：**

安装 Docker Desktop 并启动。

**验证：**

```bash
docker --version
docker compose version
```

### 步骤 3：填写配置

```bash
cp .env.template .env
```

编辑 `.env`，填写必填项：

| 配置项 | 说明 | 生成方式 |
|--------|------|----------|
| `DB_PASSWORD` | 数据库密码 | 自定义强密码 |
| `AGENT_TOKEN` | 内部认证令牌 | `openssl rand -hex 32` |
| `SESSION_SECRET` | Session 密钥 | `openssl rand -hex 32` |
| `LLM_API_BASE` | LLM 接口地址 | 向 LLM 提供方获取 |
| `LLM_API_KEY` | LLM 接口密钥 | 向 LLM 提供方获取 |

其他参数均有默认值，通常无需修改。完整参数见附录 A。

### 步骤 4：导入镜像并启动

```bash
# 导入离线镜像（离线环境必须，在线环境可跳过）
./install.sh load-images

# 启动服务
./install.sh start
```

脚本自动完成：校验配置 → 启动 PostgreSQL → 启动 search-boss → 等待健康检查通过。

### 步骤 5：初始化数据库

```bash
./install.sh db-setup
```

### 步骤 6：获取机器指纹（按需）

如果供应商要求提供机器指纹用于授权绑定：

```bash
docker compose exec search-boss node scripts/generate-license.js fingerprint
```

将输出的 64 位字符串发送给供应商。供应商据此生成绑定本机的授权文件。

### 步骤 7：启动 Chrome 并登录

Chrome 必须在宿主机运行（需要手动扫码登录 BOSS 招聘端）。

**macOS：**

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=$HOME/.chrome-boss-profile
```

**Windows（PowerShell）：**

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir=C:\chrome-boss-profile
```

**Linux：**

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=$HOME/.chrome-boss-profile
```

在打开的 Chrome 中访问 `https://www.zhipin.com`，完成登录，**保持窗口不要关闭**。

### 步骤 8：验证部署

```bash
./install.sh status
```

预期输出：

```
[INFO]  服务状态:
 NAME              STATUS
 search-boss       running
 search-boss-db    running
[INFO]  API 健康检查: 正常
[INFO]  Chrome CDP: 在线
```

访问 `http://localhost:3000` 进入管理后台。

---

# 第三部分：日常运维

## 管理命令

| 命令 | 说明 |
|------|------|
| `./install.sh start` | 启动所有服务 |
| `./install.sh stop` | 停止所有服务 |
| `./install.sh restart` | 重启所有服务 |
| `./install.sh status` | 服务状态 + 健康检查 |
| `./install.sh logs` | 查看全部日志（实时） |
| `./install.sh logs search-boss` | 仅查看应用日志 |
| `./install.sh logs postgres` | 仅查看数据库日志 |
| `./install.sh db-setup` | 初始化/升级数据库 |
| `./install.sh backup` | 备份数据库 + 简历 |
| `./install.sh load-images` | 导入离线镜像 |

## 备份与恢复

### 备份

```bash
./install.sh backup
```

产出在 `backups/<日期时间>/`：

| 文件 | 内容 |
|------|------|
| `database.sql` | 完整数据库转储 |
| `resumes.tar.gz` | 简历文件归档 |
| `env.backup` | 当前配置 |

### 恢复

```bash
# 恢复数据库
cat backups/20260403-120000/database.sql | \
  docker compose exec -T postgres psql -U search_boss search_boss_ops

# 恢复简历
tar xzf backups/20260403-120000/resumes.tar.gz
```

## 数据目录

| 目录 | 用途 | 说明 |
|------|------|------|
| `resumes/` | 简历文件 | 挂载到宿主机，容器删除不丢失 |
| `license/` | 授权文件 | 只读挂载到容器 |
| `backups/` | 备份文件 | 宿主机本地 |
| Docker Volume `pgdata` | 数据库 | Docker 命名卷管理 |

---

# 第四部分：授权管理与续期

## 查看授权状态

```bash
curl http://localhost:3000/api/license
```

三种状态：

**正常（剩余 > 30 天）：**

```json
{
  "valid": true,
  "customer": "某某公司",
  "expiresAt": "2027-04-03",
  "maxHrAccounts": 10,
  "daysRemaining": 365
}
```

**即将到期（剩余 <= 30 天，服务正常但有预警）：**

```json
{
  "valid": true,
  "customer": "某某公司",
  "expiresAt": "2026-04-20",
  "daysRemaining": 17,
  "warning": {
    "expiresSoon": true,
    "daysRemaining": 17,
    "message": "授权将在 17 天后到期"
  }
}
```

此时所有 API 响应头附带 `X-License-Warning` 和 `X-License-Days-Remaining`。

**已过期（所有业务 API 返回 403）：**

```json
{
  "valid": false,
  "error": "license_expired",
  "message": "授权已过期 (2026-04-01)"
}
```

## 续期流程

```
客户                                 供应商
 │                                    │
 │  1. curl /api/license 发现到期      │
 │                                    │
 │  2. 获取机器指纹                    │
 │     docker compose exec            │
 │       search-boss node             │
 │       scripts/generate-license.js  │
 │       fingerprint                  │
 │                                    │
 │  3. 将指纹发送给供应商              │
 │  ────────────────────────────────> │
 │                                    │  4. 生成新授权
 │                                    │     node scripts/generate-license.js
 │                                    │       generate
 │                                    │       --customer "客户名"
 │                                    │       --fingerprint "指纹"
 │                                    │       --expires 2028-04-03
 │                                    │       --max-hr 10
 │  5. 收到新 license.key              │
 │  <──────────────────────────────── │
 │                                    │
 │  6. 替换文件                        │
 │     cp new-license.key             │
 │        license/license.key         │
 │                                    │
 │  7. 生效（二选一）                   │
 │     A) 热加载: curl -X POST        │
 │        localhost:3000              │
 │        /api/license/reload         │
 │     B) 重启: ./install.sh restart  │
 │                                    │
 │  8. 验证                            │
 │     curl /api/license              │
 │     确认 valid=true                 │
 └────────────────────────────────────┘
```

### 热加载续期（推荐，零停机）

```bash
cp /path/to/new-license.key license/license.key
curl -X POST http://localhost:3000/api/license/reload
```

返回 `valid: true` 即续期成功，无需重启，不影响正在使用的用户。

### 重启续期

```bash
cp /path/to/new-license.key license/license.key
./install.sh restart
```

## 授权状态速查表

| 状态 | API 表现 | 用户影响 | 处理方式 |
|------|----------|----------|----------|
| 正常 (>30天) | 正常 | 无 | 无需操作 |
| 即将到期 (<=30天) | 正常 + Warning 头 | 前端可弹窗提醒 | 联系供应商续期 |
| 已过期 | 业务 API 403 | 无法操作 | 替换 license.key + 热加载 |
| 文件缺失 | 业务 API 403 | 无法操作 | 放入 license.key |
| 被篡改 | 业务 API 403 | 无法操作 | 使用原始 license.key |
| 指纹不匹配 | 业务 API 403 | 无法操作 | 联系供应商重新生成 |

> `/health` 和登录接口不受授权限制，始终可用。

---

# 第五部分：多 HR 账号 / 多浏览器实例

每个 HR 绑定独立 BOSS 账号，每个 BOSS 账号对应独立 Chrome 实例。

### 启动多个 Chrome 实例

```bash
# HR-张三
chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-boss-a

# HR-李四
chrome --remote-debugging-port=9223 --user-data-dir=$HOME/.chrome-boss-b

# HR-王五
chrome --remote-debugging-port=9224 --user-data-dir=$HOME/.chrome-boss-c
```

每个 Chrome 窗口单独登录对应的 BOSS 账号。

### 在管理后台配置

进入管理后台 → 浏览器实例，为每个 HR 账号添加对应的 CDP 地址：

| HR 账号 | CDP 地址 |
|---------|----------|
| 张三 | `http://host.docker.internal:9222` |
| 李四 | `http://host.docker.internal:9223` |
| 王五 | `http://host.docker.internal:9224` |

---

# 第六部分：版本升级

```bash
# 1. 备份
./install.sh backup

# 2. 解压新版本（保留旧的 .env、license/、resumes/）
tar xzf search-boss-enterprise-v1.1.0.tar.gz
cp /old/.env search-boss-enterprise-v1.1.0/
cp -r /old/license search-boss-enterprise-v1.1.0/
cd search-boss-enterprise-v1.1.0

# 3. 导入新镜像
./install.sh load-images

# 4. 重启
./install.sh restart

# 5. 如有数据库变更
./install.sh db-setup
```

---

# 第七部分：卸载

```bash
# 停止服务
./install.sh stop

# 彻底清除数据库（不可逆）
docker volume rm search-boss_pgdata
```

`resumes/` 目录保留在宿主机，不随容器删除。

---

# 附录

## 附录 A：完整配置参数

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `DB_PASSWORD` | 是 | — | 数据库密码 |
| `AGENT_TOKEN` | 是 | — | 内部认证令牌 |
| `SESSION_SECRET` | 是 | — | Session 密钥 |
| `LLM_API_BASE` | 按需 | — | LLM 接口地址 |
| `LLM_API_KEY` | 按需 | — | LLM 接口密钥 |
| `PORT` | 否 | `3000` | 服务端口 |
| `DB_USER` | 否 | `search_boss` | 数据库用户名 |
| `DB_NAME` | 否 | `search_boss_ops` | 数据库名 |
| `DB_PORT` | 否 | `5432` | 数据库外部端口 |
| `BOSS_CDP_ENDPOINT` | 否 | `http://host.docker.internal:9222` | Chrome CDP 地址 |
| `BOSS_CLI_ENABLED` | 否 | `true` | 启用浏览器自动化 |
| `SOURCE_LOOP_ENABLED` | 否 | `true` | 启用寻源循环 |
| `LLM_MODEL` | 否 | `gpt-5.4` | LLM 模型 |
| `APP_VERSION` | 否 | `latest` | 镜像版本标签 |

## 附录 B：常见问题

### 服务启动失败

```bash
./install.sh logs search-boss
```

常见原因：`.env` 必填项未填写、Docker 未启动、端口被占用。

### Chrome CDP 连接不上

1. 确认 Chrome 带 `--remote-debugging-port=9222` 启动
2. 验证端口：`curl http://127.0.0.1:9222/json/version`
3. Windows WSL2 场景下 `host.docker.internal` 不通时，改用宿主机 IP

### 数据库连接失败

```bash
docker compose ps postgres
docker compose exec postgres psql -U search_boss -d search_boss_ops -c "SELECT 1"
```

### 端口冲突

修改 `.env`：

```bash
PORT=3001
DB_PORT=5433
```

## 附录 C：Chrome 开机自启（可选）

**Linux (systemd)：**

```ini
# /etc/systemd/system/chrome-boss.service
[Unit]
Description=Chrome for BOSS CDP
After=network.target

[Service]
ExecStart=/usr/bin/google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/home/user/.chrome-boss-profile \
  --no-first-run
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable chrome-boss
sudo systemctl start chrome-boss
```

**Windows：**

创建 Chrome 快捷方式，目标追加 `--remote-debugging-port=9222 --user-data-dir=C:\chrome-boss-profile`，放入 `shell:startup` 文件夹。
