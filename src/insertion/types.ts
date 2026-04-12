export interface InsertionAPI {
  /** Copy text to clipboard only */
  copyToClipboard(text: string): Promise<void>;
  /**
   * Insert text at the cursor position in the previously-focused window.
   * Saves clipboard, writes text, simulates Ctrl+V, then restores clipboard.
   */
  insertAtCursor(text: string): Promise<void>;
}
