import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import {
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { debounce } from "@excalidraw/common";
// @ts-expect-error debounce type helper
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";

import type {
  ExcalidrawImperativeAPI,
  AppState,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { readProjectFile, writeProjectFile } from "./ProjectFileManager";

const AUTO_SAVE_MS = 500;

interface ExcalidrawEditorProps {
  filePath: string;
  onError: (message: string) => void;
  onFileSaved: () => void;
}

export default function ExcalidrawEditor({
  filePath,
  onError,
  onFileSaved,
}: ExcalidrawEditorProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialData, setInitialData] = useState<{
    elements: readonly ExcalidrawElement[];
    appState: AppState | null;
  } | null>(null);

  // Expose the current save function so App can trigger flush
  const saveRef = useRef<{ flush: () => void }>({ flush: () => {} });

  // Load file when filePath changes
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const parsed = await readProjectFile(filePath);

        const elements = restoreElements(parsed.elements, null, {
          repairBindings: true,
          deleteInvisibleElements: true,
        });

        const appState = {
          ...getDefaultAppState(),
          ...restoreAppState({ ...parsed.appState }, null),
        };

        if (!cancelled) {
          setInitialData({ elements, appState });
        }
      } catch (err: any) {
        if (!cancelled) {
          onError(err.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [filePath, onError]);

  // Debounced auto-save
  const debouncedSave = useRef<ReturnType<typeof debounce<any>>>();


  const onChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      const save = debouncedSave.current;
      if (save) {
        save(elements, appState, files);
      }
    },
    [],
  );

  // Setup save function when filePath changes
  useEffect(() => {
    const saveFn = debounce(
      async (
        elements: readonly ExcalidrawElement[],
        appState: AppState,
        files: BinaryFiles,
      ) => {
        try {
          await writeProjectFile(filePath, elements, appState, files);
          onFileSaved();
        } catch (err: any) {
          onError(err.message);
        }
      },
      AUTO_SAVE_MS,
    );

    debouncedSave.current = saveFn;
    saveRef.current.flush = saveFn.flush;

    return () => {
      saveFn.flush();
    };
  }, [filePath, onError, onFileSaved]);

  // Flush save on blur / beforeunload
  useEffect(() => {
    const flush = () => saveRef.current.flush();

    window.addEventListener("blur", flush);
    window.addEventListener("beforeunload", flush);

    // Expose flush so parent can call it on file switch
    (window as any).__excalidrawFlushSave = flush;

    return () => {
      window.removeEventListener("blur", flush);
      window.removeEventListener("beforeunload", flush);
      delete (window as any).__excalidrawFlushSave;
    };
  }, []);

  // When apiRef is set, force reload (initialData change)
  const handleApiReady = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
  }, []);

  if (loading) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#888",
          fontSize: 14,
          background: "#121212",
        }}
      >
        加载中...
      </div>
    );
  }

  if (!initialData) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#888",
          fontSize: 14,
          background: "#121212",
        }}
      >
        无法加载文件
      </div>
    );
  }

  return (
    <div className="editor-area">
      <Excalidraw
        initialData={{
          elements: initialData.elements,
          appState: initialData.appState || undefined,
        }}
        onChange={onChange}
        onExcalidrawAPI={handleApiReady}
        detectScroll={false}
        handleKeyboardGlobally={true}
        autoFocus={true}
      />
    </div>
  );
}
