#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3000}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> 正在停止端口 $PORT 上的所有 node 进程..."

pids=$(lsof -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)
if [ -n "$pids" ]; then
  for pid in $pids; do
    cmd=$(ps -o command= -p "$pid" 2>/dev/null || true)
    echo "    kill $pid ($cmd)"
    kill "$pid" 2>/dev/null || true
  done
  sleep 1
  # 如果还没死，强制杀
  for pid in $pids; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "    force kill $pid"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
else
  echo "    端口 $PORT 上没有正在运行的进程"
fi

echo "==> 启动 search-boss (端口 $PORT)..."
cd "$PROJECT_DIR"
exec node src/server.js
