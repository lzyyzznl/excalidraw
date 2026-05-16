import { useCallback, useEffect, useRef, useState } from "react";
import ExcalidrawEditor from "./ExcalidrawEditor";

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

const isDesktop = typeof window.electronAPI !== "undefined";

function formatTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return d.toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}

export default function App() {
  const [directory, setDirectory] = useState<string | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [contextMenu, setContextMenu] = useState<{
    filePath: string;
    x: number;
    y: number;
  } | null>(null);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const unwatchRef = useRef<(() => void) | null>(null);

  // Load recent projects on mount
  useEffect(() => {
    if (isDesktop) {
      window.electronAPI!.getRecentProjects().then(setRecentProjects);
    } else {
      try {
        const saved = localStorage.getItem("excalidraw-desktop-recent");
        if (saved) setRecentProjects(JSON.parse(saved));
      } catch {}
    }
  }, []);

  // Open directory
  const openDirectory = useCallback(async () => {
    if (!isDesktop) return;
    const dir = await window.electronAPI!.selectDirectory();
    if (!dir) return;

    setDirectory(dir);
    setActiveFile(null);
    setError(null);

    // Stop previous watcher
    if (unwatchRef.current) {
      unwatchRef.current();
      unwatchRef.current = null;
    }

    // List files
    const result = await window.electronAPI!.listFiles(dir);
    if ("error" in result) {
      setError(result.error);
      setFiles([]);
      return;
    }
    setFiles(result as ProjectFile[]);

    // Start watching
    const unwatch = window.electronAPI!.watchDirectory(dir, (updatedFiles) => {
      setFiles(updatedFiles);
    });
    unwatchRef.current = unwatch;

    // Add to recent
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
  }, []);

  // Open file
  const openFile = useCallback(async () => {
    if (!isDesktop) return;
    const filePath = await window.electronAPI!.selectFile();
    if (!filePath) return;

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

  // Open recent project
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

  // Create new file
  const createFile = useCallback(async () => {
    if (!isDesktop || !directory) return;

    let counter = 1;
    let name = `untitled-${counter}.excalidraw`;
    const existingNames = new Set(files.map((f) => f.name));
    while (existingNames.has(name)) {
      counter++;
      name = `untitled-${counter}.excalidraw`;
    }

    const result = await window.electronAPI!.createFile(directory, name);
    if (result.error) {
      setError(result.error);
      return;
    }

    // File will appear in sidebar via watcher
    if (result.path) {
      setActiveFile(result.path);
    }
  }, [directory, files]);

  // Switch file — flush save before loading new file
  const switchFile = useCallback((filePath: string) => {
    // Flush current save
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

  const openContextMenu = useCallback(
    (e: React.MouseEvent, filePath: string) => {
      e.stopPropagation();
      setContextMenu({ filePath, x: e.clientX, y: e.clientY });
    },
    [],
  );

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

  // Handle Ctrl+N, Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        createFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        const flush = (window as any).__excalidrawFlushSave;
        if (typeof flush === "function") flush();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [createFile]);

  // Cleanup watcher on unmount
  useEffect(() => {
    return () => {
      if (unwatchRef.current) {
        unwatchRef.current();
      }
    };
  }, []);

  // Dismiss error after 4s
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  // ── Sidebar resize ────────────────────────────────────────────────────
  const resizing = useRef(false);

  const handleMouseDown = useCallback(() => {
    resizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      setSidebarWidth(Math.max(180, Math.min(400, e.clientX)));
    };

    const handleMouseUp = () => {
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────

  // No directory open — show welcome screen
  if (!directory) {
    return (
      <div className="app-container">
        <div className="welcome-screen" style={{ flex: 1 }}>
          <h1>Excalidraw Desktop</h1>
          <p>打开一个包含 .excalidraw 文件的文件夹，或直接打开文件开始编辑。</p>
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
        </div>
        {error && <div className="error-toast">{error}</div>}
      </div>
    );
  }

  // Directory open — show sidebar + editor
  return (
    <div className="app-container">
      <div className="sidebar" style={{ width: sidebarWidth }}>
        <div className="sidebar-header">
          <h2 title={directory}>
            {directory.split("/").pop() || directory}
          </h2>
          <div className="sidebar-header-actions">
            <button className="sidebar-btn" onClick={createFile} title="新建文件 (Ctrl+N)">
              + 新建
            </button>
            <button className="sidebar-btn" onClick={openDirectory} title="打开其他文件夹">
              打开
            </button>
          </div>
        </div>
        <div className="sidebar-content">
          {files.length === 0 ? (
            <div className="sidebar-empty">
              此目录中没有 .excalidraw 文件
              <br />
              <button className="sidebar-btn" onClick={createFile}>
                创建第一个文件
              </button>
            </div>
          ) : (
            files.map((file) => (
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
            ))
          )}
        </div>
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
      </div>

      <div
        className="sidebar-resize-handle"
        onMouseDown={handleMouseDown}
      />

      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {activeFile ? (
          <ExcalidrawEditor
            key={activeFile}
            filePath={activeFile}
            onError={setError}
            onFileSaved={() => {
              // Update modified time in sidebar by re-triggering
              setFiles((prev) =>
                prev.map((f) =>
                  f.path === activeFile ? { ...f, modifiedAt: Date.now() } : f,
                ),
              );
            }}
          />
        ) : (
          <div
            style={{
              flex: 1,
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#666",
              fontSize: 14,
              background: "#121212",
            }}
          >
            选择一个文件开始编辑
          </div>
        )}
      </div>

      {error && <div className="error-toast">{error}</div>}
    </div>
  );
}
