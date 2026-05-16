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

interface ElectronAPI {
  platform: string;
  selectDirectory(): Promise<string | null>;
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
  watchDirectory(
    dir: string,
    callback: (files: ProjectFile[]) => void,
  ): () => void;
  getRecentProjects(): Promise<RecentProject[]>;
  addRecentProject(project: RecentProject): Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
