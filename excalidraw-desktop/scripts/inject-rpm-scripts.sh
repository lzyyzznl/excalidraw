#!/bin/bash
# inject-rpm-scripts.sh - 在 electron-builder 生成的 RPM 中注入 %pre/%postun 脚本
set -e

RPM_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RPM_FILE="$RPM_DIR/release/excalidraw-desktop-0.1.0.x86_64.rpm"

[ -f "$RPM_FILE" ] || { echo "RPM not found"; exit 1; }

WORK_DIR=$(mktemp -d)
PAYLOAD_DIR="$WORK_DIR/payload"
trap "rm -rf $WORK_DIR" EXIT
mkdir -p "$PAYLOAD_DIR"

# 提取原始 RPM 文件
cd "$PAYLOAD_DIR"
rpm2cpio "$RPM_FILE" | cpio -idm 2>/dev/null
cd "$WORK_DIR"

# 获取 rpm 元数据
eval "$(rpm -qp --qf '
NAME="%{NAME}"
VERSION="%{VERSION}"
RELEASE="%{RELEASE}"
ARCH="%{ARCH}"
SUMMARY="%{SUMMARY}"
LICENSE="%{LICENSE}"
VENDOR="%{VENDOR}"
GROUP="%{GROUP}"
URL="%{URL}"
' "$RPM_FILE" 2>/dev/null)"

# 修复 .desktop 文件的 StartupWMClass（全小写连缀，匹配 Electron 实际行为）
DESKTOP_FILE="$PAYLOAD_DIR/usr/share/applications/excalidraw-desktop.desktop"
if [ -f "$DESKTOP_FILE" ]; then
  sed -i 's/^StartupWMClass=.*/StartupWMClass=excalidraw-desktop/' "$DESKTOP_FILE"
  echo "[Fix] Set StartupWMClass=excalidraw-desktop in .desktop"
fi

# 生成文件列表（用引号包裹路径中的空格）
generate_file_list() {
  cd "$PAYLOAD_DIR"
  find . -not -name '.' | while IFS= read -r f; do
    # 去掉开头的 .
    rel="${f#.}"
    # 检查是否包含空格
    if echo "$rel" | grep -q ' '; then
      echo "\"$rel\""
    else
      echo "$rel"
    fi
  done | sort
}

generate_dir_list() {
  cd "$PAYLOAD_DIR"
  find . -type d -not -name '.' | while IFS= read -r d; do
    rel="${d#.}"
    if echo "$rel" | grep -q ' '; then
      echo "%dir \"$rel\""
    else
      echo "%dir $rel"
    fi
  done | sort
}

FILE_LIST=$(generate_file_list)

# 创建 spec
cat > "$WORK_DIR/excalidraw.spec" <<SPECEOF
%define _topdir $WORK_DIR
%define _rpmdir $WORK_DIR
%define _rpmfilename excalidraw-desktop-${VERSION}-${RELEASE}.${ARCH}.rpm
%define _builddir $WORK_DIR
%define _sourcedir $WORK_DIR
%define _specdir $WORK_DIR
%define _srcrpmdir $WORK_DIR
%define _buildrootdir $WORK_DIR/buildroot
%define _build_id_links none
%define _unpackaged_files_terminate_build 0
%define _binaries_in_noarch_packages_terminate_build 0
%define _missing_doc_files_terminate_build 0
%define _binary_filedigest_algorithm 1
%define _binary_payload w9.gzdio

Name: $NAME
Version: $VERSION
Release: $RELEASE
Summary: $SUMMARY
License: ${LICENSE:-MIT}
Group: ${GROUP:-Applications/Graphics}
Vendor: ${VENDOR:-Excalidraw Desktop}
URL: ${URL:-https://excalidraw.com}
BuildArch: $ARCH

%description
$SUMMARY

%install
rm -rf %{buildroot}
mkdir -p %{buildroot}
cp -a $PAYLOAD_DIR/. %{buildroot}/

%clean
rm -rf %{buildroot}

%files
%defattr(-,root,root)
${FILE_LIST}

# ── 安装前：杀死旧进程 ──
%pre
pid=\$(pgrep -x "excalidraw-desktop" 2>/dev/null || true)
if [ -n "\$pid" ]; then
  echo "[excalidraw-desktop] 正在停止旧进程 (PID: \$pid)..."
  kill \$pid 2>/dev/null
  for i in 1 2 3 4 5; do
    kill -0 \$pid 2>/dev/null || break
    sleep 1
  done
  kill -0 \$pid 2>/dev/null && kill -9 \$pid 2>/dev/null && echo "[excalidraw-desktop] 已强制停止" || echo "[excalidraw-desktop] 旧进程已停止"
fi

# ── 安装后：创建桌面快捷方式 ──
%post
for user_home in /home/*; do
  desktop_file="\$user_home/Desktop/excalidraw-desktop.desktop"
  if [ -d "\$user_home/Desktop" ] && [ -f /usr/share/applications/excalidraw-desktop.desktop ]; then
    cp /usr/share/applications/excalidraw-desktop.desktop "\$desktop_file"
    chmod +x "\$desktop_file"
    chown "\$(basename \$user_home):\$(basename \$user_home)" "\$desktop_file" 2>/dev/null || true
  fi
done

if hash gtk-update-icon-cache 2>/dev/null; then
  gtk-update-icon-cache -f /usr/share/icons/hicolor 2>/dev/null || true
fi
if hash update-desktop-database 2>/dev/null; then
  update-desktop-database /usr/share/applications || true
fi

# ── 卸载前：删除桌面快捷方式 ──
%preun
for user_home in /home/*; do
  desktop_file="\$user_home/Desktop/excalidraw-desktop.desktop"
  [ -f "\$desktop_file" ] && rm -f "\$desktop_file"
done

# ── 卸载后 ──
%postun
if hash update-desktop-database 2>/dev/null; then
  update-desktop-database /usr/share/applications || true
fi
SPECEOF

# 检查 spec 中文件列表是否包含引号包裹的空格路径
echo "=== 检查路径中的空格处理 ==="
grep -c '"' "$WORK_DIR/excalidraw.spec" || true

# 重建 RPM
rpmbuild -bb \
  --define "_topdir $WORK_DIR" \
  --define "_rpmdir $WORK_DIR" \
  --define "_rpmfilename excalidraw-desktop-${VERSION}-${RELEASE}.${ARCH}.rpm" \
  "$WORK_DIR/excalidraw.spec" 2>&1

NEW_RPM="$WORK_DIR/excalidraw-desktop-${VERSION}-${RELEASE}.${ARCH}.rpm"
if [ -f "$NEW_RPM" ]; then
  cp "$NEW_RPM" "$RPM_FILE"
  echo ""
  echo "=== OK: RPM 脚本注入成功 ==="
  rpm -qp --scripts "$RPM_FILE" 2>/dev/null
else
  echo "FAIL: 新 RPM 未生成"
  find "$WORK_DIR" -name "*.rpm" 2>/dev/null
  exit 1
fi
