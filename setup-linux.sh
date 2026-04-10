#!/usr/bin/env bash
#
# search-boss Linux 环境准备脚本 (非Docker模式)
#
# 用法: bash setup-linux.sh [setup]
#   setup   - 检测安装依赖 → 建库 → 初始化表结构 → 准备运行目录
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="search-boss"
NODE_MAJOR=20
PG_VERSION=16
DEFAULT_DB_USER="search_boss"
DEFAULT_DB_NAME="search_boss_ops"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "${CYAN}[STEP]${NC}  $*"; }

generate_random() {
  if command -v openssl &>/dev/null; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

detect_distro() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO_ID="${ID:-unknown}"
    DISTRO_ID_LIKE="${ID_LIKE:-}"
    DISTRO_VERSION="${VERSION_ID:-}"
  else
    DISTRO_ID="unknown"
    DISTRO_ID_LIKE=""
    DISTRO_VERSION=""
  fi

  if [[ "$DISTRO_ID" == "ubuntu" || "$DISTRO_ID" == "debian" || "$DISTRO_ID_LIKE" == *"debian"* || "$DISTRO_ID_LIKE" == *"ubuntu"* ]]; then
    PKG_MANAGER="apt"
  elif [[ "$DISTRO_ID" == "centos" || "$DISTRO_ID" == "rhel" || "$DISTRO_ID" == "rocky" || "$DISTRO_ID" == "almalinux" || "$DISTRO_ID" == "fedora" || "$DISTRO_ID_LIKE" == *"rhel"* || "$DISTRO_ID_LIKE" == *"centos"* || "$DISTRO_ID_LIKE" == *"fedora"* ]]; then
    PKG_MANAGER="yum"
    if command -v dnf &>/dev/null; then
      PKG_MANAGER="dnf"
    fi
  else
    log_error "不支持的 Linux 发行版: $DISTRO_ID"
    log_error "支持: Ubuntu/Debian, CentOS/RHEL/Rocky/AlmaLinux/Fedora"
    exit 1
  fi

  log_info "检测到系统: $DISTRO_ID $DISTRO_VERSION (包管理器: $PKG_MANAGER)"
}

install_base_deps() {
  log_step "安装基础依赖..."

  if [[ "$PKG_MANAGER" == "apt" ]]; then
    sudo apt-get update
    sudo apt-get install -y curl wget git ca-certificates gnupg2 \
      fonts-liberation libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
      libpango-1.0-0 libcairo2 libasound2 libxshmfence1 libnss3 \
      xvfb lsb-release lsof
  else
    sudo "$PKG_MANAGER" install -y curl wget git ca-certificates \
      nss atk at-spi2-atk cups-libs libdrm \
      libxkbcommon libXcomposite libXdamage libXrandr mesa-libgbm \
      pango cairo alsa-lib libxshmfence \
      xorg-x11-server-Xvfb redhat-lsb-core lsof 2>/dev/null || true
  fi

  log_info "基础依赖安装完成"
}

install_node() {
  if command -v node &>/dev/null; then
    local current_version
    current_version=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$current_version" -ge "$NODE_MAJOR" ]; then
      log_info "Node.js $(node -v) 已安装，跳过"
      return 0
    fi
    log_warn "Node.js 版本过低 ($(node -v))，将安装 v${NODE_MAJOR}.x"
  fi

  log_step "安装 Node.js ${NODE_MAJOR}.x ..."

  if [[ "$PKG_MANAGER" == "apt" ]]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
    sudo "$PKG_MANAGER" install -y nodejs
  fi

  log_info "Node.js $(node -v) 安装完成"
}

install_pg() {
  if command -v psql &>/dev/null; then
    log_info "PostgreSQL (psql $(psql --version | awk '{print $3}')) 已安装"
    return 0
  fi

  log_step "安装 PostgreSQL ${PG_VERSION} ..."

  if [[ "$PKG_MANAGER" == "apt" ]]; then
    sudo apt-get install -y wget gnupg2 lsb-release
    echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
    wget -qO - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add - 2>/dev/null || \
      wget -qO- https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /usr/share/keyrings/postgresql-archive-keyring.gpg
    sudo apt-get update
    sudo apt-get install -y "postgresql-${PG_VERSION}" "postgresql-client-${PG_VERSION}"
  else
    sudo "$PKG_MANAGER" install -y "https://download.postgresql.org/pub/repos/yum/reporpms/EL-$(rpm -E %{rhel})-x86_64/pgdg-redhat-repo-latest.noarch.rpm" 2>/dev/null || true
    sudo "$PKG_MANAGER" install -y "postgresql${PG_VERSION}-server" "postgresql${PG_VERSION}"
    sudo "/usr/pgsql-${PG_VERSION}/bin/postgresql-${PG_VERSION}-setup" initdb 2>/dev/null || true
    if [ -d "/usr/pgsql-${PG_VERSION}/bin" ]; then
      export PATH="/usr/pgsql-${PG_VERSION}/bin:$PATH"
      echo "export PATH=/usr/pgsql-${PG_VERSION}/bin:\$PATH" | sudo tee /etc/profile.d/pgsql.sh >/dev/null
    fi
  fi

  log_info "PostgreSQL 安装完成"
}

resolve_pg_service() {
  local svc=""

  for candidate in "postgresql-${PG_VERSION}" "postgresql" "postgresql.service"; do
    if sudo systemctl list-unit-files "$candidate" &>/dev/null 2>&1 || sudo systemctl list-unit-files "${candidate}.service" &>/dev/null 2>&1; then
      svc="$candidate"
      break
    fi
  done

  if [ -z "$svc" ]; then
    svc=$(sudo systemctl list-unit-files 'postgresql*' --no-legend 2>/dev/null | head -1 | awk '{print $1}' || true)
  fi

  printf '%s' "$svc"
}

ensure_pg_running() {
  log_step "确保 PostgreSQL 服务运行..."

  local pg_service
  pg_service=$(resolve_pg_service)

  if [ -z "$pg_service" ]; then
    log_error "未找到 PostgreSQL systemd 服务，请手动检查安装结果"
    exit 1
  fi

  sudo systemctl enable "$pg_service" 2>/dev/null || true
  sudo systemctl start "$pg_service" 2>/dev/null || true
  sleep 2

  if sudo systemctl is-active "$pg_service" &>/dev/null; then
    log_info "PostgreSQL 服务运行中 ($pg_service)"
    return 0
  fi

  log_error "无法启动 PostgreSQL 服务，请手动检查"
  exit 1
}

validate_pg_identifier() {
  local identifier="$1"
  local label="$2"

  if [[ ! "$identifier" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    log_error "$label 仅支持字母、数字、下划线，且不能以数字开头: $identifier"
    exit 1
  fi
}

sql_escape_literal() {
  printf '%s' "$1" | sed "s/'/''/g"
}

setup_pg_database() {
  log_step "配置 PostgreSQL 数据库..."

  local db_user="${DB_USER:-$DEFAULT_DB_USER}"
  local db_name="${DB_NAME:-$DEFAULT_DB_NAME}"
  local db_password="${DB_PASSWORD:-}"
  local escaped_password

  validate_pg_identifier "$db_user" "数据库用户"
  validate_pg_identifier "$db_name" "数据库名"

  if [ -z "$db_password" ]; then
    db_password=$(generate_random)
    DB_PASSWORD="$db_password"
    log_info "已自动生成数据库密码"
  fi

  escaped_password=$(sql_escape_literal "$db_password")

  sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$db_user'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER \"$db_user\" WITH PASSWORD '$escaped_password';"

  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$db_name'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE \"$db_name\" OWNER \"$db_user\";"

  sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE \"$db_name\" TO \"$db_user\";" 2>/dev/null || true

  local pg_hba
  pg_hba=$(sudo -u postgres psql -t -c "SHOW hba_file;" 2>/dev/null | tr -d ' ')
  if [ -n "$pg_hba" ] && [ -f "$pg_hba" ]; then
    if ! sudo grep -q "host.*${db_name}.*${db_user}.*md5" "$pg_hba" && \
       ! sudo grep -q "host.*${db_name}.*${db_user}.*scram-sha-256" "$pg_hba"; then
      sudo sed -i "1i host    ${db_name}    ${db_user}    127.0.0.1/32    md5" "$pg_hba"
      sudo sed -i "2i host    ${db_name}    ${db_user}    ::1/128         md5" "$pg_hba"
      sudo -u postgres psql -c "SELECT pg_reload_conf();" &>/dev/null || true
      log_info "已更新 pg_hba.conf 允许密码登录"
    fi
  fi

  export DATABASE_URL="postgresql://${db_user}:${db_password}@127.0.0.1:5432/${db_name}"
  log_info "数据库 $db_name 配置完成"
  log_info "建议在 .env 中保持 DATABASE_URL 与上面数据库一致"
}

install_chrome() {
  if command -v google-chrome &>/dev/null || command -v google-chrome-stable &>/dev/null || command -v chromium-browser &>/dev/null || command -v chromium &>/dev/null; then
    local chrome_bin
    chrome_bin=$(command -v google-chrome-stable || command -v google-chrome || command -v chromium-browser || command -v chromium)
    log_info "Chrome/Chromium 已安装: $chrome_bin"
    return 0
  fi

  log_step "安装 Chromium ..."

  if [[ "$PKG_MANAGER" == "apt" ]]; then
    sudo apt-get install -y chromium-browser 2>/dev/null || sudo apt-get install -y chromium
  else
    sudo "$PKG_MANAGER" install -y chromium
  fi

  log_info "Chromium 安装完成"
}

install_npm_deps() {
  log_step "安装 npm 依赖..."
  cd "$SCRIPT_DIR"
  npm ci --omit=dev
  log_info "npm 依赖安装完成"
}

create_runtime_dirs() {
  log_step "准备运行目录..."
  mkdir -p \
    "$SCRIPT_DIR/tmp" \
    "$SCRIPT_DIR/resumes" \
    "$SCRIPT_DIR/.chrome-profile" \
    "$SCRIPT_DIR/.chrome-downloads"
  log_info "运行目录已准备完成"
}

notify_env_setup() {
  if [ -f "$SCRIPT_DIR/.env" ]; then
    log_info ".env 已存在，请确认其中 DATABASE_URL / AGENT_TOKEN 等配置正确"
    return 0
  fi

  log_warn "当前未检测到 .env，请在启动前手动创建"
  if [ -f "$SCRIPT_DIR/.env.example" ]; then
    log_info "可参考: $SCRIPT_DIR/.env.example"
  fi
}

init_database_schema() {
  log_step "初始化数据库表结构..."
  cd "$SCRIPT_DIR"
  node scripts/setup-db.js
  log_info "数据库表结构初始化完成"
}

do_setup() {
  echo ""
  log_info "========================================="
  log_info " $APP_NAME Linux 环境准备 (非Docker模式)"
  log_info "========================================="
  echo ""

  detect_distro
  install_base_deps
  install_node
  install_pg
  ensure_pg_running
  setup_pg_database
  install_chrome
  install_npm_deps
  create_runtime_dirs
  notify_env_setup
  init_database_schema

  echo ""
  log_info "========================================="
  log_info " 环境准备完成"
  log_info "========================================="
  echo ""
  log_info "后续建议:"
  log_info "  1. 手动检查并填写 .env"
  log_info "  2. 使用 bash restart.sh 启动服务"
  log_info "  3. 使用 tail -f tmp/server.log 查看日志"
  echo ""
}

usage() {
  echo ""
  echo "$APP_NAME Linux 环境准备工具"
  echo ""
  echo "用法: bash setup-linux.sh [setup]"
  echo ""
  echo "命令:"
  echo "  setup    安装依赖、配置本地 PostgreSQL、初始化表结构、准备运行目录"
  echo ""
}

case "${1:-setup}" in
  setup) do_setup ;;
  *)
    usage
    exit 1
    ;;
esac
