import type { TTSError, TTSProvider, TTSProviderId, TTSState } from "./types";

export class TTSCloudProvider implements TTSProvider {
  readonly id: TTSProviderId = "openai-tts";
  readonly displayName = "OpenAI TTS";
  private _speaking = false;
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private stateCbs: Array<(s: TTSState) => void> = [];
  private errorCbs: Array<(e: TTSError) => void> = [];

  constructor(private apiKey: string, private voice = "alloy") {}

  async speak(text: string): Promise<void> {
    this.stop(); // stop any ongoing speech
    this._speaking = true;
    this.stateCbs.forEach(cb => cb("loading"));

    try {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "tts-1", input: text, voice: this.voice }),
      });

      if (!res.ok) throw new Error(`TTS API error: ${res.status}`);

      const blob = await res.blob();
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
