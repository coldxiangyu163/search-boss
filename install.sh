#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="search-boss"
VERSION="${APP_VERSION:-latest}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

check_docker() {
  if ! command -v docker &>/dev/null; then
    log_error "Docker 未安装，请先安装 Docker"
    echo "  Linux:   https://docs.docker.com/engine/install/"
    echo "  Windows: https://docs.docker.com/desktop/install/windows-install/"
    exit 1
  fi

  if ! command -v docker compose &>/dev/null && ! docker compose version &>/dev/null 2>&1; then
    log_error "Docker Compose 未安装或版本过低，请安装 Docker Compose V2"
    exit 1
  fi

  if ! docker info &>/dev/null 2>&1; then
    log_error "Docker daemon 未启动，请先启动 Docker"
    exit 1
  fi

  log_info "Docker 环境检查通过"
}

load_images() {
  if [ -d "images" ]; then
    log_info "正在导入离线镜像..."
    for tarfile in images/*.tar; do
      if [ -f "$tarfile" ]; then
        log_info "  导入 $(basename "$tarfile")"
        docker load -i "$tarfile"
      fi
    done
    log_info "离线镜像导入完成"
  else
    log_warn "未找到 images/ 目录，将在线拉取镜像"
  fi
}

init_env() {
  if [ ! -f .env ]; then
    if [ -f .env.template ]; then
      cp .env.template .env
      log_warn ".env 文件已从模板创建，请编辑 .env 填写实际配置后重新运行"
      echo ""
      echo "  必填项："
      echo "    DB_PASSWORD       - 数据库密码"
      echo "    AGENT_TOKEN       - 内部认证令牌"
      echo "    SESSION_SECRET    - Session 密钥"
      echo "    LLM_API_KEY       - LLM 接口密钥"
      echo ""
      echo "  编辑完成后执行: ./install.sh start"
      exit 0
    else
      log_error "未找到 .env 或 .env.template 配置文件"
      exit 1
    fi
  fi

  # 校验必填项
  local missing=()
  source .env 2>/dev/null || true
  [ -z "${DB_PASSWORD:-}" ] || [[ "${DB_PASSWORD}" == *"请替换"* ]] && missing+=("DB_PASSWORD")
  [ -z "${AGENT_TOKEN:-}" ] || [[ "${AGENT_TOKEN}" == *"请替换"* ]] && missing+=("AGENT_TOKEN")
  [ -z "${SESSION_SECRET:-}" ] || [[ "${SESSION_SECRET}" == *"请替换"* ]] && missing+=("SESSION_SECRET")

  if [ ${#missing[@]} -gt 0 ]; then
    log_error "以下必填配置项尚未设置: ${missing[*]}"
    echo "  请编辑 .env 文件填写实际值"
    exit 1
  fi

  log_info "配置文件检查通过"
}

start() {
  init_env
  mkdir -p resumes license

  log_info "正在启动服务..."
  docker compose up -d

  log_info "等待服务就绪..."
  local retries=30
  while [ $retries -gt 0 ]; do
    if curl -sf http://127.0.0.1:${PORT:-3000}/health >/dev/null 2>&1; then
      log_info "服务已就绪"
      break
    fi
    retries=$((retries - 1))
    sleep 2
  done

  if [ $retries -eq 0 ]; then
    log_warn "服务启动超时，请检查日志: docker compose logs search-boss"
  fi

  echo ""
  log_info "=============================="
  log_info " $APP_NAME 已启动"
  log_info " 访问地址: http://localhost:${PORT:-3000}"
  log_info "=============================="
}

stop() {
  log_info "正在停止服务..."
  docker compose down
  log_info "服务已停止"
}

restart() {
  stop
  start
}

db_setup() {
  init_env
  log_info "正在初始化数据库..."
  docker compose exec search-boss node scripts/setup-db.js
  log_info "数据库初始化完成"
}

status() {
  if [ -f .env ]; then
    source .env 2>/dev/null || true
  fi
  echo ""
  log_info "服务状态:"
  docker compose ps
  echo ""

  if curl -sf http://127.0.0.1:${PORT:-3000}/health >/dev/null 2>&1; then
    log_info "API 健康检查: 正常"
  else
    log_warn "API 健康检查: 不可用"
  fi

  local cdp_endpoint="${BOSS_CDP_ENDPOINT:-http://127.0.0.1:9222}"
  local cdp_host
  cdp_host=$(echo "$cdp_endpoint" | sed 's|http://||' | sed 's|host.docker.internal|127.0.0.1|')
  if curl -sf "http://${cdp_host}/json/version" >/dev/null 2>&1; then
    log_info "Chrome CDP: 在线"
  else
    log_warn "Chrome CDP: 离线 (请确保 Chrome 已带 --remote-debugging-port=9222 启动)"
  fi
}

logs() {
  docker compose logs -f --tail=100 "${@:-}"
}

backup() {
  init_env
  local backup_dir="backups/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$backup_dir"

  log_info "正在备份数据..."

  # 备份数据库
  log_info "  备份数据库..."
  docker compose exec -T postgres pg_dump -U "${DB_USER:-search_boss}" "${DB_NAME:-search_boss_ops}" \
    > "$backup_dir/database.sql"

  # 备份简历文件
  if [ -d resumes ] && [ "$(ls -A resumes 2>/dev/null)" ]; then
    log_info "  备份简历文件..."
    tar czf "$backup_dir/resumes.tar.gz" resumes/
  fi

  # 备份配置
  cp .env "$backup_dir/env.backup"

  log_info "备份完成: $backup_dir"
  ls -lh "$backup_dir/"
}

generate_random() {
  if command -v openssl &>/dev/null; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

setup() {
  check_docker

  if [ -f .env ] && ! grep -q '请替换' .env 2>/dev/null; then
    log_warn ".env 已存在且已配置，跳过配置生成"
  else
    log_info "正在生成配置文件..."

    local db_password
    local agent_token
    local session_secret
    db_password=$(generate_random)
    agent_token=$(generate_random)
    session_secret=$(generate_random)

    local llm_api_base=""
    local llm_api_key=""
    local llm_model="gpt-5.4"

    echo ""
    echo "========================================"
    echo " LLM 配置 (用于 AI 候选人评估)"
    echo "========================================"
    echo ""
    echo "如果暂时没有 LLM 端点，可直接回车跳过，后续在 .env 中补填。"
    echo ""

    read -rp "LLM 接口地址 (如 https://your-llm/v1): " llm_api_base
    if [ -n "$llm_api_base" ]; then
      read -rp "LLM 接口密钥: " llm_api_key
      read -rp "LLM 模型名称 [${llm_model}]: " input_model
      [ -n "$input_model" ] && llm_model="$input_model"
    fi

    cat > .env <<EOF
APP_VERSION=${VERSION}
PORT=3000
DB_USER=search_boss
DB_PASSWORD=${db_password}
DB_NAME=search_boss_ops
DB_PORT=5432
AGENT_TOKEN=${agent_token}
SESSION_SECRET=${session_secret}
BOSS_CDP_ENDPOINT=http://host.docker.internal:9222
BOSS_CLI_ENABLED=true
SOURCE_LOOP_ENABLED=true
LLM_API_BASE=${llm_api_base}
LLM_API_KEY=${llm_api_key}
LLM_MODEL=${llm_model}
EOF

    log_info "配置文件已生成: .env"
    log_info "  数据库密码、Token、Session 密钥已自动生成"
  fi

  # 导入镜像
  load_images

  # 启动
  start

  # 初始化数据库
  log_info "正在初始化数据库..."
  docker compose exec search-boss node scripts/setup-db.js
  log_info "数据库初始化完成"

  echo ""
  log_info "========================================="
  log_info " 安装完成!"
  log_info "========================================="
  echo ""
  log_info "请在浏览器中打开: http://localhost:${PORT:-3000}"
  log_info "按照页面引导完成管理员账号创建和 Chrome 配置。"
  echo ""
}

usage() {
  echo ""
  echo "search-boss 企业版安装管理工具"
  echo ""
  echo "用法: ./install.sh <命令>"
  echo ""
  echo "命令:"
  echo "  setup          首次安装引导 (生成配置 → 启动 → 建库，一步完成)"
  echo "  start          启动所有服务"
  echo "  stop           停止所有服务"
  echo "  restart        重启所有服务"
  echo "  status         查看服务状态"
  echo "  logs [服务名]  查看日志 (可选: search-boss, postgres)"
  echo "  db-setup       初始化数据库表结构"
  echo "  load-images    导入离线 Docker 镜像"
  echo "  backup         备份数据库和简历文件"
  echo ""
}

case "${1:-}" in
  setup)          setup ;;
  start)          check_docker; start ;;
  stop)           stop ;;
  restart)        restart ;;
  status)         status ;;
  logs)           shift; logs "$@" ;;
  db-setup)       db_setup ;;
  load-images)    check_docker; load_images ;;
  backup)         backup ;;
  *)              usage ;;
esac
