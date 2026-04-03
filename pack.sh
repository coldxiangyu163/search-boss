#!/usr/bin/env bash
#
# search-boss 企业版交付包构建脚本
# 用法: ./pack.sh [版本号]
# 示例: ./pack.sh 1.0.0
#
# 构建双架构镜像 (amd64 + arm64) + 导出离线镜像 + 组装交付目录。
# 注意: 本脚本只准备 dist/<name>/ 目录，不生成最终 tar.gz。
# 最终打包由 deliver.sh 在注入 license 并验证后完成。
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

# 检测本机架构
NATIVE_ARCH=$(uname -m)
case "$NATIVE_ARCH" in
  x86_64|amd64)  BUILD_ARCH="amd64" ;;
  aarch64|arm64) BUILD_ARCH="arm64" ;;
  *)             BUILD_ARCH="amd64" ;;
esac

log_info "========================================="
log_info " 构建 search-boss 企业版交付包"
log_info " 版本: ${VERSION}"
log_info " 架构: ${BUILD_ARCH}"
log_info "========================================="
echo ""
log_warn "bytenode (.jsc) 字节码与 CPU 架构绑定，只能构建当前架构的镜像"
log_warn "如需其他架构，请在对应架构的机器上重新构建"
echo ""

# --- Step 1: 构建当前架构 Docker 镜像 ---
log_info "[1/4] 构建 Docker 镜像 (含 bytenode 源码编译)..."
docker build --no-cache --platform "linux/${BUILD_ARCH}" \
  -t "search-boss:${VERSION}" \
  -f Dockerfile .
docker tag "search-boss:${VERSION}" "search-boss:latest"
log_info "  search-boss:${VERSION} (${BUILD_ARCH}) 构建完成"

# --- Step 2: 准备交付目录 ---
log_info "[2/4] 准备交付目录..."
rm -rf "${PACK_DIR}"
mkdir -p "${PACK_DIR}/images"
mkdir -p "${PACK_DIR}/license"
mkdir -p "${PACK_DIR}/resumes"
mkdir -p "${PACK_DIR}/backups"

# --- Step 3: 导出离线镜像 ---
log_info "[3/4] 导出离线镜像..."

docker save "search-boss:${VERSION}" -o "${PACK_DIR}/images/search-boss-${VERSION}.tar"
log_info "  导出 search-boss:${VERSION} ($(du -sh "${PACK_DIR}/images/search-boss-${VERSION}.tar" | cut -f1))"

docker pull --platform "linux/${BUILD_ARCH}" postgres:16-alpine 2>/dev/null || true
docker save postgres:16-alpine -o "${PACK_DIR}/images/postgres-16-alpine.tar"
log_info "  导出 postgres:16-alpine ($(du -sh "${PACK_DIR}/images/postgres-16-alpine.tar" | cut -f1))"

# --- Step 4: 复制交付文件 (不含源码) ---
log_info "[4/4] 复制交付文件..."
cp docker-compose.yml "${PACK_DIR}/"
cp install.sh "${PACK_DIR}/"
chmod +x "${PACK_DIR}/install.sh"
cp .env.template "${PACK_DIR}/"
cp DEPLOY.md "${PACK_DIR}/"

# 将版本号写入 docker-compose.yml 的默认值
sed -i.bak "s|APP_VERSION:-latest|APP_VERSION:-${VERSION}|g" "${PACK_DIR}/docker-compose.yml" 2>/dev/null \
  || sed -i '' "s|APP_VERSION:-latest|APP_VERSION:-${VERSION}|g" "${PACK_DIR}/docker-compose.yml"
rm -f "${PACK_DIR}/docker-compose.yml.bak"

echo ""
log_info "交付目录已就绪: ${PACK_DIR}/"
log_info "架构: ${BUILD_ARCH}"
log_info "下一步: 通过 deliver.sh 注入授权并生成最终交付包"
