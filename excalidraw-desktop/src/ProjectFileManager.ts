import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";

export interface ParsedProjectFile {
  type: string;
  version: number;
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files?: BinaryFiles;
}

/**
 * Read a .excalidraw file from disk via IPC.
 */
export async function readProjectFile(
  filePath: string,
): Promise<ParsedProjectFile> {
  if (!window.electronAPI) {
    throw new Error("File system not available in browser mode");
  }

  const result = await window.electronAPI.readFile(filePath);

  if (result.error === "corrupted") {
    throw new Error(`文件已损坏，无法读取: ${filePath}`);
  }

  if (result.error) {
    throw new Error(`读取文件失败: ${result.error}`);
  }

  const data = result.data;
  if (!data || data.type !== "excalidraw") {
    throw new Error(`无效的 Excalidraw 文件: ${filePath}`);
  }

  return data as ParsedProjectFile;
}

/**
 * Write elements/appState/files to a .excalidraw file via IPC.
 */
export async function writeProjectFile(
  filePath: string,
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
): Promise<void> {
  if (!window.electronAPI) {
    throw new Error("File system not available in browser mode");
  }

  const json = serializeAsJSON(elements, appState, files, "local");
  const result = await window.electronAPI.writeFile(filePath, json);

  if (result.error) {
    throw new Error(`保存文件失败: ${result.error}`);
  }
}
