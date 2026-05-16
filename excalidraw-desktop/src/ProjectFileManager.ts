import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";
import { api } from "./api";

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
  const result = await api.readFile(filePath);

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
  const json = serializeAsJSON(elements, appState, files, "local");
  const result = await api.writeFile(filePath, json);

  if (result.error) {
    throw new Error(`保存文件失败: ${result.error}`);
  }
}
