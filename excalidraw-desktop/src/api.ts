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
  listFiles(dir: string): Promise<ProjectFile[] | { error: string }>;
  readFile(filePath: string): Promise<{ data?: any; error?: string }>;
  writeFile(filePath: string, content: string): Promise<{ success?: boolean; error?: string }>;
  createFile(dir: string, name: string): Promise<{ path?: string; error?: string }>;
  watchDirectory(dir: string, callback: (files: ProjectFile[]) => void): () => void;
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
  const BASE = "";

  async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${url}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
    return res.json() as Promise<T>;
  }

  const watchers = new Map<string, ReturnType<typeof setInterval>>();

  return {
    platform: "web",
    selectDirectory: async () => null,
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
      return apiFetch<{ success?: boolean; error?: string }>("/api/files/write", {
        method: "POST",
        body: JSON.stringify({ path: filePath, content }),
      });
    },
    createFile: async (dir, name) => {
      return apiFetch<{ path?: string; error?: string }>("/api/files/create", {
        method: "POST",
        body: JSON.stringify({ dir, name }),
      });
    },
    watchDirectory: (dir, callback) => {
      const interval = setInterval(async () => {
        const result = await apiFetch<{ files?: ProjectFile[]; error?: string }>(
          `/api/files?dir=${encodeURIComponent(dir)}`,
        );
        if (result.files) callback(result.files);
      }, 3000);
      watchers.set(dir, interval);
      return () => {
        const i = watchers.get(dir);
        if (i) { clearInterval(i); watchers.delete(dir); }
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
