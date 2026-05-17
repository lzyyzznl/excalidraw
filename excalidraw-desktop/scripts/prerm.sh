#!/bin/bash
# prerm.sh - RPM 卸载前删除桌面快捷方式
set -e

for user_home in /home/*; do
  desktop_file="$user_home/Desktop/excalidraw-desktop.desktop"
  if [ -f "$desktop_file" ]; then
    rm -f "$desktop_file"
  fi
done
