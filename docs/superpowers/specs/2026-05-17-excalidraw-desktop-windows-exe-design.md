# Excalidraw Desktop: Windows EXE 安装包支持

## 概述

为 Excalidraw Desktop 添加 Windows NSIS 安装包支持，生成标准的 Windows 安装程序 (.exe)，功能与 Linux RPM 包完全对等。

## 架构

```
┌──────────────────────────────────────────────────────────┐
│                   Electron App                            │
│                                                           │
│   ┌─────────────────────────────────────────────────┐    │
│   │              electron-builder                    │    │
│   │                                                  │    │
│   │   Linux (RPM)          Windows (NSIS)           │    │
│   │   ┌────────────┐      ┌─────────────────┐       │    │
│   │   │  RPM Spec  │      │   NSIS Script   │       │    │
│   │   │  depends:  │      │   oneClick: false │      │    │
│   │   │  - libapp  │      │   allowDirChange: true│   │    │
│   │   │  - libXss  │      │   Shortcuts: ✓    │      │    │
│   │   └────────────┘      └─────────────────┘       │    │
│   └─────────────────────────────────────────────────┘    │
│                                                           │
│   ┌──────────────────────────────────────────────────┐   │
│   │   Main Process (main.ts) - 平台无关代码           │   │
│   │   - 系统托盘 (跨平台)                              │   │
│   │   - HTTP Server (Node.js http 模块)              │   │
│   │   - IPC / REST API                               │   │
│   └──────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

## 1. NSIS 安装包配置

### electron-builder `win` 配置

```json
{
  "win": {
    "target": ["nsis"],
    "icon": "build-assets/icon.png",
    "requestedExecutionLevel": "asInvoker"
  }
}
```

| 字段 | 值 | 说明 |
|------|-----|------|
| `target` | `["nsis"]` | 使用 NSIS 安装程序 |
| `icon` | `build-assets/icon.png` | 安装包和应用图标 |
| `requestedExecutionLevel` | `asInvoker` | 不需要管理员权限（用户目录安装） |

### NSIS 行为配置

```json
{
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "perMachine": false,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "Excalidraw Desktop"
  }
}
```

| 配置 | 值 | 说明 |
|------|-----|------|
| `oneClick` | `false` | 向导模式安装（非一键安装） |
| `allowToChangeInstallationDirectory` | `true` | 用户可自定义安装路径 |
| `perMachine` | `false` | 每用户安装（无需管理员） |
| `createDesktopShortcut` | `true` | 创建桌面快捷方式 |
| `createStartMenuShortcut` | `true` | 创建开始菜单快捷方式 |

## 2. 构建脚本

```json
{
  "scripts": {
    "build:win": "yarn build && electron-builder --win",
    "build:all": "yarn build && electron-builder --win --linux"
  }
}
```

## 3. 输出产物

**NSIS 安装程序:**
```
release/Excalidraw Desktop Setup 0.1.0.exe
```

**可选：未打包版本**
```
release/win-unpacked/  (绿色版，无需安装直接运行)
```

## 4. 功能对等性

| 功能 | Linux (RPM) | Windows (NSIS) | 实现方式 |
|------|-------------|----------------|----------|
| 系统托盘 | ✓ | ✓ | Electron Tray API (跨平台) |
| 托盘菜单 | ✓ | ✓ | Menu.buildFromTemplate |
| 打开 GUI | ✓ | ✓ | mainWindow.show() |
| 打开 WebUI | ✓ | ✓ | shell.openExternal() |
| HTTP Server | ✓ | ✓ | Node.js http 模块 |
| REST API | ✓ | ✓ | 统一 /api/* 端点 |
| WebUI 健康检查 | ✓ | ✓ | fetch(/api/health) |
| 文件 CRUD | ✓ | ✓ | fs 模块 |
| 最近项目 | ✓ | ✓ | JSON 存储 (appData) |
| 窗口管理 | ✓ | ✓ | BrowserWindow |

## 5. 边界情况处理

### 端口被占用

HTTP Server 端口 19530 被占用时：
- electron-builder 打包时不检测
- 运行时检测，dialog 提示用户

### 图标资源

Windows 和 Linux 共用同一套图标资源：
- `build-assets/icon.png` (256x256) - 应用图标
- `build-assets/tray-icon.png` (32x32) - 托盘图标

### 代码签名

当前配置**不包含代码签名**：
- 安装包会有 SmartScreen 警告
- 用户需手动点击"仍要运行"
- 未来可添加 `signAndEditExecutable` 配置

## 6. 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `excalidraw-desktop/package.json` | 添加 `win` 和 `nsis` 配置，新增 `build:win` 和 `build:all` 脚本 |

## 7. 验证清单

- [ ] `yarn build:win` 编译成功
- [ ] `release/*.exe` 文件生成
- [ ] 安装程序可正常安装到 Windows 10/11
- [ ] 桌面快捷方式创建成功
- [ ] 开始菜单快捷方式创建成功
- [ ] 应用启动后系统托盘正常显示
- [ ] 托盘菜单"打开 WebUI"可打开浏览器
- [ ] `curl /api/health` 返回正常
- [ ] GUI 模式文件 CRUD 正常
- [ ] WebUI 模式文件 CRUD 正常
