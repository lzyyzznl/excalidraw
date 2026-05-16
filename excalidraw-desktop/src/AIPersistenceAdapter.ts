import type { TTDPersistenceAdapter } from "@excalidraw/excalidraw";

const STORAGE_KEY = "excalidraw-desktop-ttd-chats";

/**
 * localStorage-based persistence adapter for TTD chat history.
 * Implements the TTDPersistenceAdapter interface required by TTDDialog.
 */
export const ttdPersistenceAdapter: TTDPersistenceAdapter = {
  async loadChats() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },
  async saveChats(chats) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    } catch (error) {
      console.warn("Failed to save TTD chats to localStorage:", error);
    }
  },
};
