# search-boss 企业版部署指南

本文档分两部分：

- **供应商侧**（你）：从源码构建交付包、生成授权
- **客户侧**：拿到交付包后从零部署上线

---

## 〇、供应商侧：构建与交付

> 以下操作在你的开发机上执行，客户不需要看这一节。

### 0.1 前置条件

- 本机已安装 Docker 并启动
- 本机已 clone 本仓库源码，切到 `feature/enterprise-deploy` 分支

### 0.2 一键构建交付包

```bash
./pack.sh 1.0.0
```

脚本自动完成：

1. Docker 多阶段构建（bytenode 编译 JS 为 V8 字节码 → 生产镜像）
2. 导出 `search-boss` 和 `postgres` 离线镜像 tar 包
3. 复制 `docker-compose.yml`、`install.sh`、`.env.template`、`DEPLOY.md`
4. 打包为 `dist/search-boss-enterprise-v1.0.0.tar.gz`

产出物中**不包含任何 JS 源码**，只有编译后的 `.jsc` 字节码。

### 0.3 为客户生成授权文件

**获取客户机器指纹**（让客户在目标机器上执行后发给你）：

```bash
# 客户机器上执行（部署后也可在容器内执行）
docker compose exec search-boss node scripts/generate-license.js fingerprint
```

**生成授权**（在你的开发机上执行）：

```bash
# 绑定指纹 + 有效期 + HR 账号上限
node scripts/generate-license.js generate \
  --customer "某某公司" \
  --fingerprint "客户提供的指纹字符串" \
  --expires 2027-04-03 \
  --max-hr 10 \
  --output dist/search-boss-enterprise-v1.0.0/license/license.key

# 如果不绑定机器（用于试用/POC），指纹传 *
node scripts/generate-license.js generate \
  --customer "试用客户" \
  --fingerprint "*" \
  --expires 2026-07-01 \
  --max-hr 3
```

### 0.4 交付给客户

将以下文件发给客户：

```
dist/search-boss-enterprise-v1.0.0.tar.gz   # 交付包（含离线镜像）
license/license.key                           # 授权文件（单独发送或放入包内）
```

客户收到后按下文部署。

---

## 以下为客户侧部署文档

---

## 一、环境要求

| 项目 | 最低要求 |
|------|----------|
| 操作系统 | Windows 10/11、Ubuntu 20.04+、macOS 12+ |
| Docker | 20.10+ (含 Docker Compose V2) |
| 内存 | 4 GB+ |
| 磁盘 | 20 GB+ |
| Chrome 浏览器 | 宿主机安装，用于 BOSS 招聘端登录 |
| 网络 | 可访问 LLM API 端点（私有化部署可纯内网） |

## 二、交付物清单

```
search-boss-enterprise-v<版本号>/
├── docker-compose.yml          # 服务编排
├── install.sh                  # 一键管理脚本
├── .env.template               # 配置模板
├── DEPLOY.md                   # 本文档
├── images/                     # 离线 Docker 镜像（可选）
│   ├── search-boss-<版本号>.tar
│   └── postgres-16-alpine.tar
└── license/
    └── license.key             # 授权文件
```

## 三、快速部署（6 步完成）

### 步骤 0：解压交付包

```bash
tar xzf search-boss-enterprise-v1.0.0.tar.gz
cd search-boss-enterprise-v1.0.0
```

### 步骤 1：安装 Docker

**Linux (Ubuntu/Debian)：**

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# 重新登录终端使 docker 组生效
```

**Windows：**

安装 [Docker Desktop](https://docs.docker.com/desktop/install/windows-install/)，启动后确认 Docker Engine 运行中。

**macOS：**

安装 [Docker Desktop](https://docs.docker.com/desktop/install/mac-install/)。

**验证：**

```bash
docker --version
docker compose version
```

### 步骤 2：创建配置文件

```bash
cp .env.template .env
```

编辑 `.env`，填写以下必填项：

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `DB_PASSWORD` | 数据库密码 | `MyStr0ngP@ssw0rd` |
| `AGENT_TOKEN` | 内部认证令牌，随机字符串 | `a1b2c3d4e5f6...` |
| `SESSION_SECRET` | Session 密钥，随机字符串 | `x9y8z7w6v5u4...` |
| `LLM_API_BASE` | LLM 接口地址 | `https://your-llm/v1` |
| `LLM_API_KEY` | LLM 接口密钥 | `sk-...` |

> 生成随机字符串：`openssl rand -hex 32`

### 步骤 3：放置授权文件

将收到的 `license.key` 放入 `license/` 目录：

```bash
mkdir -p license
cp /path/to/license.key license/
```

### 步骤 4：启动服务

**在线环境（可访问 Docker Hub）：**

```bash
./install.sh start
```

**离线环境（使用离线镜像包）：**

```bash
./install.sh load-images
./install.sh start
```

首次启动会自动：
- 拉取/加载 Docker 镜像
- 启动 PostgreSQL 数据库
- 启动 search-boss 服务
- 等待服务就绪

### 步骤 5：初始化数据库

```bash
./install.sh db-setup
```

### 步骤 6：启动 Chrome 并登录 BOSS

Chrome 需要在**宿主机**运行（非 Docker 内），因为需要手动扫码/登录 BOSS 招聘端。

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

在 Chrome 窗口中打开 `https://www.zhipin.com`，完成登录，保持窗口不要关闭。

### 部署完成验证

```bash
./install.sh status
```

全部正常时输出：

```
[INFO]  服务状态:
 NAME              STATUS
 search-boss       running
 search-boss-db    running
[INFO]  API 健康检查: 正常
[INFO]  Chrome CDP: 在线
```

访问 `http://localhost:3000` 即可使用管理后台。

---

## 四、Chrome 浏览器配置（补充说明）

> 步骤 6 已覆盖基本启动流程，本节为补充说明。

### 开机自启（可选）

可将 Chrome 启动命令加入系统启动项，避免每次重启后手动操作。

**Linux (systemd)：**

```bash
# /etc/systemd/system/chrome-boss.service
[Unit]
Description=Chrome for BOSS CDP
After=network.target

[Service]
ExecStart=/usr/bin/google-chrome --remote-debugging-port=9222 --user-data-dir=/home/user/.chrome-boss-profile --no-first-run
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

**Windows：**

将 Chrome 启动快捷方式（带 `--remote-debugging-port=9222`）放入 `shell:startup` 文件夹。

### 验证 Chrome 连通性

```bash
curl http://127.0.0.1:9222/json/version
```

应返回包含 `Browser` 字段的 JSON。

## 五、管理命令一览

所有操作通过 `install.sh` 完成：

```bash
./install.sh start          # 启动所有服务
./install.sh stop           # 停止所有服务
./install.sh restart        # 重启所有服务
./install.sh status         # 查看服务状态 + 健康检查
./install.sh logs           # 查看所有日志（实时）
./install.sh logs search-boss  # 仅查看应用日志
./install.sh logs postgres     # 仅查看数据库日志
./install.sh db-setup       # 初始化数据库表结构
./install.sh backup         # 备份数据库 + 简历文件
./install.sh build          # 重新构建镜像
./install.sh export-images  # 导出离线镜像包
./install.sh load-images    # 导入离线镜像包
```

## 六、数据目录说明

| 目录 | 用途 | 持久化方式 |
|------|------|------------|
| `resumes/` | 简历文件存储 | 宿主机目录挂载 |
| `license/` | 授权文件 | 宿主机目录挂载（只读） |
| `backups/` | 备份文件 | 宿主机本地 |
| Docker Volume `pgdata` | PostgreSQL 数据 | Docker 命名卷 |

## 七、配置参数详解

### 必填参数

| 参数 | 说明 |
|------|------|
| `DB_PASSWORD` | PostgreSQL 数据库密码 |
| `AGENT_TOKEN` | 内部 Agent 回调认证令牌 |
| `SESSION_SECRET` | 用户 Session 加密密钥 |

### 可选参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `DB_USER` | `search_boss` | 数据库用户名 |
| `DB_NAME` | `search_boss_ops` | 数据库名 |
| `DB_PORT` | `5432` | 数据库外部映射端口 |
| `BOSS_CDP_ENDPOINT` | `http://host.docker.internal:9222` | Chrome CDP 地址 |
| `BOSS_CLI_ENABLED` | `true` | 是否启用浏览器自动化 |
| `SOURCE_LOOP_ENABLED` | `true` | 是否启用寻源循环 |
| `LLM_API_BASE` | - | LLM 接口地址 |
| `LLM_API_KEY` | - | LLM 接口密钥 |
| `LLM_MODEL` | `gpt-5.4` | LLM 模型名称 |
| `APP_VERSION` | `latest` | 镜像版本标签 |

## 八、授权管理

### 查看授权状态

```bash
curl http://localhost:3000/api/license
```

返回示例：

```json
{
  "valid": true,
  "customer": "某某公司",
  "expiresAt": "2027-04-03",
  "maxHrAccounts": 10,
  "features": []
}
```

### 获取机器指纹

如果授权绑定了硬件指纹，需要先获取目标机器指纹：

```bash
docker compose exec search-boss node scripts/generate-license.js fingerprint
```

将输出的指纹字符串提供给授权方，用于生成绑定该机器的授权文件。

### 更换授权文件

1. 将新的 `license.key` 放入 `license/` 目录
2. 重启服务：`./install.sh restart`

## 九、备份与恢复

### 备份

```bash
./install.sh backup
```

备份内容保存在 `backups/<日期时间>/` 目录下，包含：
- `database.sql` — 完整数据库转储
- `resumes.tar.gz` — 简历文件归档
- `env.backup` — 当前配置备份

### 恢复数据库

```bash
cat backups/<日期时间>/database.sql | \
  docker compose exec -T postgres psql -U search_boss search_boss_ops
```

### 恢复简历文件

```bash
tar xzf backups/<日期时间>/resumes.tar.gz
```

## 十、多 HR 账号部署

系统支持多 HR 账号，每个 HR 绑定独立的 BOSS 账号和浏览器实例。

### 多浏览器实例

每个 BOSS 账号需要独立的 Chrome 实例，使用不同的调试端口：

```bash
# HR 账号 A
chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-boss-a

# HR 账号 B
chrome --remote-debugging-port=9223 --user-data-dir=$HOME/.chrome-boss-b

# HR 账号 C
chrome --remote-debugging-port=9224 --user-data-dir=$HOME/.chrome-boss-c
```

在管理后台的「浏览器实例」页面中配置每个实例的 CDP 地址。

## 十一、离线部署

适用于无法访问互联网的内网环境。

### 在联网机器上准备离线包

```bash
# 构建镜像并导出
./install.sh build
./install.sh export-images

# 打包交付物
tar czf search-boss-enterprise-offline.tar.gz \
  docker-compose.yml install.sh .env.template DEPLOY.md images/ license/
```

### 在目标机器上部署

```bash
# 解压
tar xzf search-boss-enterprise-offline.tar.gz

# 导入镜像
./install.sh load-images

# 配置并启动
cp .env.template .env
# 编辑 .env ...
./install.sh start
./install.sh db-setup
```

## 十二、常见问题

### 服务启动失败

```bash
# 查看详细日志
./install.sh logs search-boss

# 检查配置是否完整
./install.sh status
```

### Chrome CDP 连接不上

1. 确认 Chrome 已带 `--remote-debugging-port=9222` 启动
2. 确认端口未被占用：`curl http://127.0.0.1:9222/json/version`
3. Docker 内通过 `host.docker.internal` 访问宿主机，确认该地址可达

**Windows 特别注意**：如果使用 WSL2 后端的 Docker Desktop，`host.docker.internal` 应能自动解析。如果不行，尝试在 `.env` 中将 `BOSS_CDP_ENDPOINT` 改为宿主机实际 IP。

### 授权文件无效

```bash
# 检查授权状态
curl http://localhost:3000/api/license

# 常见错误：
# license_file_not_found    — license/license.key 文件不存在
# license_expired            — 授权已过期，联系供应商续期
# license_fingerprint_mismatch — 机器指纹不匹配，需重新生成授权
# license_tampered           — 授权文件被篡改
```

### 数据库连接失败

```bash
# 检查 PostgreSQL 容器状态
docker compose ps postgres

# 手动连接测试
docker compose exec postgres psql -U search_boss -d search_boss_ops -c "SELECT 1"
```

### 端口冲突

如果 3000 或 5432 端口已被占用，修改 `.env`：

```bash
PORT=3001        # 修改服务端口
DB_PORT=5433     # 修改数据库外部端口
```

## 十三、升级

1. 备份当前数据：`./install.sh backup`
2. 替换交付物文件（保留 `.env`、`license/`、`resumes/`）
3. 导入新镜像：`./install.sh load-images`
4. 重启服务：`./install.sh restart`
5. 如有数据库变更：`./install.sh db-setup`

## 十四、卸载

```bash
# 停止并移除容器
./install.sh stop

# 如需彻底清除数据库数据
docker volume rm search-boss_pgdata
```

简历文件保存在本地 `resumes/` 目录，不会随容器删除。
