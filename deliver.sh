#!/usr/bin/env bash
#
# search-boss 企业版一键交付脚本
#
# 用法:
#   ./deliver.sh --customer "某某公司" [选项]
#
# 将 构建镜像 → 打包 → 生成授权 → 产出最终交付包 合为一步。
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ---- 参数解析 ----
CUSTOMER=""
VERSION="1.0.0"
FINGERPRINT="*"
EXPIRES=""
MAX_HR="3"
PRIVATE_KEY_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --customer)       CUSTOMER="$2"; shift 2 ;;
    --version)        VERSION="$2"; shift 2 ;;
    --fingerprint)    FINGERPRINT="$2"; shift 2 ;;
    --expires)        EXPIRES="$2"; shift 2 ;;
    --max-hr)         MAX_HR="$2"; shift 2 ;;
    --private-key-file) PRIVATE_KEY_FILE="$2"; shift 2 ;;
    --help|-h)
      echo ""
      echo "search-boss 企业版一键交付"
      echo ""
      echo "用法: ./deliver.sh --customer <客户名> [选项]"
      echo ""
      echo "选项:"
      echo "  --customer <名称>          客户名称 (必填)"
      echo "  --version <版本号>         版本号 (默认: 1.0.0)"
      echo "  --fingerprint <指纹>       机器指纹, * 表示不绑定 (默认: *)"
      echo "  --expires <YYYY-MM-DD>     到期日期 (默认: 90天后)"
      echo "  --max-hr <数量>            HR 账号上限 (默认: 3)"
      echo "  --private-key-file <路径>  私钥文件 (也可用 LICENSE_PRIVATE_KEY_FILE 环境变量)"
      echo ""
      echo "示例:"
      echo "  # 试用交付 (90天, 3个HR, 不绑机器)"
      echo "  ./deliver.sh --customer \"某某公司\" --private-key-file .keys/license-private.pem"
      echo ""
      echo "  # 正式交付 (1年, 10个HR, 绑定指纹)"
      echo "  ./deliver.sh --customer \"某某公司\" \\"
      echo "    --fingerprint \"abc123...\" \\"
      echo "    --expires 2027-04-03 \\"
      echo "    --max-hr 10 \\"
      echo "    --private-key-file .keys/license-private.pem"
      echo ""
      exit 0
      ;;
    *) log_error "未知参数: $1"; exit 1 ;;
  esac
done

# ---- 校验 ----
if [ -z "$CUSTOMER" ]; then
  log_error "--customer 参数必填"
  echo "  用法: ./deliver.sh --customer \"客户名\" [选项]"
  echo "  帮助: ./deliver.sh --help"
  exit 1
fi

if [ -z "$PRIVATE_KEY_FILE" ]; then
  PRIVATE_KEY_FILE="${LICENSE_PRIVATE_KEY_FILE:-}"
fi
if [ -z "$PRIVATE_KEY_FILE" ] && [ -z "${LICENSE_PRIVATE_KEY:-}" ]; then
  # 尝试默认路径
  if [ -f ".keys/license-private.pem" ]; then
    PRIVATE_KEY_FILE=".keys/license-private.pem"
    log_info "使用默认私钥: .keys/license-private.pem"
  else
    log_error "未找到私钥文件"
    echo "  请先生成密钥对: node scripts/generate-license.js keygen"
    echo "  或通过 --private-key-file 指定私钥路径"
    exit 1
  fi
fi

if ! docker info &>/dev/null 2>&1; then
  log_error "Docker daemon 未启动"
  exit 1
fi

# 默认到期时间: 90天后
if [ -z "$EXPIRES" ]; then
  if command -v gdate &>/dev/null; then
    EXPIRES=$(gdate -d "+90 days" +%Y-%m-%d)
  elif date -d "+90 days" +%Y-%m-%d &>/dev/null 2>&1; then
    EXPIRES=$(date -d "+90 days" +%Y-%m-%d)
  else
    EXPIRES=$(date -v+90d +%Y-%m-%d)
  fi
fi

PACK_NAME="search-boss-enterprise-v${VERSION}"

echo ""
log_info "========================================="
log_info " 一键交付: ${CUSTOMER}"
log_info "========================================="
echo ""
log_info "  版本:     ${VERSION}"
log_info "  客户:     ${CUSTOMER}"
log_info "  指纹:     ${FINGERPRINT}"
log_info "  到期:     ${EXPIRES}"
log_info "  HR上限:   ${MAX_HR}"
echo ""

# ---- Step 1: 构建交付包 ----
log_info "[1/3] 构建交付包..."
bash pack.sh "$VERSION"
echo ""

# ---- Step 2: 生成授权文件 ----
log_info "[2/3] 生成授权文件..."

LICENSE_ARGS=(
  generate
  --customer "$CUSTOMER"
  --fingerprint "$FINGERPRINT"
  --expires "$EXPIRES"
  --max-hr "$MAX_HR"
  --output "dist/${PACK_NAME}/license/license.key"
)

if [ -n "$PRIVATE_KEY_FILE" ]; then
  LICENSE_ARGS+=(--private-key-file "$PRIVATE_KEY_FILE")
fi

node scripts/generate-license.js "${LICENSE_ARGS[@]}"
echo ""

# ---- Step 3: 重新打包 (license 已注入) ----
log_info "[3/3] 重新打包 (含授权文件)..."
cd dist
rm -f "${PACK_NAME}.tar.gz"
tar czf "${PACK_NAME}.tar.gz" "${PACK_NAME}/"
cd ..

PACK_SIZE=$(du -sh "dist/${PACK_NAME}.tar.gz" | cut -f1)

echo ""
log_info "========================================="
log_info " 交付包已就绪"
log_info "========================================="
echo ""
log_info "  文件:   dist/${PACK_NAME}.tar.gz"
log_info "  大小:   ${PACK_SIZE}"
log_info "  客户:   ${CUSTOMER}"
log_info "  授权:   ${FINGERPRINT} / 到期 ${EXPIRES} / HR上限 ${MAX_HR}"
echo ""
log_info "将 dist/${PACK_NAME}.tar.gz 发送给客户即可。"
log_info "客户按包内 DEPLOY.md 操作部署。"
