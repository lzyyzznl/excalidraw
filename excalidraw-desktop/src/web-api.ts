// src/web-api.ts
// Fetch-based ElectronAPI implementation for WebUI mode (browser via HTTP server)

// Types (mirror env.d.ts for module-scoped availability)
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
  listFiles(dir: string): Promise<{ error: string } | ProjectFile[]>;
  readFile(filePath: string): Promise<{ data?: any; error?: string }>;
  writeFile(filePath: string, content: string): Promise<{ success?: boolean; error?: string }>;
  createFile(dir: string, name: string): Promise<{ path?: string; error?: string }>;
  renameFile(oldPath: string, newName: string): Promise<{ newPath?: string; error?: string }>;
  deleteFile(filePath: string): Promise<{ success?: boolean; error?: string }>;
  watchDirectory(dir: string, callback: (files: ProjectFile[]) => void): () => void;
  getRecentProjects(): Promise<RecentEntry[]>;
  addRecentProject(entry: RecentEntry): Promise<void>;
  onMenuAction(callback: (action: string) => void): () => void;
}

const API = window.location.origin;

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  return res.json();
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// 目录选择：在 web 模式下用输入框替代原生对话框
let pendingDirResolver: ((path: string | null) => void) | null = null;

export function resolveDirectory(path: string | null): void {
  if (pendingDirResolver) {
    pendingDirResolver(path);
    pendingDirResolver = null;
  }
}

export const webApi: ElectronAPI = {
  platform: "web",

  selectDirectory: (): Promise<string | null> => {
    return new Promise((resolve) => {
      pendingDirResolver = resolve;
    });
  },

  selectFile: (): Promise<string | null> => {
    return Promise.resolve(null);
  },

  listFiles: (dir: string): Promise<{ error: string } | ProjectFile[]> => {
    return apiGet(`/api/files?dir=${encodeURIComponent(dir)}`);
  },

  readFile: (filePath: string): Promise<{ data?: any; error?: string }> => {
    return apiGet(`/api/files/read?path=${encodeURIComponent(filePath)}`);
  },

  writeFile: (
    filePath: string,
    content: string,
  ): Promise<{ success?: boolean; error?: string }> => {
    return apiPost("/api/files/write", { path: filePath, content });
  },

  createFile: (
    dir: string,
    name: string,
  ): Promise<{ path?: string; error?: string }> => {
    return apiPost("/api/files/create", { dir, name });
  },

  renameFile: (
    oldPath: string,
    newName: string,
  ): Promise<{ newPath?: string; error?: string }> => {
    return apiPost("/api/files/rename", { oldPath, newName });
  },

  deleteFile: (
    filePath: string,
  ): Promise<{ success?: boolean; error?: string }> => {
    return apiPost("/api/files/delete", { filePath });
  },

  watchDirectory: (dir: string, callback: (files: ProjectFile[]) => void): (() => void) => {
    const timer = setInterval(async () => {
      try {
        const result = await apiGet<{ files: ProjectFile[] }>(
          `/api/files/poll?dir=${encodeURIComponent(dir)}&t=${Date.now()}`,
        );
        if (result && !(result as any).error) {
          callback(result.files);
        }
      } catch {
        // Silently retry on next interval
      }
    }, 2000);
    return () => clearInterval(timer);
  },

  getRecentProjects: (): Promise<RecentEntry[]> => {
    return apiGet("/api/projects/recent");
  },

  addRecentProject: (entry: RecentEntry): Promise<void> => {
    return apiPost("/api/projects/recent", entry);
  },

  onMenuAction: (_callback: (action: string) => void): (() => void) => {
    return () => {};
  },
};
