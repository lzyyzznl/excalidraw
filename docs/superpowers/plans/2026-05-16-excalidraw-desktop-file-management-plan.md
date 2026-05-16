# Excalidraw Desktop 文件管理增强 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强 Excalidraw Desktop 的文件管理能力：自定义菜单栏、打开文件、重命名/删除、去后缀显示、最近记录分流

**Architecture:** 在现有 Electron IPC 基础上增量添加 3 个 handler（select-file/rename-file/delete-file），扩展最近记录数据结构，Render 层改造欢迎页和文件列表项 UI。不改变现有架构，不改动 `excalidraw-app/` 或 `packages/excalidraw/`。

**Tech Stack:** Electron, TypeScript, React, SCSS

---

### Task 1: Electron IPC — 自定义菜单栏 + 新增 handler + 最近记录改造

**Files:**
- Modify: `excalidraw-desktop/electron/main.ts`

- [ ] **Step 1: 添加 Menu 导入并替换菜单栏**

在 `main.ts` 开头导入 `Menu`：
```ts
import { app, BrowserWindow, ipcMain, dialog, Menu } from "electron";
```

将 `app.whenReady().then(() => { createWindow(); ... })` 替换为：

```ts
app.whenReady().then(() => {
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        {
          label: "打开文件夹",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            mainWindow?.webContents.send("menu-action", "select-directory");
          },
        },
        {
          label: "打开文件",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => {
            mainWindow?.webContents.send("menu-action", "select-file");
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
```

- [ ] **Step 2: 新增 `select-file` IPC handler**

在 `select-directory` handler 之后添加：

```ts
ipcMain.handle("select-file", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
  });
  return result.canceled ? null : result.filePaths[0];
});
```

- [ ] **Step 3: 新增 `rename-file` IPC handler**

```ts
ipcMain.handle("rename-file", async (_event, oldPath: string, newName: string) => {
  try {
    const dir = join(oldPath, "..");
    const newPath = join(dir, newName);
    if (fs.existsSync(newPath)) {
      return { error: "文件名已存在" };
    }
    fs.renameSync(oldPath, newPath);
    return { newPath };
  } catch (err: any) {
    return { error: err.message };
  }
});
```

- [ ] **Step 4: 新增 `delete-file` IPC handler**

```ts
ipcMain.handle("delete-file", async (_event, filePath: string) => {
  try {
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
});
```

- [ ] **Step 5: 扩展最近记录数据结构**

修改 `readRecentProjects` / `writeRecentProjects` 及相关类型：

```ts
const RECENT_PROJECTS_FILE = "recent-projects.json";

function getRecentProjectsPath(): string {
  return join(app.getPath("userData"), RECENT_PROJECTS_FILE);
}

interface RecentEntry {
  type: "folder" | "file";
  path: string;
  displayName: string;
  lastOpened: number;
}

function readRecentProjects(): RecentEntry[] {
  try {
    const filePath = getRecentProjectsPath();
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

function writeRecentProjects(projects: RecentEntry[]) {
  fs.writeFileSync(getRecentProjectsPath(), JSON.stringify(projects, null, 2));
}
```

- [ ] **Step 6: 更新 `get-recent-projects` 和 `add-recent-project` handler**

```ts
ipcMain.handle("get-recent-projects", async () => {
  return readRecentProjects();
});

ipcMain.handle("add-recent-project", async (_event, entry: RecentEntry) => {
  const projects = readRecentProjects();
  const filtered = projects.filter((p) => p.path !== entry.path);
  filtered.unshift(entry);
  writeRecentProjects(filtered.slice(0, 20));
});
```

- [ ] **Step 7: 提交 Task 1**

```bash
git add excalidraw-desktop/electron/main.ts
git commit -m "feat(desktop): custom menu bar with open folder/file + rename/delete IPC handlers + recent entries with type"
```

---

### Task 2: Preload 桥接 — 暴露新 API

**Files:**
- Modify: `excalidraw-desktop/electron/preload.ts`

- [ ] **Step 1: 添加新方法到 contextBridge**

在 `electronAPI` 对象中添加：

```ts
contextBridge.exposeInMainWorld("electronAPI", {
  // ... existing methods ...

  selectFile: (): Promise<string | null> =>
    ipcRenderer.invoke("select-file"),
  renameFile: (
    oldPath: string,
    newName: string,
  ): Promise<{ newPath?: string; error?: string }> =>
    ipcRenderer.invoke("rename-file", oldPath, newName),
  deleteFile: (
    filePath: string,
  ): Promise<{ success?: boolean; error?: string }> =>
    ipcRenderer.invoke("delete-file", filePath),
  onMenuAction: (callback: (action: string) => void): (() => void) => {
    const handler = (_event: any, action: string) => callback(action);
    ipcRenderer.on("menu-action", handler);
    return () => {
      ipcRenderer.removeListener("menu-action", handler);
    };
  },
  // 更新已有的 getRecentProjects / addRecentProject 返回类型
  getRecentProjects: (): Promise<
    Array<{ type: string; path: string; displayName: string; lastOpened: number }>
  > => ipcRenderer.invoke("get-recent-projects"),
  addRecentProject: (entry: {
    type: string;
    path: string;
    displayName: string;
    lastOpened: number;
  }): Promise<void> => ipcRenderer.invoke("add-recent-project", entry),
});
```

- [ ] **Step 2: 提交 Task 2**

```bash
git add excalidraw-desktop/electron/preload.ts
git commit -m "feat(desktop): expose selectFile/renameFile/deleteFile/onMenuAction via preload"
```

---

### Task 3: 类型定义更新

**Files:**
- Modify: `excalidraw-desktop/src/env.d.ts`

- [ ] **Step 1: 更新类型定义**

将 `RecentProject` 接口替换为 `RecentEntry`，添加新方法签名：

```ts
interface ProjectFile {
  name: string;
  path: string;
  modifiedAt: number;
}

interface RecentEntry {
  type: "folder" | "file";
  path: string;
  displayName: string;
  lastOpened: number;
}

interface ElectronAPI {
  platform: string;
  selectDirectory(): Promise<string | null>;
  selectFile(): Promise<string | null>;
  listFiles(
    dir: string,
  ): Promise<
    | { error: string }
    | ProjectFile[]
  >;
  readFile(filePath: string): Promise<{ data?: any; error?: string }>;
  writeFile(
    filePath: string,
    content: string,
  ): Promise<{ success?: boolean; error?: string }>;
  createFile(
    dir: string,
    name: string,
  ): Promise<{ path?: string; error?: string }>;
  renameFile(
    oldPath: string,
    newName: string,
  ): Promise<{ newPath?: string; error?: string }>;
  deleteFile(
    filePath: string,
  ): Promise<{ success?: boolean; error?: string }>;
  watchDirectory(
    dir: string,
    callback: (files: ProjectFile[]) => void,
  ): () => void;
  getRecentProjects(): Promise<RecentEntry[]>;
  addRecentProject(entry: RecentEntry): Promise<void>;
  onMenuAction(callback: (action: string) => void): () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
```

- [ ] **Step 2: 提交 Task 3**

```bash
git add excalidraw-desktop/src/env.d.ts
git commit -m "feat(desktop): update TypeScript types for new file management APIs"
```

---

### Task 4: HTTP Server 同步

**Files:**
- Modify: `excalidraw-desktop/electron/http-server.ts`

- [ ] **Step 1: 添加 `rename-file` 和 `delete-file` REST 端点**

在 `POST /api/files/create` 路由之后添加：

```ts
  // POST /api/files/rename
  if (pathname === "/api/files/rename" && req.method === "POST") {
    try {
      const body = await readBody();
      if (!body.oldPath || !body.newName) return sendError(400, "Missing 'oldPath' or 'newName'");
      const dir = path.dirname(body.oldPath);
      const newPath = path.join(dir, body.newName);
      if (fs.existsSync(newPath)) return sendError(409, "文件名已存在");
      if (!isPathSafe(body.oldPath) || !isPathSafe(newPath)) return sendError(400, "Invalid path");
      fs.renameSync(body.oldPath, newPath);
      sendJson(200, { newPath });
    } catch (err: any) { sendError(500, err.message); }
    return;
  }

  // POST /api/files/delete
  if (pathname === "/api/files/delete" && req.method === "POST") {
    try {
      const body = await readBody();
      if (!body.filePath) return sendError(400, "Missing 'filePath'");
      if (!isPathSafe(body.filePath)) return sendError(400, "Invalid path");
      fs.unlinkSync(body.filePath);
      sendJson(200, { success: true });
    } catch (err: any) { sendError(500, err.message); }
    return;
  }
```

- [ ] **Step 2: 添加文件选择端点说明**

在 `POST /api/directory/select` 路由附近添加：

```ts
  // GET /api/files/select — not available in WebUI
  if (pathname === "/api/files/select") {
    sendError(400, "WebUI does not support file selection. Please use the desktop application.");
    return;
  }
```

- [ ] **Step 3: 提交 Task 4**

```bash
git add excalidraw-desktop/electron/http-server.ts
git commit -m "feat(desktop): add rename/delete REST endpoints for WebUI mode"
```

---

### Task 5: 主页欢迎页改造 — 打开文件按钮 + 最近记录双列表

**Files:**
- Modify: `excalidraw-desktop/src/App.tsx`

- [ ] **Step 1: 替换接口定义**

将 `RecentProject` 替换为 `RecentEntry`：

```tsx
interface ProjectFile {
  name: string;
  path: string;
  modifiedAt: number;
}

interface RecentEntry {
  type: "folder" | "file";
  path: string;
  displayName: string;
  lastOpened: number;
}
```

将 `recentProjects` 状态类型改为 `RecentEntry[]`：

```tsx
const [recentProjects, setRecentProjects] = useState<RecentEntry[]>([]);
```

- [ ] **Step 2: 添加 `openFile` 函数**

在 `openDirectory` 之前或之后添加：

```tsx
const openFile = useCallback(async () => {
  if (!isDesktop) return;
  const filePath = await window.electronAPI!.selectFile();
  if (!filePath) return;

  // 提取文件所在目录
  const dir = filePath.split("/").slice(0, -1).join("/");

  setDirectory(dir);
  setActiveFile(filePath);
  setError(null);

  if (unwatchRef.current) {
    unwatchRef.current();
    unwatchRef.current = null;
  }

  const result = await window.electronAPI!.listFiles(dir);
  if ("error" in result) {
    setError(result.error);
    setFiles([]);
    return;
  }
  setFiles(result as ProjectFile[]);

  const unwatch = window.electronAPI!.watchDirectory(dir, (updatedFiles) => {
    setFiles(updatedFiles);
  });
  unwatchRef.current = unwatch;

  const folderName = dir.split("/").pop() || dir;
  const fileName = filePath.split("/").pop() || filePath;
  const displayName = fileName.replace(/\.excalidraw$/i, "");
  const now = Date.now();

  // Add folder and file entries
  window.electronAPI!.addRecentProject({
    type: "folder", path: dir, displayName: folderName, lastOpened: now,
  });
  window.electronAPI!.addRecentProject({
    type: "file", path: filePath, displayName, lastOpened: now,
  });

  setRecentProjects((prev) => {
    const filtered = prev.filter((p) => p.path !== dir && p.path !== filePath);
    return [
      { type: "folder", path: dir, displayName: folderName, lastOpened: now },
      { type: "file", path: filePath, displayName, lastOpened: now },
      ...filtered,
    ].slice(0, 20);
  });
}, []);
```

- [ ] **Step 3: 更新 `openDirectory` 使用新数据格式**

修改 `openDirectory` 中构造 `recent` 对象的代码：

```tsx
  const folderName = dir.split("/").pop() || dir;
  const entry: RecentEntry = {
    type: "folder",
    path: dir,
    displayName: folderName,
    lastOpened: Date.now(),
  };
  window.electronAPI!.addRecentProject(entry);

  setRecentProjects((prev) => {
    const filtered = prev.filter((p) => p.path !== dir);
    return [entry, ...filtered].slice(0, 20);
  });
```

- [ ] **Step 4: 更新 `openRecent` 函数**

将参数类型从 `RecentProject` 改为 `RecentEntry`，并根据 type 分流：

```tsx
const openRecent = useCallback(async (entry: RecentEntry) => {
  if (!isDesktop) return;

  const targetPath = entry.type === "folder" ? entry.path : entry.path.split("/").slice(0, -1).join("/");

  setDirectory(targetPath);
  setActiveFile(entry.type === "file" ? entry.path : null);
  setError(null);

  if (unwatchRef.current) {
    unwatchRef.current();
    unwatchRef.current = null;
  }

  const result = await window.electronAPI!.listFiles(targetPath);
  if ("error" in result) {
    setError(result.error);
    setFiles([]);
    return;
  }
  setFiles(result as ProjectFile[]);

  const unwatch = window.electronAPI!.watchDirectory(
    targetPath,
    (updatedFiles) => setFiles(updatedFiles),
  );
  unwatchRef.current = unwatch;

  const updated: RecentEntry = {
    ...entry,
    lastOpened: Date.now(),
  };
  window.electronAPI!.addRecentProject(updated);
}, []);
```

- [ ] **Step 5: 更新 `switchFile` 函数**

```tsx
const switchFile = useCallback((filePath: string) => {
  const flush = (window as any).__excalidrawFlushSave;
  if (typeof flush === "function") {
    flush();
  }

  setActiveFile(filePath);
  setError(null);

  if (isDesktop && directory) {
    const fileName = filePath.split("/").pop() || filePath;
    window.electronAPI!.addRecentProject({
      type: "file",
      path: filePath,
      displayName: fileName.replace(/\.excalidraw$/i, ""),
      lastOpened: Date.now(),
    });
  }
}, [directory]);
```

- [ ] **Step 6: 添加菜单栏事件监听**

在已有的 `useEffect` 中（或新加一个）：

```tsx
// 监听菜单栏操作
useEffect(() => {
  if (!isDesktop) return;
  const unlisten = window.electronAPI!.onMenuAction((action: string) => {
    if (action === "select-directory") {
      openDirectory();
    } else if (action === "select-file") {
      openFile();
    }
  });
  return () => unlisten();
}, [openDirectory, openFile]);
```

注意：`openFile` 需要在 `useEffect` 之前定义，调整函数声明顺序。

- [ ] **Step 7: 改造欢迎页模板 — 两个按钮 + 最近列表**

替换 welcome-screen 中的按钮和最近列表部分：

```tsx
{isDesktop ? (
  <>
    <div className="welcome-buttons">
      <button className="welcome-btn" onClick={openDirectory}>
        打开文件夹
      </button>
      <button className="welcome-btn" onClick={openFile}>
        打开文件
      </button>
    </div>
    {recentProjects.length > 0 && (
      <div className="recent-projects">
        <h3>最近打开</h3>
        {recentProjects.map((entry) => (
          <div
            className="recent-item"
            key={entry.path}
            onClick={() => openRecent(entry)}
          >
            <span className="recent-icon">
              {entry.type === "folder" ? "\u{1F4C1}" : "\u{1F4DD}"}
            </span>
            <span className="recent-dir">{entry.displayName}</span>
            <span className="recent-type-badge">
              {entry.type === "folder" ? "文件夹" : "文件"}
            </span>
            <span className="recent-time">
              {formatTime(entry.lastOpened)}
            </span>
          </div>
        ))}
      </div>
    )}
  </>
) : (
  <p>WebUI 模式：请使用 Electron 桌面版打开文件夹管理功能。</p>
)}
```

- [ ] **Step 8: 提交 Task 5**

```bash
git add excalidraw-desktop/src/App.tsx
git commit -m "feat(desktop): welcome screen with open file button + dual recent lists"
```

---

### Task 6: 文件列表 — 「…」菜单 + 重命名/删除 + 去后缀

**Files:**
- Modify: `excalidraw-desktop/src/App.tsx`

- [ ] **Step 1: 添加状态变量**

在组件顶部添加：

```tsx
const [contextMenu, setContextMenu] = useState<{
  filePath: string;
  x: number;
  y: number;
} | null>(null);
const [renamingFile, setRenamingFile] = useState<string | null>(null);
const [renameValue, setRenameValue] = useState("");
```

- [ ] **Step 2: 添加「…」按钮点击处理**

```tsx
const openContextMenu = useCallback(
  (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation();
    setContextMenu({ filePath, x: e.clientX, y: e.clientY });
  },
  [],
);
```

- [ ] **Step 3: 添加重命名处理**

```tsx
const startRename = useCallback((filePath: string, currentName: string) => {
  setRenamingFile(filePath);
  setRenameValue(currentName.replace(/\.excalidraw$/i, ""));
  setContextMenu(null);
}, []);

const confirmRename = useCallback(async () => {
  if (!renamingFile || !renameValue.trim()) {
    setRenamingFile(null);
    return;
  }
  const newName = renameValue.trim() + ".excalidraw";
  const result = await window.electronAPI!.renameFile(renamingFile, newName);
  if (result.error) {
    setError(result.error);
    return;
  }
  setRenamingFile(null);
  if (result.newPath) {
    setFiles((prev) =>
      prev.map((f) =>
        f.path === renamingFile
          ? { ...f, name: newName, path: result.newPath! }
          : f,
      ),
    );
    setActiveFile((prev) => (prev === renamingFile ? result.newPath! : prev));
  }
}, [renamingFile, renameValue]);
```

- [ ] **Step 4: 添加删除处理**

```tsx
const confirmDelete = useCallback(async () => {
  if (!contextMenu) return;
  const filePath = contextMenu.filePath;
  setContextMenu(null);

  const confirmed = window.confirm("确定要删除这个文件吗？此操作不可撤销。");
  if (!confirmed) return;

  const result = await window.electronAPI!.deleteFile(filePath);
  if (result.error) {
    setError(result.error);
    return;
  }
  setFiles((prev) => prev.filter((f) => f.path !== filePath));
  setActiveFile((prev) => (prev === filePath ? null : prev));
}, [contextMenu]);
```

- [ ] **Step 5: 添加点击外部关闭菜单**

```tsx
useEffect(() => {
  const handler = () => setContextMenu(null);
  window.addEventListener("click", handler);
  return () => window.removeEventListener("click", handler);
}, []);
```

- [ ] **Step 6: 改造文件列表渲染**

替换 `files.map` 中的 JSX：

```tsx
{files.map((file) => (
  <div
    className={`file-item ${activeFile === file.path ? "active" : ""} ${renamingFile === file.path ? "renaming" : ""}`}
    key={file.path}
    onClick={() => {
      if (renamingFile !== file.path) {
        switchFile(file.path);
      }
    }}
    onContextMenu={(e) => {
      e.preventDefault();
      openContextMenu(e, file.path);
    }}
  >
    <span className="file-icon">&#x1F4DD;</span>
    {renamingFile === file.path ? (
      <input
        className="file-rename-input"
        value={renameValue}
        onChange={(e) => setRenameValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") confirmRename();
          if (e.key === "Escape") setRenamingFile(null);
        }}
        onClick={(e) => e.stopPropagation()}
        autoFocus
      />
    ) : (
      <span className="file-name">
        {file.name.replace(/\.excalidraw$/i, "")}
      </span>
    )}
    <span className="file-time">{formatTime(file.modifiedAt)}</span>
    <span
      className="file-menu-trigger"
      onClick={(e) => openContextMenu(e, file.path)}
      title="更多操作"
    >
      &#8942;
    </span>
  </div>
))}
```

- [ ] **Step 7: 添加弹出菜单**

在 `</div>`（sidebar-content 关闭标签）之前添加：

```tsx
{contextMenu && (
  <div
    className="context-menu"
    style={{
      position: "fixed",
      left: contextMenu.x,
      top: contextMenu.y,
    }}
    onClick={(e) => e.stopPropagation()}
  >
    <div
      className="context-menu-item"
      onClick={() => {
        const file = files.find((f) => f.path === contextMenu.filePath);
        if (file) startRename(file.path, file.name);
      }}
    >
      重命名
    </div>
    <div className="context-menu-item danger" onClick={confirmDelete}>
      删除
    </div>
  </div>
)}
```

- [ ] **Step 8: 提交 Task 6**

```bash
git add excalidraw-desktop/src/App.tsx
git commit -m "feat(desktop): file list with hidden extensions + context menu for rename/delete"
```

---

### Task 7: 「…」菜单样式

**Files:**
- Modify: `excalidraw-desktop/src/App.scss`

- [ ] **Step 1: 添加「…」按钮样式**

```scss
.file-menu-trigger {
  display: none;
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  cursor: pointer;
  color: #888;
  font-size: 16px;
  padding: 2px 6px;
  border-radius: 4px;
  user-select: none;

  &:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }
}

.file-item {
  position: relative;
  padding-right: 30px;

  &:hover .file-menu-trigger {
    display: block;
  }
}
```

- [ ] **Step 2: 添加弹出菜单样式**

```scss
.context-menu {
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 6px;
  padding: 4px 0;
  min-width: 120px;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);

  .context-menu-item {
    padding: 8px 16px;
    cursor: pointer;
    color: #ddd;
    font-size: 13px;
    user-select: none;

    &:hover {
      background: #3a3a3a;
      color: #fff;
    }

    &.danger {
      color: #e74c3c;

      &:hover {
        background: rgba(231, 76, 60, 0.15);
      }
    }
  }
}
```

- [ ] **Step 3: 添加重命名输入框样式**

```scss
.file-rename-input {
  flex: 1;
  background: #3a3a3a;
  border: 1px solid #5a9cf5;
  border-radius: 4px;
  color: #fff;
  font-size: 13px;
  padding: 2px 6px;
  outline: none;
  min-width: 0;
}
```

- [ ] **Step 4: 添加欢迎页按钮组样式**

```scss
.welcome-buttons {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 16px;
}
```

- [ ] **Step 5: 添加最近文件类型标记样式**

```scss
.recent-type-badge {
  font-size: 11px;
  color: #888;
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 6px;
  border-radius: 3px;
  margin-left: 8px;
}

.recent-icon {
  margin-right: 8px;
  font-size: 14px;
}
```

- [ ] **Step 6: 提交 Task 7**

```bash
git add excalidraw-desktop/src/App.scss
git commit -m "style(desktop): context menu, file menu trigger, rename input, welcome buttons"
```

---

### Task 8: 类型检查验证

- [ ] **Step 1: 运行 TypeScript 类型检查**

```bash
yarn test:typecheck
```

预期：编译通过，无类型错误。

- [ ] **Step 2: 修复类型错误（如有）**

常见问题：
- `RecentProject` → `RecentEntry` 在 App.tsx 中有遗漏
- `electronAPI` 的 `getRecentProjects` 返回类型不匹配
- 变量顺序导致 `useEffect` 引用了未定义函数

修复后重新运行 `yarn test:typecheck`。

- [ ] **Step 3: 提交修复（如有）**

```bash
git add -A
git commit -m "fix(desktop): typecheck fixes for file management changes"
```
