import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("select-directory"),
  listFiles: (
    dir: string,
  ): Promise<
    | { error: string }
    | Array<{ name: string; path: string; modifiedAt: number }>
  > => ipcRenderer.invoke("list-files", dir),
  readFile: (
    filePath: string,
  ): Promise<{ data?: any; error?: string }> =>
    ipcRenderer.invoke("read-file", filePath),
  writeFile: (
    filePath: string,
    content: string,
  ): Promise<{ success?: boolean; error?: string }> =>
    ipcRenderer.invoke("write-file", filePath, content),
  createFile: (
    dir: string,
    name: string,
  ): Promise<{ path?: string; error?: string }> =>
    ipcRenderer.invoke("create-file", dir, name),
  watchDirectory: (
    dir: string,
    callback: (
      files: Array<{ name: string; path: string; modifiedAt: number }>,
    ) => void,
  ): (() => void) => {
    const channel = `watch:${dir}`;
    const handler = (
      _event: any,
      files: Array<{ name: string; path: string; modifiedAt: number }>,
    ) => callback(files);
    ipcRenderer.on(channel, handler);
    ipcRenderer.invoke("watch-directory", dir, channel);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  getRecentProjects: (): Promise<
    Array<{ type: string; path: string; displayName: string; lastOpened: number }>
  > => ipcRenderer.invoke("get-recent-projects"),
  addRecentProject: (project: {
    type: string;
    path: string;
    displayName: string;
    lastOpened: number;
  }): Promise<void> => ipcRenderer.invoke("add-recent-project", project),
  selectFile: (): Promise<string | null> =>
    ipcRenderer.invoke("select-file"),
  renameFile: (
    oldPath: string,
    newName: string,
  ): Promise<{ newPath?: string; error?: string }> =>
    ipcRenderer.invoke("rename-file", oldPath, newName),
  deleteFile: (
    filePath: string,
  ): Promise<{ success?: boolean; error?: string }> =>
    ipcRenderer.invoke("delete-file", filePath),
  onMenuAction: (callback: (action: string) => void): (() => void) => {
    const handler = (_event: any, action: string) => callback(action);
    ipcRenderer.on("menu-action", handler);
    return () => {
      ipcRenderer.removeListener("menu-action", handler);
    };
  },
});
