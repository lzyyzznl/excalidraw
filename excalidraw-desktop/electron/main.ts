import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } from "electron";
import { join, resolve } from "path";
import * as fs from "fs";
import { startServer, isServerRunning, getServerPort } from "./http-server";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function isPathSafe(targetPath: string): boolean {
  if (targetPath.includes("\0")) return false;
  if (targetPath.includes("..")) return false;
  return true;
}

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

// ── Tray ────────────────────────────────────────────────────────────────────

function createTray() {
  let iconPath: string;
  if (app.isPackaged) {
    iconPath = join(process.resourcesPath, "assets", "tray-icon.png");
  } else {
    iconPath = join(__dirname, "../../build-assets/tray-icon.png");
  }
  let trayIcon = nativeImage.createFromPath(iconPath);

  if (trayIcon.isEmpty()) {
    console.warn(`[Tray] Icon not found at: ${iconPath}`);
    trayIcon = nativeImage.createEmpty();
  }

  if (process.platform === "linux") {
    trayIcon = trayIcon.resize({ width: 22, height: 22 });
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

function getWindowIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "assets", "icon.png");
  }
  return join(__dirname, "../../build-assets/icon.png");
}

export function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: getWindowIconPath(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  mainWindow.webContents.on("console-message", (_event, level, message) => {
    const prefix = ["INFO", "WARN", "ERROR"][level] || "LOG";
    console.log(`[Renderer:${prefix}] ${message}`);
  });

  (mainWindow.webContents as any).on("unhandled-rejection", (_event: any) => {
    console.error("[Renderer:UNHANDLED_REJECTION]", _event);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // Window close → hide to tray
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle("select-directory", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("select-file", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("rename-file", async (_event, oldPath: string, newName: string) => {
  try {
    if (!isPathSafe(oldPath)) {
      return { error: "Invalid path" };
    }
    if (/[/\\]/.test(newName)) {
      return { error: "文件名不能包含路径分隔符" };
    }
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

ipcMain.handle("delete-file", async (_event, filePath: string) => {
  try {
    if (!isPathSafe(filePath)) {
      return { error: "Invalid path" };
    }
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
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

ipcMain.handle("add-recent-project", async (_event, entry: RecentEntry) => {
  const projects = readRecentProjects();
  const filtered = projects.filter((p) => p.path !== entry.path);
  filtered.unshift(entry);
  writeRecentProjects(filtered.slice(0, 20));
});

// ── Desktop Shortcut ──────────────────────────────────────────────────────

function ensureDesktopShortcut() {
  if (process.platform !== "linux") return;

  // Only run when packaged (RPM installed)
  if (!app.isPackaged) return;

  const sentinelFile = join(app.getPath("userData"), ".desktop-shortcut-created");

  // Already created
  if (fs.existsSync(sentinelFile)) return;

  const desktopDir = join(app.getPath("home"), "Desktop");
  const desktopFile = join(desktopDir, "excalidraw-desktop.desktop");

  // Desktop directory doesn't exist
  if (!fs.existsSync(desktopDir)) return;

  // Copy .desktop file from system location
  const srcDesktop = "/usr/share/applications/excalidraw-desktop.desktop";
  if (!fs.existsSync(srcDesktop)) return;

  try {
    const content = fs.readFileSync(srcDesktop, "utf-8");
    fs.writeFileSync(desktopFile, content, "utf-8");
    fs.chmodSync(desktopFile, 0o755);
    fs.writeFileSync(sentinelFile, new Date().toISOString(), "utf-8");
    console.log(`[Desktop] Shortcut created at ${desktopFile}`);
  } catch (err) {
    console.error("[Desktop] Failed to create shortcut:", err);
  }
}

// ── App Lifecycle ───────────────────────────────────────────────────────────

// Single instance lock — prevents multiple app instances (RPM update safety)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Set explicit WM_CLASS for Linux taskbar icon matching
if (process.platform === "linux") {
  app.commandLine.appendSwitch("class", "excalidraw-desktop");
}

app.whenReady().then(() => {
  ensureDesktopShortcut();
  createWindow();
  createTray();

  // Custom application menu
  const isMac = process.platform === "darwin";
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
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
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Window-all-closed is intentionally not handled — app stays alive in tray
