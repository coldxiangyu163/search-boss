#!/usr/bin/env bash
#
# search-boss 企业版交付包构建脚本
# 用法: ./pack.sh [版本号]
# 示例: ./pack.sh 1.0.0
#
# 此脚本由供应商（你）在开发机上执行，产出物交付给客户。
# 客户拿到的是 Docker 镜像 + 配置模板 + 安装脚本，不含源码。
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

VERSION="${1:-1.0.0}"
PACK_NAME="search-boss-enterprise-v${VERSION}"
PACK_DIR="dist/${PACK_NAME}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# --- 前置检查 ---
if ! docker info &>/dev/null 2>&1; then
  log_error "Docker daemon 未启动"
  exit 1
fi

log_info "========================================="
log_info " 构建 search-boss 企业版交付包"
log_info " 版本: ${VERSION}"
log_info "========================================="
echo ""

# --- Step 1: 构建 Docker 镜像 ---
log_info "[1/5] 构建 Docker 镜像 (含 bytenode 源码编译)..."
docker build --no-cache -t "search-boss:${VERSION}" -f Dockerfile .
docker tag "search-boss:${VERSION}" "search-boss:latest"
log_info "  镜像构建完成: search-boss:${VERSION}"

# --- Step 2: 准备交付目录 ---
log_info "[2/5] 准备交付目录..."
rm -rf "${PACK_DIR}"
mkdir -p "${PACK_DIR}/images"
mkdir -p "${PACK_DIR}/license"
mkdir -p "${PACK_DIR}/resumes"
mkdir -p "${PACK_DIR}/backups"

# --- Step 3: 导出离线镜像 ---
log_info "[3/5] 导出离线镜像..."
docker save "search-boss:${VERSION}" -o "${PACK_DIR}/images/search-boss-${VERSION}.tar"
log_info "  导出 search-boss:${VERSION} ($(du -sh "${PACK_DIR}/images/search-boss-${VERSION}.tar" | cut -f1))"

docker pull postgres:16-alpine 2>/dev/null || true
docker save postgres:16-alpine -o "${PACK_DIR}/images/postgres-16-alpine.tar"
log_info "  导出 postgres:16-alpine ($(du -sh "${PACK_DIR}/images/postgres-16-alpine.tar" | cut -f1))"

# --- Step 4: 复制交付文件 (不含源码) ---
log_info "[4/5] 复制交付文件..."
cp docker-compose.yml "${PACK_DIR}/"
cp install.sh "${PACK_DIR}/"
chmod +x "${PACK_DIR}/install.sh"
cp .env.template "${PACK_DIR}/"
cp DEPLOY.md "${PACK_DIR}/"

# 将版本号写入 docker-compose.yml 的默认值
sed -i.bak "s|APP_VERSION:-latest|APP_VERSION:-${VERSION}|g" "${PACK_DIR}/docker-compose.yml" 2>/dev/null \
  || sed -i '' "s|APP_VERSION:-latest|APP_VERSION:-${VERSION}|g" "${PACK_DIR}/docker-compose.yml"
rm -f "${PACK_DIR}/docker-compose.yml.bak"

# --- Step 5: 打包 ---
log_info "[5/5] 打包..."
cd dist
tar czf "${PACK_NAME}.tar.gz" "${PACK_NAME}/"
cd ..

PACK_SIZE=$(du -sh "dist/${PACK_NAME}.tar.gz" | cut -f1)

echo ""
log_info "========================================="
log_info " 构建完成!"
log_info " 交付包: dist/${PACK_NAME}.tar.gz (${PACK_SIZE})"
log_info "========================================="
echo ""
log_info "交付包内容:"
ls -lh "dist/${PACK_NAME}.tar.gz"
echo ""
tar tzf "dist/${PACK_NAME}.tar.gz" | head -20
echo ""

log_info "下一步:"
echo "  1. 为客户生成授权文件:"
echo "     node scripts/generate-license.js generate \\"
echo "       --customer \"客户名称\" \\"
echo "       --fingerprint \"客户机器指纹\" \\"
echo "       --expires 2027-04-03 \\"
echo "       --max-hr 10 \\"
echo "       --private-key-file /path/to/vendor-license-private-key.pem \\"
echo "       --output dist/${PACK_NAME}/license/license.key"
echo ""
echo "  2. 将 dist/${PACK_NAME}.tar.gz 交付给客户"
echo "  3. 客户按 DEPLOY.md 部署"
