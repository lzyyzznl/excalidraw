# Excalidraw Desktop 文件管理增强设计

## 概述

对 Excalidraw Desktop 应用的文件管理功能进行增强，支持打开单个文件、文件重命名/删除、文件名去后缀显示，并精简原生菜单栏。

## 改动范围

涉及文件（全部在 `excalidraw-desktop/` 目录内）：

| 文件 | 改动类型 |
|------|----------|
| `electron/main.ts` | 修改：自定义菜单栏 + 新增 IPC handler |
| `electron/preload.ts` | 修改：暴露新 API |
| `electron/http-server.ts` | 修改：新增 REST 端点 |
| `src/App.tsx` | 修改：欢迎页 + 文件操作菜单 + 去后缀 |
| `src/App.scss` | 修改：三点菜单样式 |
| `src/env.d.ts` | 修改：补充 TypeScript 类型 |

影响范围：仅限 `excalidraw-desktop`，不涉及 `excalidraw-app` 或 `packages/excalidraw`。

---

## 1. Electron IPC 层

### 1.1 自定义菜单栏

替换 `Menu.setApplicationMenu(null)` 为带两个菜单项的自定义菜单：

- **打开文件夹** — `Ctrl+O`，触发 `select-directory`
- **打开文件** — `Ctrl+Shift+O`，触发 `select-file`

移除 File/Edit/View/Window/Help 所有默认菜单，保留窗口控制按钮。

### 1.2 新增 IPC handler

| Channel | 参数 | 行为 |
|---------|------|------|
| `select-file` | 无 | `dialog.showOpenDialog` 过滤 `.excalidraw` 文件，返回 `{filePath}` |
| `rename-file` | `{oldPath, newName}` | `fs.renameSync` 重命名，返回 `{newPath}` |
| `delete-file` | `{filePath}` | `fs.unlinkSync` 删除 |

### 1.3 最近记录改造

`add-recent-project` 扩展为同时支持文件夹和文件记录，每条记录追加 `type: "folder" | "file"` 字段。

### 1.4 preload 桥接

新增 `contextBridge.exposeInMainWorld` 暴露：

```ts
electronAPI: {
  selectFile: () => Promise<{ filePath: string } | null>,
  renameFile: (oldPath: string, newName: string) => Promise<{ newPath: string }>,
  deleteFile: (filePath: string) => Promise<void>,
  // 已有方法保持不变
}
```

### 1.5 HTTP Server 同步

为 WebUI 模式在 `http-server.ts` 中增加对应 REST 端点：

- `GET /api/files/select` — 触发文件选择对话框
- `POST /api/files/rename` — `{oldPath, newName}` → 重命名
- `POST /api/files/delete` — `{filePath}` → 删除

---

## 2. 主页 UI

### 2.1 欢迎页布局

- 两按钮并排：「打开文件夹」「打开文件」
- 下方两个列表：最近文件夹 / 最近文件
  - 最近记录从 `electronAPI.getRecentProjects()` 获取，按 `type` 字段分流
  - 每个列表显示最近 10 条，按时间倒序

### 2.2 打开文件逻辑

1. 调用 `selectFile()` 弹出系统文件选择器
2. 拿到文件路径后，通过 `path.dirname(filePath)` 提取父目录
3. 调用 `selectDirectory(parentPath)` 切换到该文件夹
4. 在文件列表中高亮刚才选中的文件

### 2.3 文件名去后缀

渲染文件列表时，用 `path.basename(file, '.excalidraw')` 隐藏扩展名。内部逻辑仍然使用完整文件名，不影响任何文件操作。

---

## 3. 文件操作菜单

### 3.1 「…」按钮

- 每个文件项右侧固定区域显示 `⋮` 垂直三点图标
- hover 时可见，默认半透明

### 3.2 弹出菜单

点击 `⋮` 显示浮层，包含两个操作：

- **重命名**：文件名变为 `input` 编辑框，回车确认 → 调用 `renameFile`，ESC 取消。校验不与其他文件重名。
- **删除**：弹确认对话框 → 确定后调用 `deleteFile`。若当前编辑器打开的就是该文件，关闭编辑器回到文件列表。
- 点击菜单外部关闭浮层。

### 3.3 右键快捷菜单

文件项上右键同样弹出该菜单，作为 `⋮` 的补充。

### 3.4 样式

浮层用 `position: absolute` 定位，深色主题，z-index 高于文件列表。

---

## 4. 数据流

```
用户 → 点击「⋮」→ 选择「删除」
  → App.tsx 调用 window.electronAPI.deleteFile(filePath)
  → preload IPC → main.ts handler → fs.unlinkSync
  → 返回 void
  → App.tsx 从文件列表中移除该项
  → 若当前编辑文件 === 该文件，关闭编辑器
```

```
用户 → 点击「⋮」→ 选择「重命名」
  → App.tsx 内文件名切换为 <input>
  → 用户输入新名称，回车
  → 调用 window.electronAPI.renameFile(oldPath, newName)
  → preload IPC → main.ts handler → fs.renameSync
  → 返回 newPath
  → App.tsx 更新文件列表中对应文件名
```

```
用户 → 点击「打开文件」按钮
  → 调用 window.electronAPI.selectFile()
  → 系统文件选择器 → 返回 filePath
  → App.tsx 提取 parentDir = path.dirname(filePath)
  → 调用 selectDirectory(parentDir)
  → 加载文件夹文件列表
  → 高亮选中文件
```

---

## 5. 错误处理

| 场景 | 处理 |
|------|------|
| 重命名目标文件名已存在 | 提示 "文件名已存在"，保持编辑状态 |
| 删除文件失败（权限等） | toast 提示错误信息（复用已有 4s 自动关闭机制） |
| 打开文件时目录已被删除 | toast 提示，回到欢迎页 |

---

## 6. 测试策略

- `yarn test:typecheck` 确保 TypeScript 通过
- 手动测试：打开文件夹、打开文件、重命名、删除、菜单栏功能
- 无需新增自动化测试（IPC handler 测试需 mock Electron API）
