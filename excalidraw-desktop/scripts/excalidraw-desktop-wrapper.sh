#!/bin/bash
# Excalidraw Desktop 启动包装脚本
# RPM 安装/更新后启动时先杀死旧进程，再启动新版本

EXEC="/opt/Excalidraw Desktop/excalidraw-desktop"

# 杀死旧进程
PID=$(pgrep -x "excalidraw-desktop" 2>/dev/null || true)
if [ -n "$PID" ]; then
  echo "[excalidraw-desktop] 正在停止旧进程 (PID: $PID)..."
  kill "$PID" 2>/dev/null
  # 等待进程退出（最多5秒）
  for i in $(seq 1 5); do
    if ! kill -0 "$PID" 2>/dev/null; then
      break
    fi
    sleep 1
  done
  # 强制杀死
  if kill -0 "$PID" 2>/dev/null; then
    echo "[excalidraw-desktop] 强制停止旧进程..."
    kill -9 "$PID" 2>/dev/null
  fi
fi

# 启动新版本
exec "$EXEC" "$@"
