# Excalidraw Desktop: 托盘 + WebUI + RPM 打包 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) for syntax tracking.

**Goal:** 为 Excalidraw Desktop 增加系统托盘 + 内嵌 HTTP Server (WebUI) + RPM 打包能力

**Architecture:** 在 Electron 主进程中新增 Tray 管理窗口隐藏/显示/退出，内嵌 HTTP Server（`http` 模块零依赖）同时 serve 静态文件和 REST API。前端新增统一 `api.ts` 适配层，GUI 走 IPC、WebUI 走 fetch，上层组件无感知。

**Tech Stack:** Electron 33, electron-vite, electron-builder, Node.js http 模块, React 19

**关键路径说明:** 由于 `excalidraw-desktop/` 是新增目录尚未提交，工作树中没有该目录。实施前需先从原始仓库拷贝未提交的文件到工作树。

---

### 准备工作：拷贝 excalidraw-desktop 到工作树

- [ ] **从原始仓库拷贝代码**

```bash
# 从原始仓库拷贝 excalidraw-desktop 到工作树
cp -r /home/0668001050/workspace/excalidraw/excalidraw-desktop /home/0668001050/workspace/excalidraw/.claude/worktrees/tray-webui-rpm/excalidraw-desktop
```

---

### Task 1: 创建 build-assets 图标资源

**Files:**
- Create: `excalidraw-desktop/build-assets/icon.png`
- Create: `excalidraw-desktop/build-assets/tray-icon.png`
- Create: `excalidraw-desktop/build-assets/icon.svg`

- [ ] **创建 SVG 源文件（应用图标 + 托盘图标共用）**

```svg
<!-- excalidraw-desktop/build-assets/icon.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <rect width="256" height="256" rx="32" fill="#6965DB"/>
  <g transform="translate(128,128) scale(4.5)">
    <!-- 铅笔 icon: M2 20 L18 4 L22 8 L6 24 Z -->
    <path d="M2 18 L16 4 A2 2 0 0 1 19 4 L22 7 A2 2 0 0 1 22 10 L8 24 L2 22 Z"
          fill="none" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
    <line x1="2" y1="22" x2="6" y2="18" stroke="white" stroke-width="1.5"/>
    <line x1="14" y1="6" x2="20" y2="12" stroke="white" stroke-width="1" opacity="0.5"/>
  </g>
</svg>
```

- [ ] **生成 PNG 图标**

```bash
# 如果系统有 convert (ImageMagick) 或 rsvg-convert, 转换 SVG 到 PNG
# 否则手动创建最小 PNG 作为占位
cd /home/0668001050/workspace/excalidraw/.claude/worktrees/tray-webui-rpm/excalidraw-desktop/build-assets

if command -v rsvg-convert &>/dev/null; then
  rsvg-convert -w 256 -h 256 icon.svg -o icon.png
  rsvg-convert -w 32 -h 32 icon.svg -o tray-icon.png
elif command -v convert &>/dev/null; then
  convert -background none icon.svg -resize 256x256 icon.png
  convert -background none icon.svg -resize 32x32 tray-icon.png
else
  # 用 Node.js 生成最小有效 PNG (1x1 透明像素占位)
  node -e "
const fs = require('fs');
// 最小有效 PNG (1x1 透明像素) + 作为占位
const { createCanvas } = (() => {
  try { return require('canvas'); } catch { return null; }
})();
if (createCanvas) {
  const c = createCanvas(256, 256);
  // draw something simple
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6965DB';
  ctx.beginPath();
  ctx.roundRect(0, 0, 256, 256, 32);
  ctx.fill();
  const buf = c.toBuffer('image/png');
  fs.writeFileSync('icon.png', buf);
  fs.writeFileSync('tray-icon.png', createCanvas(32,32).toBuffer('image/png'));
} else {
  console.log('No canvas library, create placeholder PNGs manually');
}
"
fi
```

验证: `ls -la excalidraw-desktop/build-assets/` 包含 `icon.png`, `tray-icon.png`, `icon.svg`

---

### Task 2: 创建 HTTP Server 模块 (`electron/http-server.ts`)

**Files:**
- Create: `excalidraw-desktop/electron/http-server.ts`

这个模块负责启动 HTTP server，serve renderer 静态文件并提供 REST API。

- [ ] **创建 http-server.ts**

```typescript
// excalidraw-desktop/electron/http-server.ts
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { parse as parseUrl } from "url";

const PORT = 19530;
const HOST = "127.0.0.1";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

let server: http.Server | null = null;
let rendererDir = "";

function getMimeType(ext: string): string {
  return MIME_TYPES[ext] || "application/octet-stream";
}

// ── REST API handlers ──────────────────────────────────────────────────────

interface SimpleFileInfo {
  name: string;
  path: string;
  modifiedAt: number;
}

interface RecentProject {
  directory: string;
  lastFile: string | null;
  lastOpened: number;
}

const RECENT_PROJECTS_FILE = "recent-projects.json";

function getRecentProjectsPath(userDataPath: string): string {
  return path.join(userDataPath, RECENT_PROJECTS_FILE);
}

function readRecentProjects(userDataPath: string): RecentProject[] {
  try {
    const filePath = getRecentProjectsPath(userDataPath);
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

async function handleApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  userDataPath: string,
): Promise<void> {
  const url = parseUrl(req.url || "", true);
  const pathname = url.pathname || "";
  const query = url.query;

  const sendJson = (status: number, data: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  };

  const sendError = (status: number, message: string) => {
    sendJson(status, { error: message });
  };

  // POST helper
  const readBody = (): Promise<any> =>
    new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("Invalid JSON"));
        }
      });
    });

  // ── GET /api/health ──────────────────────────────────────────────────
  if (pathname === "/api/health" && req.method === "GET") {
    sendJson(200, { status: "ok", version: "0.1.0" });
    return;
  }

  // ── GET /api/files?dir=xxx ───────────────────────────────────────────
  if (pathname === "/api/files" && req.method === "GET") {
    const dir = query.dir as string;
    if (!dir) return sendError(400, "Missing 'dir' query parameter");
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: SimpleFileInfo[] = entries
        .filter(
          (entry) =>
            entry.isFile() && entry.name.toLowerCase().endsWith(".excalidraw"),
        )
        .map((entry) => {
          const filePath = path.join(dir, entry.name);
          const stat = fs.statSync(filePath);
          return { name: entry.name, path: filePath, modifiedAt: stat.mtimeMs };
        })
        .sort((a, b) => b.modifiedAt - a.modifiedAt);
      sendJson(200, { files });
    } catch (err: any) {
      sendError(500, err.message);
    }
    return;
  }

  // ── GET /api/files/read?path=xxx ─────────────────────────────────────
  if (pathname === "/api/files/read" && req.method === "GET") {
    const filePath = query.path as string;
    if (!filePath) return sendError(400, "Missing 'path' query parameter");
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      sendJson(200, { data });
    } catch (err: any) {
      if (err instanceof SyntaxError) sendJson(200, { error: "corrupted" });
      else sendError(500, err.message);
    }
    return;
  }

  // ── POST /api/files/write ────────────────────────────────────────────
  if (pathname === "/api/files/write" && req.method === "POST") {
    try {
      const body = await readBody();
      JSON.parse(body.content); // validate JSON
      fs.writeFileSync(body.path, body.content, "utf-8");
      sendJson(200, { success: true });
    } catch (err: any) {
      sendError(500, err.message);
    }
    return;
  }

  // ── POST /api/files/create ───────────────────────────────────────────
  if (pathname === "/api/files/create" && req.method === "POST") {
    try {
      const body = await readBody();
      const filePath = path.join(body.dir, body.name);
      const emptyScene = JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "excalidraw-desktop",
        elements: [],
        appState: {},
        files: {},
      });
      fs.writeFileSync(filePath, emptyScene, "utf-8");
      sendJson(200, { path: filePath });
    } catch (err: any) {
      sendError(500, err.message);
    }
    return;
  }

  // ── GET /api/files/poll?dir=xxx&since=timestamp ──────────────────────
  if (pathname === "/api/files/poll" && req.method === "GET") {
    const dir = query.dir as string;
    const since = parseInt(query.since as string, 10) || 0;
    if (!dir) return sendError(400, "Missing 'dir' query parameter");
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: SimpleFileInfo[] = entries
        .filter(
          (entry) =>
            entry.isFile() && entry.name.toLowerCase().endsWith(".excalidraw"),
        )
        .map((entry) => {
          const filePath = path.join(dir, entry.name);
          const stat = fs.statSync(filePath);
          return { name: entry.name, path: filePath, modifiedAt: stat.mtimeMs };
        })
        .sort((a, b) => b.modifiedAt - a.modifiedAt);
      // 只返回 since 之后有变化的文件
      const changed = files.filter((f) => f.modifiedAt > since);
      sendJson(200, { files, changed });
    } catch (err: any) {
      sendError(500, err.message);
    }
    return;
  }

  // ── GET /api/projects/recent ─────────────────────────────────────────
  if (pathname === "/api/projects/recent" && req.method === "GET") {
    const projects = readRecentProjects(userDataPath);
    sendJson(200, projects);
    return;
  }

  // ── POST /api/projects/recent ────────────────────────────────────────
  if (pathname === "/api/projects/recent" && req.method === "POST") {
    try {
      const body = await readBody();
      const projects = readRecentProjects(userDataPath);
      const filtered = projects.filter(
        (p: RecentProject) => p.directory !== body.directory,
      );
      filtered.unshift(body);
      const recentPath = getRecentProjectsPath(userDataPath);
      fs.writeFileSync(recentPath, JSON.stringify(filtered.slice(0, 20), null, 2));
      sendJson(200, { success: true });
    } catch (err: any) {
      sendError(500, err.message);
    }
    return;
  }

  // ── POST /api/directory/select (not available in WebUI) ─────────────
  if (pathname === "/api/directory/select") {
    sendError(400, "WebUI 不支持选择目录，请在桌面版中操作");
    return;
  }

  // ── 404: unknown API route ───────────────────────────────────────────
  sendError(404, `Unknown API endpoint: ${req.method} ${pathname}`);
}

function handleStaticFile(
  res: http.ServerResponse,
  filePath: string,
): void {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = getMimeType(ext);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: serve index.html
      const indexPath = path.join(rendererDir, "index.html");
      fs.readFile(indexPath, (err2, data2) => {
        if (err2) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Internal server error");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data2);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

export function getServerPort(): number {
  return PORT;
}

export function isServerRunning(): boolean {
  return server !== null;
}

export function startServer(rendererDirPath: string, userDataPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve();
      return;
    }

    rendererDir = rendererDirPath;

    // verify renderer dir exists
    if (!fs.existsSync(rendererDir)) {
      reject(new Error(`Renderer 构建产物目录不存在: ${rendererDir}`));
      return;
    }

    server = http.createServer((req, res) => {
      const url = parseUrl(req.url || "", true);
      const pathname = url.pathname || "";

      // API routes
      if (pathname.startsWith("/api/")) {
        handleApiRequest(req, res, userDataPath);
        return;
      }

      // Static files
      let filePath = path.join(rendererDir, pathname === "/" ? "index.html" : pathname);
      handleStaticFile(res, filePath);
    });

    server.listen(PORT, HOST, () => {
      console.log(`[WebUI] HTTP server running at http://${HOST}:${PORT}`);
      resolve();
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      server = null;
      if (err.code === "EADDRINUSE") {
        reject(new Error(`端口 ${PORT} 已被占用，请关闭占用程序后重试`));
      } else {
        reject(err);
      }
    });
  });
}

export function stopServer(): void {
  if (server) {
    server.close();
    server = null;
  }
}
```

- [ ] **验证 TypeScript 编译通过**

```bash
cd /home/0668001050/workspace/excalidraw/.claude/worktrees/tray-webui-rpm/excalidraw-desktop
npx tsc --noEmit electron/http-server.ts 2>&1 || echo "May need to run within electron-vite build context"
```

---

### Task 3: 修改 main.ts — 添加系统托盘和 HTTP Server 集成

**Files:**
- Modify: `excalidraw-desktop/electron/main.ts`

完整替换 main.ts，新增 Tray + 集成 HTTP Server：

- [ ] **重写 main.ts**

```typescript
// excalidraw-desktop/electron/main.ts
import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } from "electron";
import { join } from "path";
import * as fs from "fs";
import { startServer, isServerRunning, getServerPort } from "./http-server";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const RECENT_PROJECTS_FILE = "recent-projects.json";
const isDev = !!process.env.ELECTRON_RENDERER_URL;

// ── Recent Projects (从原始 main.ts 迁移) ──────────────────────────────────

function getRecentProjectsPath(): string {
  return join(app.getPath("userData"), RECENT_PROJECTS_FILE);
}

function readRecentProjects(): Array<{
  directory: string;
  lastFile: string | null;
  lastOpened: number;
}> {
  try {
    const filePath = getRecentProjectsPath();
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

function writeRecentProjects(projects: Array<{
  directory: string;
  lastFile: string | null;
  lastOpened: number;
}>) {
  fs.writeFileSync(getRecentProjectsPath(), JSON.stringify(projects, null, 2));
}

// ── Tray ────────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = join(__dirname, "../../build-assets/tray-icon.png");
  let trayIcon: Electron.NativeImage;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    // Linux 上需要 resize 到 22x22
    if (process.platform === "linux") {
      trayIcon = trayIcon.resize({ width: 22, height: 22 });
    }
  } catch {
    // 图标加载失败时使用空图像
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("Excalidraw Desktop");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "打开 Excalidraw",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "打开 WebUI",
      click: async () => {
        try {
          if (!isServerRunning()) {
            const rendererDir = join(__dirname, "../renderer");
            await startServer(rendererDir, app.getPath("userData"));
          }
          await shell.openExternal(`http://127.0.0.1:${getServerPort()}`);
        } catch (err: any) {
          dialog.showErrorBox("WebUI 启动失败", err.message);
        }
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // 左键单击切换窗口可见性
  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// ── Window ──────────────────────────────────────────────────────────────────

export function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  // Capture renderer console messages
  mainWindow.webContents.on("console-message", (_event, level, message) => {
    const prefix = ["INFO", "WARN", "ERROR"][level] || "LOG";
    console.log(`[Renderer:${prefix}] ${message}`);
  });

  mainWindow.webContents.on("unhandled-rejection", (event: Electron.Event) => {
    console.error("[Renderer:UNHANDLED_REJECTION]", event);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // 窗口关闭 → 隐藏到托盘 (不退出)
  mainWindow.on("close", (event) => {
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── IPC Handlers (从原始 main.ts 迁移, 无变化) ─────────────────────────────

ipcMain.handle("select-directory", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("list-files", async (_event, dir: string) => {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries
      .filter(
        (entry) =>
          entry.isFile() && entry.name.toLowerCase().endsWith(".excalidraw"),
      )
      .map((entry) => {
        const filePath = join(dir, entry.name);
        const stat = fs.statSync(filePath);
        return {
          name: entry.name,
          path: filePath,
          modifiedAt: stat.mtimeMs,
        };
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt);
    return files;
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle("read-file", async (_event, filePath: string) => {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(content);
    return { data };
  } catch (err: any) {
    if (err instanceof SyntaxError) {
      return { error: "corrupted" };
    }
    return { error: err.message };
  }
});

ipcMain.handle("write-file", async (_event, filePath: string, content: string) => {
  try {
    JSON.parse(content);
    fs.writeFileSync(filePath, content, "utf-8");
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle("create-file", async (_event, dir: string, name: string) => {
  try {
    const filePath = join(dir, name);
    const emptyScene = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "excalidraw-desktop",
      elements: [],
      appState: {},
      files: {},
    });
    fs.writeFileSync(filePath, emptyScene, "utf-8");
    return { path: filePath };
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle("watch-directory", async (_event, dir: string, channel: string) => {
  try {
    const watcher = fs.watch(dir, (eventType) => {
      if (eventType === "rename" && mainWindow) {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          const files = entries
            .filter(
              (entry) =>
                entry.isFile() &&
                entry.name.toLowerCase().endsWith(".excalidraw"),
            )
            .map((entry) => {
              const filePath = join(dir, entry.name);
              const stat = fs.statSync(filePath);
              return {
                name: entry.name,
                path: filePath,
                modifiedAt: stat.mtimeMs,
              };
            })
            .sort((a, b) => b.modifiedAt - a.modifiedAt);
          mainWindow.webContents.send(channel, files);
        } catch {
          // Directory might have been removed
        }
      }
    });
    return true;
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle("get-recent-projects", async () => {
  return readRecentProjects();
});

ipcMain.handle("add-recent-project", async (_event, project) => {
  const projects = readRecentProjects();
  const filtered = projects.filter((p) => p.directory !== project.directory);
  filtered.unshift(project);
  writeRecentProjects(filtered.slice(0, 20));
});

// ── App Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 不退出: 关闭窗口时只是隐藏到托盘
// app.on("window-all-closed") 不再需要
```

- [ ] **验证编译**

```bash
cd /home/0668001050/workspace/excalidraw/.claude/worktrees/tray-webui-rpm/excalidraw-desktop
yarn build 2>&1 | tail -20
```

---

### Task 4: 创建统一 API 适配层 (`src/api.ts`)

**Files:**
- Create: `excalidraw-desktop/src/api.ts`

封装统一的 API 接口，使 GUI (electronAPI/IPC) 和 WebUI (fetch) 使用相同调用方式。

- [ ] **创建 src/api.ts**

```typescript
// excalidraw-desktop/src/api.ts

export interface ProjectFile {
  name: string;
  path: string;
  modifiedAt: number;
}

export interface RecentProject {
  directory: string;
  lastFile: string | null;
  lastOpened: number;
}

export interface AppAPI {
  readonly platform: string;
  selectDirectory(): Promise<string | null>;
  listFiles(
    dir: string,
  ): Promise<ProjectFile[] | { error: string }>;
  readFile(
    filePath: string,
  ): Promise<{ data?: any; error?: string }>;
  writeFile(
    filePath: string,
    content: string,
  ): Promise<{ success?: boolean; error?: string }>;
  createFile(
    dir: string,
    name: string,
  ): Promise<{ path?: string; error?: string }>;
  watchDirectory(
    dir: string,
    callback: (files: ProjectFile[]) => void,
  ): () => void;
  getRecentProjects(): Promise<RecentProject[]>;
  addRecentProject(project: RecentProject): Promise<void>;
}

// ── Electron (IPC) Adapter ──────────────────────────────────────────────────

function createElectronAPI(electronAPI: Window["electronAPI"]): AppAPI {
  return {
    get platform() {
      return electronAPI!.platform;
    },
    selectDirectory: () => electronAPI!.selectDirectory(),
    listFiles: (dir) => electronAPI!.listFiles(dir),
    readFile: (path) => electronAPI!.readFile(path),
    writeFile: (path, content) => electronAPI!.writeFile(path, content),
    createFile: (dir, name) => electronAPI!.createFile(dir, name),
    watchDirectory: (dir, callback) => electronAPI!.watchDirectory(dir, callback),
    getRecentProjects: () => electronAPI!.getRecentProjects(),
    addRecentProject: (project) => electronAPI!.addRecentProject(project),
  };
}

// ── WebUI (Fetch) Adapter ───────────────────────────────────────────────────

function createWebAPI(): AppAPI {
  const BASE = ""; // same origin

  async function apiFetch<T>(
    url: string,
    options?: RequestInit,
  ): Promise<T> {
    const res = await fetch(`${BASE}${url}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
    return res.json() as Promise<T>;
  }

  // 轮询用
  const watchers = new Map<string, ReturnType<typeof setInterval>>();

  return {
    platform: "web",
    selectDirectory: async () => {
      // WebUI 下不可用
      return null;
    },
    listFiles: async (dir) => {
      const result = await apiFetch<{ files?: ProjectFile[]; error?: string }>(
        `/api/files?dir=${encodeURIComponent(dir)}`,
      );
      if (result.error) return { error: result.error };
      return result.files || [];
    },
    readFile: async (filePath) => {
      return apiFetch<{ data?: any; error?: string }>(
        `/api/files/read?path=${encodeURIComponent(filePath)}`,
      );
    },
    writeFile: async (filePath, content) => {
      return apiFetch<{ success?: boolean; error?: string }>(
        "/api/files/write",
        {
          method: "POST",
          body: JSON.stringify({ path: filePath, content }),
        },
      );
    },
    createFile: async (dir, name) => {
      return apiFetch<{ path?: string; error?: string }>("/api/files/create", {
        method: "POST",
        body: JSON.stringify({ dir, name }),
      });
    },
    watchDirectory: (dir, callback) => {
      // polling mode: 每 3 秒检查文件变化
      const interval = setInterval(async () => {
        const result = await apiFetch<{
          files?: ProjectFile[];
          changed?: ProjectFile[];
          error?: string;
        }>(`/api/files?dir=${encodeURIComponent(dir)}`);
        if (result.files) {
          callback(result.files);
        }
      }, 3000);
      watchers.set(dir, interval);
      return () => {
        const i = watchers.get(dir);
        if (i) {
          clearInterval(i);
          watchers.delete(dir);
        }
      };
    },
    getRecentProjects: async () => {
      return apiFetch<RecentProject[]>("/api/projects/recent");
    },
    addRecentProject: async (project) => {
      await apiFetch("/api/projects/recent", {
        method: "POST",
        body: JSON.stringify(project),
      });
    },
  };
}

// ── Singleton ───────────────────────────────────────────────────────────────

const isDesktop = typeof window.electronAPI !== "undefined";

export const api: AppAPI = isDesktop
  ? createElectronAPI(window.electronAPI!)
  : createWebAPI();

export { isDesktop };
```

---

### Task 5: 更新 ProjectFileManager.ts 使用 api.ts

**Files:**
- Modify: `excalidraw-desktop/src/ProjectFileManager.ts`

- [ ] **替换 `window.electronAPI` 引用为 `api`**

```typescript
// excalidraw-desktop/src/ProjectFileManager.ts
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";
import { api } from "./api";              // ← 新增导入

export interface ParsedProjectFile {
  type: string;
  version: number;
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files?: BinaryFiles;
}

export async function readProjectFile(
  filePath: string,
): Promise<ParsedProjectFile> {
  // 改为使用 api.readFile (统一适配层)
  const result = await api.readFile(filePath);

  if (result.error === "corrupted") {
    throw new Error(`文件已损坏，无法读取: ${filePath}`);
  }

  if (result.error) {
    throw new Error(`读取文件失败: ${result.error}`);
  }

  const data = result.data;
  if (!data || data.type !== "excalidraw") {
    throw new Error(`无效的 Excalidraw 文件: ${filePath}`);
  }

  return data as ParsedProjectFile;
}

export async function writeProjectFile(
  filePath: string,
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
): Promise<void> {
  const json = serializeAsJSON(elements, appState, files, "local");
  const result = await api.writeFile(filePath, json);  // ← 改为使用 api

  if (result.error) {
    throw new Error(`保存文件失败: ${result.error}`);
  }
}
```

关键变更说明:
- 删除 `window.electronAPI` 的引用
- 导入 `{ api }` from `./api`
- 所有文件操作调用 `api.readFile` / `api.writeFile`

---

### Task 6: 更新 App.tsx 使用 api.ts

**Files:**
- Modify: `excalidraw-desktop/src/App.tsx`

- [ ] **替换所有 `window.electronAPI` 引用为 `api`**

```typescript
// src/App.tsx — 仅列出需要修改的部分
// 文件顶部新增:
import { api, isDesktop } from "./api";

// 移除旧的 const isDesktop = typeof window.electronAPI !== "undefined";

// 所有 window.electronAPI!.xxx() 替换为 api.xxx()
// 具体替换清单:

// (1) 获取最近项目
//  旧: window.electronAPI!.getRecentProjects().then(setRecentProjects)
//  新: api.getRecentProjects().then(setRecentProjects)

// (2) 选择目录
//  旧: const dir = await window.electronAPI!.selectDirectory();
//  新: const dir = await api.selectDirectory();

// (3) 列出文件
//  旧: const result = await window.electronAPI!.listFiles(dir);
//  新: const result = await api.listFiles(dir);

// (4) 创建文件
//  旧: const result = await window.electronAPI!.createFile(directory, name);
//  新: const result = await api.createFile(directory, name);

// (5) watch 目录
//  旧: const unwatch = window.electronAPI!.watchDirectory(dir, ...)
//  新: const unwatch = api.watchDirectory(dir, ...)

// (6) 添加最近项目
//  旧: window.electronAPI!.addRecentProject(...)
//  新: api.addRecentProject(...)
```

- [ ] **修改 App.tsx 顶部导入和 isDesktop 定义**

从:
```typescript
const isDesktop = typeof window.electronAPI !== "undefined";
```

改为:
```typescript
import { api, isDesktop } from "./api";
```

- [ ] **全局替换所有 `window.electronAPI!` 为 `api`**

使用批量替换 (8 处):

```
window.electronAPI!.getRecentProjects  → api.getRecentProjects
window.electronAPI!.selectDirectory()  → api.selectDirectory()
window.electronAPI!.listFiles          → api.listFiles
window.electronAPI!.createFile         → api.createFile
window.electronAPI!.watchDirectory     → api.watchDirectory
window.electronAPI!.addRecentProject   → api.addRecentProject
```

---

### Task 7: 添加 WebUI 健康检查组件

**Files:**
- Create: `excalidraw-desktop/src/components/WebUIOffline.tsx`
- Modify: `excalidraw-desktop/src/App.tsx`

WebUI 模式下，页面加载时检查后端是否存活。

- [ ] **创建 WebUIOffline 组件**

```tsx
// excalidraw-desktop/src/components/WebUIOffline.tsx
import { useState, useEffect } from "react";

interface WebUIOfflineProps {
  children: React.ReactNode;
}

export default function WebUIOffline({ children }: WebUIOfflineProps) {
  const [status, setStatus] = useState<"loading" | "online" | "offline">("loading");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);

        const res = await fetch("/api/health", {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!cancelled) {
          setStatus(res.ok ? "online" : "offline");
        }
      } catch {
        if (!cancelled) {
          setStatus("offline");
        }
      }
    }

    // 仅在非 desktop 环境下检查
    if (typeof window.electronAPI === "undefined") {
      check();
    } else {
      setStatus("online"); // GUI 模式直接通过
    }

    return () => { cancelled = true; };
  }, []);

  if (status === "loading") {
    return (
      <div style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#121212",
        color: "#888",
        fontSize: 14,
      }}>
        正在连接 Excalidraw Desktop 服务...
      </div>
    );
  }

  if (status === "offline") {
    return (
      <div style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#121212",
        color: "#ccc",
        gap: 20,
      }}>
        <h1 style={{ fontSize: 22, color: "#fff", fontWeight: 600 }}>
          Excalidraw Desktop
        </h1>
        <p style={{ fontSize: 14, color: "#888", textAlign: "center", maxWidth: 360, lineHeight: 1.5 }}>
          WebUI 需要 Excalidraw Desktop 桌面应用正在运行。
          <br />
          请先启动桌面应用，然后在浏览器中刷新此页面。
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: "#4a6cf7",
            border: "none",
            color: "#fff",
            fontSize: 14,
            padding: "10px 28px",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          重试
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
```

- [ ] **修改 src/main.tsx 包裹 WebUIOffline**

```tsx
// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import WebUIOffline from "./components/WebUIOffline";
import "./App.scss";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <WebUIOffline>
        <App />
      </WebUIOffline>
    </ErrorBoundary>
  </React.StrictMode>,
);
```

---

### Task 8: 配置 electron-builder + RPM 打包

**Files:**
- Modify: `excalidraw-desktop/package.json`

- [ ] **更新 package.json — 添加 electron-builder 配置、依赖和脚本**

```json
{
  "name": "excalidraw-desktop",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "dev:web": "vite",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "start": "electron .",
    "typecheck": "tsc --noEmit",
    "build:rpm": "yarn build && electron-builder --linux rpm",
    "build:linux": "yarn build && electron-builder --linux"
  },
  "build": {
    "appId": "com.excalidraw.desktop",
    "productName": "Excalidraw Desktop",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "package.json"
    ],
    "extraResources": [
      {
        "from": "build-assets/",
        "to": "assets/",
        "filter": ["**/*"]
      }
    ],
    "linux": {
      "target": ["rpm"],
      "category": "Graphics",
      "icon": "build-assets/icon.png",
      "executableName": "excalidraw-desktop",
      "synopsis": "Excalidraw Desktop - Virtual whiteboard",
      "description": "A virtual whiteboard for sketching hand-drawn like diagrams"
    },
    "rpm": {
      "depends": [
        "libappindicator-gtk3",
        "libXScrnSaver"
      ]
    }
  },
  "dependencies": {
    "@excalidraw/excalidraw": "*",
    "@excalidraw/common": "*",
    "@excalidraw/element": "*",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^5.0.0",
    "sass": "^1.80.0",
    "typescript": "^5.7.0",
    "vite": "^5.4.0",
    "@vitejs/plugin-react": "^4.3.0"
  }
}
```

关键变更:
- `scripts` 新增 `build:rpm` 和 `build:linux`
- 新增 `"build"` 字段 (electron-builder 配置)
- `devDependencies` 新增 `"electron-builder": "^25.0.0"`

- [ ] **安装 electron-builder**

```bash
cd /home/0668001050/workspace/excalidraw/.claude/worktrees/tray-webui-rpm
yarn add --dev electron-builder
```

---

### Task 9: 全面验证构建

- [ ] **TypeScript 类型检查**

```bash
cd /home/0668001050/workspace/excalidraw/.claude/worktrees/tray-webui-rpm/excalidraw-desktop
yarn typecheck 2>&1
```

- [ ] **electron-vite 构建**

```bash
cd /home/0668001050/workspace/excalidraw/.claude/worktrees/tray-webui-rpm/excalidraw-desktop
yarn build 2>&1
```

验证产物:
```
dist/main/index.js   ← 含 Tray + HTTP Server
dist/preload/index.js
dist/renderer/index.html
dist/renderer/assets/*.js
```

- [ ] **RPM 打包测试**

```bash
# System needs rpm-build or rpmbuild
cd /home/0668001050/workspace/excalidraw/.claude/worktrees/tray-webui-rpm/excalidraw-desktop
yarn build:rpm 2>&1
```

验证: `ls release/*.rpm`

- [ ] **功能冒烟测试**

```bash
# 直接启动 Electron 应用
cd /home/0668001050/workspace/excalidraw/.claude/worktrees/tray-webui-rpm/excalidraw-desktop
yarn start &

# 确认进程存在
sleep 5
ps aux | grep -i excalidraw | grep -v grep

# 测试 HTTP Server 是否可访问
curl -s http://127.0.0.1:19530/api/health
# 期望: {"status":"ok","version":"0.1.0"}

# 关闭应用
kill %1
```

---

## Task 依赖关系

```
Task 1 (icons) ──→ Task 3 (main.ts) ──→ Task 8 (package.json) ──→ Task 9 (verify)
                                               ↑
Task 2 (http-server.ts) ──→ Task 3 ──────────┘
                                               ↓
Task 4 (api.ts) ──→ Task 5 (ProjectFileManager.ts)
                 ──→ Task 6 (App.tsx)
                 ──→ Task 7 (WebUIOffline + main.tsx)
```

## 验证清单

- [ ] `yarn build` 编译成功，无 TS 错误
- [ ] `yarn build:rpm` 产出的 `.rpm` 文件存在
- [ ] Electron 启动后: 窗口显示 + 托盘图标出现
- [ ] 关闭窗口 → 隐藏到托盘（进程不退出）
- [ ] 左键托盘图标 → 切换窗口可见性
- [ ] 右键托盘 → 弹出菜单
- [ ] 点击"打开 WebUI" → HTTP Server 启动 + 浏览器打开
- [ ] `curl /api/health` → `{"status":"ok","version":"0.1.0"}`
- [ ] 退出菜单 → 进程完全退出
- [ ] GUI 模式下文件 CRUD 正常
- [ ] WebUI 模式下文件 CRUD 正常（通过 REST API）
- [ ] WebUI 模式选择目录 → 返回错误提示
