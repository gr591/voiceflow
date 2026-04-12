import { invoke } from "@tauri-apps/api/core";
import type { TTSError, TTSProvider, TTSProviderId, TTSState } from "./types";

export class TTSSystemProvider implements TTSProvider {
  readonly id: TTSProviderId = "system";
  readonly displayName = "Windows (System)";
  private _speaking = false;
  private stateCbs: Array<(state: TTSState) => void> = [];
  private errorCbs: Array<(error: TTSError) => void> = [];

  async speak(text: string): Promise<void> {
    this._speaking = true;
    this.stateCbs.forEach(cb => cb("speaking"));
    try {
      await invoke("speak_text", { text, provider: "system" });
    } catch (e) {
      this.errorCbs.forEach(cb => cb({ code: "SIDECAR_FAILED", message: String(e) }));
    } finally {
      this._speaking = false;
      this.stateCbs.forEach(cb => cb("idle"));
    }
  }

  stop(): void {
    invoke("stop_speaking").catch(console.error);
    this._speaking = false;
    this.stateCbs.forEach(cb => cb("idle"));
  }

  isSpeaking(): boolean { return this._speaking; }

  onStateChange(cb: (state: TTSState) => void): () => void {
    this.stateCbs.push(cb);
    return () => { this.stateCbs = this.stateCbs.filter(x => x !== cb); };
  }

  onError(cb: (error: TTSError) => void): () => void {
    this.errorCbs.push(cb);
    return () => { this.errorCbs = this.errorCbs.filter(x => x !== cb); };
  }
}
