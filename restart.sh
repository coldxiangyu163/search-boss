#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3000}"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$PROJECT_DIR/tmp/server.log"

mkdir -p "$PROJECT_DIR/tmp"

echo "==> 正在停止 Chrome/Chromium 浏览器进程..."
chrome_pids=$(pgrep -f 'chrome.*--remote-debugging-port' 2>/dev/null || true)
if [ -n "$chrome_pids" ]; then
  for pid in $chrome_pids; do
    cmd=$(ps -o command= -p "$pid" 2>/dev/null | head -c 120 || true)
    echo "    kill chrome $pid ($cmd)"
    kill "$pid" 2>/dev/null || true
  done
  sleep 2
  for pid in $chrome_pids; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "    force kill chrome $pid"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  echo "    Chrome 进程已清理"
else
  echo "    没有运行中的 Chrome 调试进程"
fi

echo "==> 正在停止端口 $PORT 上的所有 node 进程..."
pids=$(lsof -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)
if [ -n "$pids" ]; then
  for pid in $pids; do
    cmd=$(ps -o command= -p "$pid" 2>/dev/null || true)
    echo "    kill $pid ($cmd)"
    kill "$pid" 2>/dev/null || true
  done
  sleep 1
  for pid in $pids; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "    force kill $pid"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
else
  echo "    端口 $PORT 上没有正在运行的进程"
fi

echo "==> 后台启动 search-boss (端口 $PORT)..."
cd "$PROJECT_DIR"
nohup node src/server.js > "$LOG_FILE" 2>&1 &
echo "    PID: $!, 日志: $LOG_FILE"
