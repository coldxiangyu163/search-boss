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

detect_arch() {
  local arch
  arch=$(uname -m)
  case "$arch" in
    x86_64|amd64)  echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    *)             echo "amd64" ;;
  esac
}

load_images() {
  if [ ! -d "images" ]; then
    log_warn "未找到 images/ 目录，将在线拉取镜像"
    return
  fi

  local arch
  arch=$(detect_arch)
  log_info "检测到系统架构: ${arch}"
  log_info "正在导入离线镜像..."

  # 优先加载当前架构的镜像，找不到则加载通用镜像
  for tarfile in images/*.tar; do
    [ -f "$tarfile" ] || continue
    local basename
    basename=$(basename "$tarfile")

    # 跳过其他架构的镜像
    case "$basename" in
      *-amd64.tar) [ "$arch" != "amd64" ] && continue ;;
      *-arm64.tar) [ "$arch" != "arm64" ] && continue ;;
    esac

    log_info "  导入 ${basename}"
    docker load -i "$tarfile"
  done

  # 确保正确的 tag 存在 (search-boss:1.0.0-arm64 -> search-boss:1.0.0)
  local version_tag
  version_tag=$(sed -n 's/.*APP_VERSION:-\([^}]*\)}.*/\1/p' docker-compose.yml 2>/dev/null | head -1)
  version_tag="${version_tag:-latest}"
  if docker image inspect "search-boss:${version_tag}-${arch}" &>/dev/null 2>&1; then
    docker tag "search-boss:${version_tag}-${arch}" "search-boss:${version_tag}"
    log_info "  已标记 search-boss:${version_tag}-${arch} → search-boss:${version_tag}"
  fi

  log_info "离线镜像导入完成"
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

  log_info "等待容器启动..."
  local retries=30
  while [ $retries -gt 0 ]; do
    if curl -sf http://127.0.0.1:${PORT:-3000}/health >/dev/null 2>&1; then
      log_info "容器已启动"
      break
    fi
    retries=$((retries - 1))
    sleep 2
  done

  if [ $retries -eq 0 ]; then
    log_warn "容器启动超时，请检查日志: docker compose logs search-boss"
  fi

  echo ""
  log_info "=============================="
  log_info " $APP_NAME 容器已启动"
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

  if [ -f .env ]; then
    log_info ".env 已存在，检查并补充缺失的随机值..."

    ensure_env_value() {
      local key="$1" default_val="$2"
      if ! grep -q "^${key}=" .env 2>/dev/null; then
        echo "${key}=${default_val}" >> .env
        log_info "  补充 ${key}"
      elif grep -q "请替换" <<< "$(grep "^${key}=" .env)"; then
        sed -i.bak "s|^${key}=.*|${key}=${default_val}|" .env && rm -f .env.bak
        log_info "  替换 ${key} 占位符"
      fi
    }

    ensure_env_value "DB_PASSWORD" "$(generate_random)"
    ensure_env_value "AGENT_TOKEN" "$(generate_random)"
    ensure_env_value "SESSION_SECRET" "$(generate_random)"
    ensure_env_value "DB_USER" "search_boss"
    ensure_env_value "DB_NAME" "search_boss_ops"
    ensure_env_value "PORT" "3000"
    ensure_env_value "BOSS_CLI_ENABLED" "true"
    ensure_env_value "SOURCE_LOOP_ENABLED" "true"
  else
    log_info "正在生成配置文件..."

    local db_password
    local agent_token
    local session_secret
    db_password=$(generate_random)
    agent_token=$(generate_random)
    session_secret=$(generate_random)

    cat > .env <<EOF
PORT=3000
DB_USER=search_boss
DB_PASSWORD=${db_password}
DB_NAME=search_boss_ops
DB_PORT=5432
AGENT_TOKEN=${agent_token}
SESSION_SECRET=${session_secret}
BOSS_CLI_ENABLED=true
SOURCE_LOOP_ENABLED=true
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

  local url="http://localhost:${PORT:-3000}"

  echo ""
  log_info "========================================="
  log_info " 容器已启动，请在浏览器中完成初始化配置"
  log_info "========================================="
  echo ""

  # 尝试自动打开浏览器
  if command -v xdg-open &>/dev/null; then
    xdg-open "$url" 2>/dev/null &
  elif command -v open &>/dev/null; then
    open "$url" 2>/dev/null &
  elif command -v start &>/dev/null; then
    start "$url" 2>/dev/null &
  else
    log_info "请在浏览器中打开: $url"
  fi

  log_info "还需完成: 创建管理员 → 配置 LLM → 登录 BOSS"
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
