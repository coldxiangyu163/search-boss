# Search BOSS — 寻源管理系统

基于 Node.js / Express 的 BOSS 直聘寻源管理后端，通过 AI Agent（Nanobot）驱动浏览器自动化完成候选人寻源、打招呼、简历获取等操作。

## 功能概述

- 职位管理与寻源任务调度
- AI Agent 自动驱动浏览器完成寻源流程
- 候选人数据回写与状态跟踪
- 管理后台 UI（`public/`）
- PostgreSQL 持久化存储

## 技术栈

- **运行时**: Node.js
- **框架**: Express 5
- **数据库**: PostgreSQL（pg）
- **任务调度**: Graphile Worker
- **Agent**: Nanobot + Chrome DevTools
- **测试**: node:test + supertest

## 快速开始

```bash
# 安装依赖
npm install

# 初始化数据库
npm run db:setup

# 导入基础数据
npm run db:bootstrap-real

# 启动服务
npm start
```

## 环境变量

复制 `deploy.env.example` 并修改：

| 变量 | 说明 |
|------|------|
| `PORT` | 服务端口，默认 3000 |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `SOURCE_DATABASE_URL` | 源数据库连接串 |
| `AGENT_TOKEN` | Agent 鉴权令牌 |
| `NANOBOT_CONFIG_PATH` | Nanobot 配置文件路径 |
| `SEARCH_BOSS_API_BASE` | 本服务回调地址 |
| `SEARCH_BOSS_AGENT_TOKEN` | Agent 回调令牌 |

## 项目结构

```
src/
  app.js            # Express 路由
  server.js         # 启动入口
  services/         # 业务逻辑
  db/               # 数据库 schema 与连接池
public/             # 管理后台静态页面
scripts/            # 运维脚本与 Agent 回调 CLI
tests/              # 测试用例
docs/               # 部署文档与架构说明
```

## 测试

```bash
npm test
```

## 免责声明

本项目仅供学习和技术研究之用，**严禁用于任何商业用途或违反第三方平台服务条款的行为**。

使用本软件即表示您理解并同意：

1. 本项目涉及对第三方平台（BOSS 直聘）的浏览器自动化操作，使用者需自行确保操作符合该平台的用户协议及相关法律法规。
2. 开发者**不对因使用本软件导致的任何账号封禁、数据丢失、法律纠纷或其他损失承担任何责任**。
3. 使用者应在合法合规的前提下使用本工具，并对自身行为承担全部责任。
4. 本项目不存储、不传输任何用户的平台登录凭证，所有自动化操作基于用户已登录的本地浏览器会话。
5. 本软件按"原样"提供，不附带任何明示或暗示的担保，包括但不限于适销性、特定用途适用性的担保。

**如果您不同意以上条款，请勿使用本软件。**

## License

ISC
