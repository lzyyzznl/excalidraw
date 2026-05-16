import { app, BrowserWindow, ipcMain, dialog, Menu } from "electron";
import { join } from "path";
import * as fs from "fs";

let mainWindow: BrowserWindow | null = null;

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

  // Capture renderer console messages for debugging
  mainWindow.webContents.on("console-message", (_event, level, message) => {
    const prefix = ["INFO", "WARN", "ERROR"][level] || "LOG";
    console.log(`[Renderer:${prefix}] ${message}`);
  });

  // Capture renderer unhandled errors
  mainWindow.webContents.on(
    "unhandled-rejection",
    (event: Electron.Event) => {
      console.error("[Renderer:UNHANDLED_REJECTION]", event);
    },
  );

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

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
    // Validate JSON before writing
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
        // Re-list files and send to renderer
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
