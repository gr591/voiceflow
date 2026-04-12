import { invoke } from "@tauri-apps/api/core";
import type { TTSError, TTSProvider, TTSState } from "./types";

/**
 * TTS provider backed by the bundled piper binary (local, no internet needed).
 * Piper returns WAV bytes which we play via HTMLAudioElement.
 */
export class TTSPiperProvider implements TTSProvider {
  readonly id = "piper-local";
  readonly displayName = "Piper (Local)";

  private _speaking = false;
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private stateCbs: Array<(s: TTSState) => void> = [];
  private errorCbs: Array<(e: TTSError) => void> = [];

  constructor(private model?: string) {}

  async speak(text: string): Promise<void> {
    this.stop();
    this._speaking = true;
    this.stateCbs.forEach(cb => cb("loading"));

    try {
      const wavBytes = await invoke<number[]>("speak_with_piper", {
        text,
        model: this.model ?? null,
      });

      const blob = new Blob([new Uint8Array(wavBytes)], { type: "audio/wav" });
      this.audioUrl = URL.createObjectURL(blob);
      this.audio = new Audio(this.audioUrl);
      this.stateCbs.forEach(cb => cb("speaking"));

      await new Promise<void>((resolve, reject) => {
        this.audio!.onended = () => resolve();
        this.audio!.onerror = () => reject(new Error("Audio playback failed"));
        this.audio!.play();
      });

      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    } catch (e) {
      this.errorCbs.forEach(cb => cb({ code: "API_ERROR", message: String(e) }));
    } finally {
      this._speaking = false;
      this.audio = null;
      this.stateCbs.forEach(cb => cb("idle"));
    }
  }

  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
    this._speaking = false;
    this.stateCbs.forEach(cb => cb("idle"));
  }

  isSpeaking(): boolean { return this._speaking; }

  onStateChange(cb: (s: TTSState) => void): () => void {
    this.stateCbs.push(cb);
    return () => { this.stateCbs = this.stateCbs.filter(x => x !== cb); };
  }

  onError(cb: (e: TTSError) => void): () => void {
    this.errorCbs.push(cb);
    return () => { this.errorCbs = this.errorCbs.filter(x => x !== cb); };
  }
}
