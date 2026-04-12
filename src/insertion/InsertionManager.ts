import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { InsertionAPI } from "./types";

class InsertionManager implements InsertionAPI {
  async copyToClipboard(text: string): Promise<void> {
    await writeText(text);
  }

  async insertAtCursor(text: string): Promise<void> {
    await invoke("insert_at_cursor", { text });
  }
}

export const insertionManager = new InsertionManager();
