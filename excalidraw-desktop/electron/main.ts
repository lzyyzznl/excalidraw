import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } from "electron";
import { join } from "path";
import * as fs from "fs";
import { startServer, isServerRunning, getServerPort } from "./http-server";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const RECENT_PROJECTS_FILE = "recent-projects.json";

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
