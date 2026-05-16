import { useCallback, useEffect, useRef, useState } from "react";
import ExcalidrawEditor from "./ExcalidrawEditor";

interface ProjectFile {
  name: string;
  path: string;
  modifiedAt: number;
}

interface RecentProject {
  directory: string;
  lastFile: string | null;
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
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
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
    const recent: RecentProject = {
      directory: dir,
      lastFile: null,
      lastOpened: Date.now(),
    };
    window.electronAPI!.addRecentProject(recent);

    // Update recent projects list
    setRecentProjects((prev) => {
      const filtered = prev.filter((p) => p.directory !== dir);
      return [recent, ...filtered].slice(0, 20);
    });
  }, []);

  // Open recent project
  const openRecent = useCallback(async (recent: RecentProject) => {
    if (!isDesktop) return;
    setDirectory(recent.directory);
    setActiveFile(recent.lastFile || null);
    setError(null);

    if (unwatchRef.current) {
      unwatchRef.current();
      unwatchRef.current = null;
    }

    const result = await window.electronAPI!.listFiles(recent.directory);
    if ("error" in result) {
      setError(result.error);
      setFiles([]);
      return;
    }
    setFiles(result as ProjectFile[]);

    const unwatch = window.electronAPI!.watchDirectory(
      recent.directory,
      (updatedFiles) => {
        setFiles(updatedFiles);
      },
    );
    unwatchRef.current = unwatch;

    const updated: RecentProject = {
      ...recent,
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

    // Update recent project's lastFile
    if (isDesktop && directory) {
      window.electronAPI!.addRecentProject({
        directory,
        lastFile: filePath,
        lastOpened: Date.now(),
      });
    }
  }, [directory]);

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
          <p>打开一个包含 .excalidraw 文件的文件夹，开始编辑你的白板。</p>
          {isDesktop ? (
            <>
              <button className="welcome-btn" onClick={openDirectory}>
                打开文件夹
              </button>
              {recentProjects.length > 0 && (
                <div className="recent-projects">
                  <h3>最近打开</h3>
                  {recentProjects.map((p) => (
                    <div
                      className="recent-item"
                      key={p.directory}
                      onClick={() => openRecent(p)}
                    >
                      <span className="recent-dir">
                        {p.directory.split("/").pop() || p.directory}
                      </span>
                      <span className="recent-time">
                        {formatTime(p.lastOpened)}
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
                className={`file-item ${activeFile === file.path ? "active" : ""}`}
                key={file.path}
                onClick={() => switchFile(file.path)}
              >
                <span className="file-icon">&#x1F4DD;</span>
                <span className="file-name">{file.name}</span>
                <span className="file-time">{formatTime(file.modifiedAt)}</span>
              </div>
            ))
          )}
        </div>
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
