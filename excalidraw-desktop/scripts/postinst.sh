#!/bin/bash
# postinst.sh - RPM 安装后创建桌面快捷方式
set -e

DESKTOP_SRC="/usr/share/applications/excalidraw-desktop.desktop"

if [ ! -f "$DESKTOP_SRC" ]; then
  exit 0
fi

# 遍历所有用户的家目录，在 Desktop/ 下创建快捷方式
for user_home in /home/*; do
  if [ -d "$user_home/Desktop" ]; then
    cp "$DESKTOP_SRC" "$user_home/Desktop/excalidraw-desktop.desktop"
    chmod +x "$user_home/Desktop/excalidraw-desktop.desktop"
    chown "$(basename $user_home):$(basename $user_home)" \
      "$user_home/Desktop/excalidraw-desktop.desktop" 2>/dev/null || true
  fi
done
