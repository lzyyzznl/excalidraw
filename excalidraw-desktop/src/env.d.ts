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
