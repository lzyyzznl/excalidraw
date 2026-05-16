# Excalidraw Desktop: 系统托盘 + WebUI + RPM 打包

## 概述

为 Excalidraw Desktop 添加系统托盘，支持从托盘打开 GUI 窗口和 WebUI（浏览器），并打包为 RPM 发行。

## 架构

```
┌──────────────────────────────────────────────────┐
│                Electron App                       │
│                                                   │
│   ┌──────────────┐   ┌────────────────────────┐   │
│   │  System Tray  │   │    HTTP Server          │   │
│   │  (Tray+Menu)  │   │    (port 19530)         │   │
│   │  - 打开 GUI   │   │  - Serve dist/renderer/ │   │
│   │  - 打开 WebUI │   │  - REST API /api/*      │   │
│   │  - 退出       │   │  - 按需启动, 常驻运行    │   │
│   └──────┬───────┘   └──────────┬─────────────┘   │
│          │                      │                  │
│   ┌──────▼──────────────────────▼──────────────┐   │
│   │          Main Process (main.ts)             │   │
│   │  - 窗口管理 (显示/隐藏/创建)                 │   │
│   │  - Tray 管理                                │   │
│   │  - IPC handlers (给 GUI 使用)               │   │
│   │  - HTTP Server + REST API (给 WebUI 使用)   │   │
│   └──────────────────────┬──────────────────────┘   │
│                          │                          │
│   ┌──────────────────────▼──────────────────────┐   │
│   │   Renderer (React App)                      │   │
│   │  - Excalidraw 编辑器                        │   │
│   │  - 文件侧边栏                               │   │
│   │  - 统一 API 适配层 (api.ts)                 │   │
│   │  - WebUI 模式下 fallback 提示               │   │
│   └─────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

### 数据流

**GUI 模式 (Electron 窗口):**
```
Renderer → api.ts (electronAPI) → preload IPC → main.ts IPC handler → fs
```

**WebUI 模式 (浏览器):**
```
Browser → api.ts (webAPI) → fetch('/api/*') → main.ts HTTP handler → fs
```

两种模式下，前端组件通过同一套 `api.ts` 接口调用，实现方式在内部切换。

## 1. 系统托盘

### 行为规则

| 操作 | 行为 |
|------|------|
| 应用启动 | 创建主窗口 → 创建 Tray（窗口可见） |
| 关闭窗口 (×按钮) | `event.preventDefault()` → `win.hide()`（窗口隐藏到托盘） |
| 左键托盘图标 | 切换窗口可见性（显示/隐藏） |
| 右键托盘图标 | 弹出上下文菜单 |
| "打开 Excalidraw" | `win.show()` + `win.focus()` |
| "打开 WebUI" | HTTP Server 未启动则启动，然后 `shell.openExternal('http://localhost:19530')` |
| "退出" | `app.quit()` |
| 所有窗口关闭 | 不退出（除非 `app.quit()` 被调用） |

### 菜单结构

```
Excalidraw Desktop
──────────────────
打开 Excalidraw      → win.show() + focus()
打开 WebUI           → startHttpServer() + openBrowser()
──────────────────
退出                 → app.quit()
```

### 图标

- Tray 图标: `build-assets/tray-icon.png`（32x32 PNG，透明背景）
- 打包用图标: `build-assets/icon.png`（256x256）
- Linux 下 Tray 使用 `NativeImage.createFromPath()`

### Linux Tray 兼容性

Linux 上 Tray 需要 app indicator 支持:
- Ubuntu 20.04+: `libayatana-appindicator3-1`
- 旧发行版: `libappindicator-gtk3`
- RPM 打包在 `depends` 中声明，但实际由系统包管理器处理

## 2. HTTP Server + REST API

### 技术选型

- 使用 Node.js 内置 `http` 模块 + 自制静态文件服务
- **零外部依赖**，不引入 Express/Koa
- 端口: `19530`（固定）
- 按需启动（首次点击"打开 WebUI"时），启动后常驻

### 静态文件服务

- Serve `dist/renderer/` 目录（electron-vite 的 renderer 构建产物）
- 自动检测 MIME 类型 (`.html` → `text/html`, `.js` → `application/javascript`, etc.)
- SPA 回退: 未知路径返回 `index.html` 内容

### REST API 端点

所有 API 路径以 `/api/` 为前缀，非 `/api/` 请求按静态文件处理。

#### 健康检查

```
GET /api/health
→ { "status": "ok", "version": "0.1.0" }
```

WebUI 前端启动时调用，失败则显示"请先启动 Excalidraw Desktop 桌面应用"。

#### 列出文件

```
GET /api/files?dir={directory}
→ { "files": [{ "name": "drawing.excalidraw", "path": "/xxx/drawing.excalidraw", "modifiedAt": 1234567890 }] }
  or { "error": "..." }
```

#### 读取文件

```
GET /api/files/read?path={filePath}
→ { "data": { "type": "excalidraw", "elements": [], ... } }
  or { "error": "corrupted" | "..." }
```

#### 写入文件

```
POST /api/files/write
Body: { "path": "/xxx/drawing.excalidraw", "content": "{...}" }
→ { "success": true } or { "error": "..." }
```

#### 创建文件

```
POST /api/files/create
Body: { "dir": "/xxx", "name": "drawing.excalidraw" }
→ { "path": "/xxx/drawing.excalidraw" } or { "error": "..." }
```

#### 最近项目

```
GET /api/projects/recent
→ [{ "directory": "/xxx", "lastFile": null, "lastOpened": 1234567890 }]

POST /api/projects/recent
Body: { "directory": "/xxx", "lastFile": null, "lastOpened": 1234567890 }
→ { "success": true }
```

#### 目录选择（WebUI 不可用）

```
POST /api/directory/select
→ WebUI 下始终返回 { "error": "WebUI 不支持选择目录，请在桌面版中操作" }
```

### 错误处理

- 所有 API 错误统一返回 JSON: `{ "error": "<message>" }`
- HTTP 状态码: 200（成功）, 400（参数错误）, 404（资源不存在）, 500（服务器错误）
- JSON 解析失败返回 400

### server 生命周期

```
let httpServer: http.Server | null = null;

function startHttpServer(): boolean {
  if (httpServer) return true; // 已启动
  try {
    httpServer = http.createServer(handler);
    httpServer.listen(19530, '127.0.0.1');
    return true;
  } catch (e) {
    return false;
  }
}
```

- 只在 `127.0.0.1` 监听，不对外暴露
- 端口被占用时返回错误，在托盘弹出 dialog 提示
- 随应用进程退出自动释放，无需显式 close

## 3. 前端 API 适配层

### 架构

新增 `src/api.ts`，封装统一接口：

```typescript
interface AppAPI {
  platform: string;
  selectDirectory(): Promise<string | null>;
  listFiles(dir: string): Promise<...>;
  readFile(path: string): Promise<...>;
  writeFile(path: string, content: string): Promise<...>;
  createFile(dir: string, name: string): Promise<...>;
  getRecentProjects(): Promise<...>;
  addRecentProject(project: RecentProject): Promise<void>;
}

const api: AppAPI = typeof window.electronAPI !== 'undefined'
  ? electronAPIAdapter(window.electronAPI)
  : webAPIAdapter();
```

### 改动范围

| 文件 | 改动 |
|------|------|
| `src/api.ts` | **新增** — 统一 API 适配层 |
| `src/App.tsx` | 将 `window.electronAPI!.xxx()` 替换为 `api.xxx()` |
| `src/ExcalidrawEditor.tsx` | 无改动（通过 `ProjectFileManager` 调用） |
| `src/ProjectFileManager.ts` | 将 `window.electronAPI` 替换为 `api` 导入 |
| `src/env.d.ts` | 无改动 |

### WebUI 模式下的限制

WebUI 前端启动时先 `fetch('/api/health')`:
- **成功**: 正常使用，所有文件操作走 REST API，不支持"选择目录"（返回错误提示）
- **失败**: 显示错误提示页："Excalidraw Desktop 未启动，请先打开桌面应用"

### 目录 watch 处理

WebUI 模式下 `fs.watch` 不可用:
- GUI 模式: 保持现有 IPC watch 机制
- WebUI 模式: 增加 `GET /api/files/poll?dir=xxx&since=timestamp` 轮询接口，前端每 3 秒调用

## 4. RPM 打包

### electron-builder 配置

在 `package.json` 中新增 `"build"` 字段：

```json
{
  "build": {
    "appId": "com.excalidraw.desktop",
    "productName": "Excalidraw Desktop",
    "directories": { "output": "release" },
    "files": ["dist/**/*", "package.json"],
    "extraResources": [{
      "from": "build-assets/",
      "to": "assets/",
      "filter": ["**/*"]
    }],
    "linux": {
      "target": ["rpm"],
      "category": "Graphics",
      "icon": "build-assets/icon.png",
      "executableName": "excalidraw-desktop",
      "synopsis": "Excalidraw Desktop - Virtual whiteboard",
      "description": "A virtual whiteboard for sketching hand-drawn like diagrams"
    },
    "rpm": {
      "depends": ["libappindicator-gtk3", "libxss1"]
    }
  }
}
```

### 需要新增/修改的 files

- `electron-builder` — devDependency (package.json)
- `build-assets/icon.png` — 256x256 应用图标
- `build-assets/tray-icon.png` — 32x32 托盘图标
- `package.json` — 新增 build 字段和 script

### 构建脚本

```json
{
  "scripts": {
    "build:rpm": "yarn build && electron-builder --linux rpm",
    "build:linux": "yarn build && electron-builder --linux"
  }
}
```

### RPM 依赖

| 包 | 用途 |
|------|------|
| `libXScrnSaver` | Electron screen saver detection |
| `libappindicator-gtk3` | 系统托盘 (旧版 Linux) |
| `libayatana-appindicator` | 系统托盘 (新版 Linux, 运行时替代) |
| `at-spi2-core` | Accessibility |

## 边界情况及错误处理

### 端口被占用
- HTTP Server 启动时 `listen(19530)` 抛出 `EADDRINUSE`
- main 进程通过 dialog 弹窗提示："端口 19530 已被占用，请关闭占用程序后重试"
- Tray 菜单"打开 WebUI" 照常可用（但前端 health check 会失败并显示提示）

### HTTP Server 启动失败
- 不影响 GUI 正常使用
- Tray 菜单"打开 WebUI" 如果检测到未启动，尝试启动；失败后 dialog 提示

### WebUI 前端检测不到后端
- 页面加载后 `fetch('/api/health')` 超时（2 秒）
- 渲染断网提示页，带有"重试"按钮
- 不阻塞 GUI 模式渲染

### 文件操作错误
- REST API 错误统一 JSON 格式
- 前端 `api.ts` 封装统一错误处理
- WebUI 中的写操作失败通过 error toast 显示

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `electron/main.ts` | 添加 Tray + HTTP Server + REST API |
| 新增 | `src/api.ts` | 统一 API 适配层 |
| 修改 | `src/App.tsx` | 替换 `window.electronAPI` → `api` |
| 修改 | `src/ProjectFileManager.ts` | 替换 `window.electronAPI` → `api` |
| 修改 | `package.json` | 添加 build 配置、依赖、scripts |
| 新增 | `build-assets/icon.png` | 应用图标 256x256 |
| 新增 | `build-assets/tray-icon.png` | 托盘图标 32x32 |
