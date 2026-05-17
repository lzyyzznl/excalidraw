# Excalidraw Desktop: Windows EXE 安装包支持实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Excalidraw Desktop 添加 Windows NSIS 安装包支持，生成标准的 Windows 安装程序 (.exe)，功能与 Linux RPM 包完全对等。

**Architecture:** 在现有 electron-builder 配置的 package.json 中添加 `win` 和 `nsis` 配置块，与现有 `linux` 配置并行。代码无需修改，因为系统托盘、HTTP Server、REST API 等核心功能已使用跨平台 API 实现。

**Tech Stack:** Electron 33, electron-vite, electron-builder, NSIS (Nullsoft Scriptable Install System)

---

### Task 1: 更新 package.json 添加 Windows 打包配置

**Files:**
- Modify: `excalidraw-desktop/package.json`

- [ ] **Step 1: 在 package.json 中添加 `build:win` 和 `build:all` 脚本**

在现有 `scripts` 对象中添加（在 `build:linux` 之后）：

```json
"build:win": "yarn build && electron-builder --win",
"build:all": "yarn build && electron-builder --win --linux"
```

完整 scripts 示例：
```json
"scripts": {
  "dev": "electron-vite dev",
  "dev:web": "vite",
  "build": "electron-vite build",
  "preview": "electron-vite preview",
  "start": "electron .",
  "typecheck": "tsc --noEmit",
  "build:rpm": "yarn build && electron-builder --linux rpm && bash scripts/inject-rpm-scripts.sh",
  "build:linux": "yarn build && electron-builder --linux && bash scripts/inject-rpm-scripts.sh",
  "build:win": "yarn build && electron-builder --win",
  "build:all": "yarn build && electron-builder --win --linux"
}
```

- [ ] **Step 2: 在 `build` 对象中添加 `win` 配置**

在 `build` 对象中添加（在 `rpm` 配置之后）：

```json
"win": {
  "target": ["nsis"],
  "icon": "build-assets/icon.png",
  "requestedExecutionLevel": "asInvoker"
}
```

- [ ] **Step 3: 在 `build` 对象中添加 `nsis` 配置**

在 `win` 配置之后添加：

```json
"nsis": {
  "oneClick": false,
  "allowToChangeInstallationDirectory": true,
  "perMachine": false,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "shortcutName": "Excalidraw Desktop"
}
```

- [ ] **Step 4: 验证 package.json 格式正确**

运行：
```bash
cd excalidraw-desktop
node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf-8')); console.log('JSON 格式正确')"
```

预期输出：`JSON 格式正确`

- [ ] **Step 5: 提交**

```bash
git add excalidraw-desktop/package.json
git commit -m "feat: 添加 Windows NSIS 安装包配置"
```

---

### Task 2: 验证 TypeScript 编译

**Files:**
- 无修改（验证任务）

- [ ] **Step 1: 运行 TypeScript 类型检查**

运行：
```bash
cd excalidraw-desktop
yarn typecheck
```

预期输出：无错误（或仅有与本次变更无关的现有错误）

- [ ] **Step 2: 运行 electron-vite 构建**

运行：
```bash
cd excalidraw-desktop
yarn build
```

预期输出：
```
build complete
dist/main/index.js
dist/preload/index.js
dist/renderer/
```

- [ ] **Step 3: 验证构建产物存在**

运行：
```bash
ls -la excalidraw-desktop/dist/
```

预期输出：包含 `main/`, `preload/`, `renderer/` 目录

---

### Task 3: Windows 打包测试

**Files:**
- 无修改（验证任务）

- [ ] **Step 1: 运行 Windows 打包命令**

运行：
```bash
cd excalidraw-desktop
yarn build:win 2>&1
```

预期输出：
```
• electron-builder  version=25.x.x
• writing output    file=release/Excalidraw Desktop Setup 0.1.0.exe
```

- [ ] **Step 2: 验证 .exe 文件生成**

运行：
```bash
ls -la "excalidraw-desktop/release/"
```

预期输出：
```
Excalidraw Desktop Setup 0.1.0.exe
win-unpacked/  (可选，未打包版本)
```

- [ ] **Step 3: 提交**

```bash
git add excalidraw-desktop/release/
git commit -m "build: 生成 Windows NSIS 安装包"
```

注意：如果 release/ 在 .gitignore 中，则跳过此提交步骤

---

### Task 4: 功能验证（在 Windows 环境）

**Files:**
- 无修改（验证任务）

此任务需要在 Windows 10/11 机器上执行。

- [ ] **Step 1: 安装生成的 .exe**

在 Windows 机器上运行：
```powershell
.\ExcalidrawDesktopSetup0.1.0.exe
```

验证：
- 安装向导正常启动
- 可选择安装路径
- 安装完成后创建桌面快捷方式
- 安装完成后创建开始菜单快捷方式

- [ ] **Step 2: 启动应用并验证系统托盘**

验证：
- 应用窗口正常显示
- 系统托盘图标出现
- 右键托盘图标弹出菜单（打开 Excalidraw、打开 WebUI、退出）

- [ ] **Step 3: 验证 WebUI 功能**

运行：
```powershell
curl http://localhost:19530/api/health
```

预期输出：
```json
{"status":"ok","version":"0.1.0"}
```

- [ ] **Step 4: 验证 GUI 模式文件 CRUD**

在应用中：
- 选择目录
- 创建新文件
- 打开现有文件
- 保存文件

- [ ] **Step 5: 验证 WebUI 模式**

在浏览器中打开 http://localhost:19530：
- 健康检查通过
- 文件列表正常显示
- 文件 CRUD 操作正常

---

### Task 依赖关系

```
Task 1 (package.json 配置) ──→ Task 2 (编译验证) ──→ Task 3 (打包测试) ──→ Task 4 (功能验证)
```

## 验证清单

- [ ] `yarn build:win` 编译成功，无 TS 错误
- [ ] `release/*.exe` 文件生成
- [ ] 安装包可在 Windows 10/11 上正常安装
- [ ] 桌面快捷方式创建成功
- [ ] 开始菜单快捷方式创建成功
- [ ] 应用启动后系统托盘正常显示
- [ ] 托盘菜单"打开 WebUI"可打开浏览器
- [ ] `curl /api/health` 返回 `{"status":"ok","version":"0.1.0"}`
- [ ] GUI 模式下文件 CRUD 正常
- [ ] WebUI 模式下文件 CRUD 正常
