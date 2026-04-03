#!/usr/bin/env bash
#
# search-boss 企业版一键交付脚本
#
# 用法:
#   ./deliver.sh --customer "某某公司" [选项]
#
# 完整流程: 跑测试 → 构建镜像 → 生成授权 → 验签自检 → 原子打包 → 生成校验和
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

cleanup() {
  if [ -n "${STAGING_TAR:-}" ] && [ -f "$STAGING_TAR" ]; then
    rm -f "$STAGING_TAR"
  fi
}
trap cleanup EXIT

# ---- 参数解析 ----
CUSTOMER=""
VERSION="1.0.0"
FINGERPRINT="*"
EXPIRES=""
MAX_HR="3"
PRIVATE_KEY_FILE=""
SKIP_TESTS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --customer)       CUSTOMER="$2"; shift 2 ;;
    --version)        VERSION="$2"; shift 2 ;;
    --fingerprint)    FINGERPRINT="$2"; shift 2 ;;
    --expires)        EXPIRES="$2"; shift 2 ;;
    --max-hr)         MAX_HR="$2"; shift 2 ;;
    --private-key-file) PRIVATE_KEY_FILE="$2"; shift 2 ;;
    --skip-tests)     SKIP_TESTS=true; shift ;;
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
      echo "  --skip-tests               跳过测试闸门 (不推荐)"
      echo ""
      echo "示例:"
      echo "  # 试用交付 (90天, 3个HR, 不绑机器)"
      echo "  ./deliver.sh --customer \"某某公司\""
      echo ""
      echo "  # 正式交付 (1年, 10个HR, 绑定指纹)"
      echo "  ./deliver.sh --customer \"某某公司\" \\"
      echo "    --fingerprint \"abc123...\" \\"
      echo "    --expires 2027-04-03 \\"
      echo "    --max-hr 10"
      echo ""
      exit 0
      ;;
    *) log_error "未知参数: $1"; exit 1 ;;
  esac
done

# ---- 校验必填参数 ----
if [ -z "$CUSTOMER" ]; then
  log_error "--customer 参数必填"
  echo "  用法: ./deliver.sh --customer \"客户名\" [选项]"
  echo "  帮助: ./deliver.sh --help"
  exit 1
fi

# ---- 解析私钥路径 ----
if [ -z "$PRIVATE_KEY_FILE" ]; then
  PRIVATE_KEY_FILE="${LICENSE_PRIVATE_KEY_FILE:-}"
fi
if [ -z "$PRIVATE_KEY_FILE" ] && [ -z "${LICENSE_PRIVATE_KEY:-}" ]; then
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

# ---- 校验 Docker ----
if ! docker info &>/dev/null 2>&1; then
  log_error "Docker daemon 未启动"
  exit 1
fi

# ---- 默认到期时间: 90天后 ----
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
FINAL_TAR="dist/${PACK_NAME}.tar.gz"
STAGING_TAR="dist/.${PACK_NAME}.tar.gz.staging"

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

# ==== Step 1: 测试闸门 ====
if [ "$SKIP_TESTS" = true ]; then
  log_warn "[1/6] 跳过测试 (--skip-tests)"
else
  log_info "[1/6] 运行测试..."
  if ! npm test 2>&1 | tail -5; then
    log_error "测试未通过，中止交付"
    log_error "修复测试后重试，或使用 --skip-tests 跳过 (不推荐)"
    exit 1
  fi
  log_info "  测试通过"
fi
echo ""

# ==== Step 2: 构建交付目录 (不生成 tar.gz) ====
log_info "[2/6] 构建交付包..."
bash pack.sh "$VERSION"
echo ""

# 删除 pack.sh 可能残留的旧 tar.gz (防护性清理)
rm -f "$FINAL_TAR"

# ==== Step 3: 生成授权文件 ====
log_info "[3/6] 生成授权文件..."

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

# ==== Step 4: 验签自检 ====
log_info "[4/6] 验签自检 (用内置公钥校验刚生成的授权)..."

VERIFY_RESULT=$(node -e "
  const { LicenseService, VENDOR_PUBLIC_KEY } = require('./src/services/license-service');
  const fs = require('fs');
  const licensePath = 'dist/${PACK_NAME}/license/license.key';
  const svc = new LicenseService({ licensePath, publicKey: VENDOR_PUBLIC_KEY });
  const result = svc.validate();
  if (!result.valid) {
    console.error(JSON.stringify(result));
    process.exit(1);
  }
  console.log(JSON.stringify(result));
" 2>&1) || {
  log_error "验签失败! 私钥与内置公钥不匹配"
  log_error "详情: ${VERIFY_RESULT}"
  echo ""
  echo "  可能原因:"
  echo "    1. --private-key-file 指向的私钥不是当前 VENDOR_PUBLIC_KEY 对应的私钥"
  echo "    2. 密钥对已轮换但 src/services/license-service.js 中的公钥未更新"
  echo ""
  echo "  解决: 确保 generate-license.js keygen 生成的公钥已写入 VENDOR_PUBLIC_KEY"
  rm -f "dist/${PACK_NAME}/license/license.key"
  exit 1
}

log_info "  验签通过: $(echo "$VERIFY_RESULT" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const r=JSON.parse(d);console.log('客户='+r.customer+' 到期='+r.expiresAt+' HR上限='+(r.maxHrAccounts||'不限'))")"
echo ""

# ==== Step 5: 原子打包 ====
log_info "[5/6] 打包..."
mkdir -p dist
cd dist
tar czf "../${STAGING_TAR}" "${PACK_NAME}/"
cd ..
mv "$STAGING_TAR" "$FINAL_TAR"
log_info "  交付包: ${FINAL_TAR}"
echo ""

# ==== Step 6: 生成校验和 + manifest ====
log_info "[6/6] 生成校验和..."

CHECKSUM_FILE="${FINAL_TAR}.sha256"
if command -v sha256sum &>/dev/null; then
  sha256sum "$FINAL_TAR" > "$CHECKSUM_FILE"
elif command -v shasum &>/dev/null; then
  shasum -a 256 "$FINAL_TAR" > "$CHECKSUM_FILE"
fi

MANIFEST_FILE="dist/${PACK_NAME}.manifest.txt"
cat > "$MANIFEST_FILE" <<EOF
search-boss enterprise delivery manifest
=========================================
version:     ${VERSION}
customer:    ${CUSTOMER}
fingerprint: ${FINGERPRINT}
expires:     ${EXPIRES}
max_hr:      ${MAX_HR}
built_at:    $(date -u +"%Y-%m-%dT%H:%M:%SZ")
sha256:      $(cat "$CHECKSUM_FILE" | awk '{print $1}')
EOF

log_info "  校验和: ${CHECKSUM_FILE}"
log_info "  清单:   ${MANIFEST_FILE}"

PACK_SIZE=$(du -sh "$FINAL_TAR" | cut -f1)

echo ""
log_info "========================================="
log_info " 交付包已就绪"
log_info "========================================="
echo ""
log_info "  文件:     ${FINAL_TAR} (${PACK_SIZE})"
log_info "  校验和:   ${CHECKSUM_FILE}"
log_info "  客户:     ${CUSTOMER}"
log_info "  授权:     ${FINGERPRINT} / 到期 ${EXPIRES} / HR上限 ${MAX_HR}"
log_info "  验签:     通过"
echo ""
log_info "将 ${FINAL_TAR} 发送给客户即可。"
log_info "客户可用以下命令验证完整性:"
echo "  sha256sum -c ${CHECKSUM_FILE}"
log_info "客户按包内 DEPLOY.md 操作部署。"
