import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Excalidraw,
  TTDDialog,
  TTDDialogTrigger,
  TTDStreamFetch,
} from "@excalidraw/excalidraw";
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
import { ttdPersistenceAdapter } from "./AIPersistenceAdapter";

import { useHandleLibrary } from "@excalidraw/excalidraw/data/library";
import type { LibraryPersistedData } from "@excalidraw/excalidraw/data/library";
import { clear, createStore, get, set } from "idb-keyval";

// Memoize to prevent tunnel-rat infinite re-render loop when Excalidraw re-renders.
// TTDDialogTrigger's children reference changes on every render; React.memo keeps it stable.
const MemoTTDDialogTrigger = React.memo(TTDDialogTrigger);

const AUTO_SAVE_MS = 500;

const AI_BACKEND = "https://oss-ai.excalidraw.com";

/** IndexedDB adapter for persisting library (素材库) items.
 *  Auto-recovers from corrupted/stale IndexedDB by clearing and recreating. */
class LibraryIndexedDBAdapter {
  private static idb_name = "excalidraw-library";
  private static key = "libraryData";
  private static store = createStore(
    `${LibraryIndexedDBAdapter.idb_name}-db`,
    `${LibraryIndexedDBAdapter.idb_name}-store`,
  );

  static async load() {
    return LibraryIndexedDBAdapter.withRecovery(() =>
      get<LibraryPersistedData>(
        LibraryIndexedDBAdapter.key,
        LibraryIndexedDBAdapter.store,
      ),
    );
  }

  static save(data: LibraryPersistedData): Promise<void> {
    return LibraryIndexedDBAdapter.withRecovery(() =>
      set(LibraryIndexedDBAdapter.key, data, LibraryIndexedDBAdapter.store),
    );
  }

  /** Attempt the operation; on IndexedDB error, clear the DB and retry once. */
  private static async withRecovery<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      if (
        error?.name === "UnknownError" ||
        /indexeddatabase|backing store/i.test(error?.message || "")
      ) {
        console.warn(
          "Library IndexedDB corrupted, clearing and retrying...",
          error,
        );
        await clear(LibraryIndexedDBAdapter.store);
        return fn();
      }
      throw error;
    }
  }
}

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

  // ── Library (素材库) support ──────────────────────────────────────────────
  // Listens for hashchange events from libraries.excalidraw.com and persists
  // library items to IndexedDB.
  useHandleLibrary({
    excalidrawAPI: apiRef.current,
    adapter: LibraryIndexedDBAdapter,
  });

  // ── AI Text-to-Diagram ──────────────────────────────────────────────────
  // TTDStreamFetch handles all error cases internally and returns the correct
  // OnTextSubmitRetValue type expected by TTDDialog
  const handleAITextSubmit = useCallback(
    async (props: {
      messages: Array<{ role: "user" | "assistant"; content: string }>;
      onChunk?: (chunk: string) => void;
      onStreamCreated?: () => void;
      signal?: AbortSignal;
    }) => {
      const { onChunk, onStreamCreated, signal, messages } = props;
      return TTDStreamFetch({
        url: `${AI_BACKEND}/v1/ai/text-to-diagram/chat-streaming`,
        messages,
        onChunk,
        onStreamCreated,
        extractRateLimits: true,
        signal,
      });
    },
    [],
  );

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
      >
        <MemoTTDDialogTrigger />
        <TTDDialog
          onTextSubmit={handleAITextSubmit}
          persistenceAdapter={ttdPersistenceAdapter}
        />
      </Excalidraw>
    </div>
  );
}
