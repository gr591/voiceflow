import { invoke } from "@tauri-apps/api/core";
import { WavCapture } from "./WavCapture";
import type { STTProvider, STTError } from "./types";

// Extend Window to reference Web Speech API types without a lib dependency
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

export class WhisperLocalProvider implements STTProvider {
  readonly name = "whisper-local";
  private capture = new WavCapture();
  private _recording = false;
  private partialCbs: Array<(text: string) => void> = [];
  private errorCbs: Array<(err: STTError) => void> = [];
  private autoStopCb: (() => void) | undefined;
  private recognition: SpeechRecognitionInstance | null = null;

  async start(): Promise<void> {
    this._recording = true;
    await this.capture.start(this.autoStopCb);
    this.startLiveCaption();
  }

  async stop(): Promise<string> {
    this._recording = false;
    this.stopLiveCaption();
    const wavBuffer = this.capture.stop();
    const audio = Array.from(new Uint8Array(wavBuffer));
    return await invoke<string>("transcribe_audio", { audio });
  }

  /** Starts Web Speech API alongside whisper recording for live interim text. */
  private startLiveCaption() {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return;
    try {
      const r = new SR();
      r.continuous = true;
      r.interimResults = true;
      r.lang = "en-US";
      r.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (!event.results[i].isFinal) interim += event.results[i][0].transcript;
        }
        if (interim.trim()) this.partialCbs.forEach(cb => cb(interim.trim()));
      };
      r.onerror = null; // silently ignore — whisper is the ground truth
      r.onend = () => {
        // Restart if still recording (recognition auto-stops on silence)
        if (this._recording && this.recognition === r) {
          try { r.start(); } catch { /* ignore */ }
        }
      };
      r.start();
      this.recognition = r;
    } catch {
      // Web Speech API unavailable — partials just won't show during recording
    }
  }

  private stopLiveCaption() {
    if (this.recognition) {
      try { this.recognition.stop(); } catch { /* ignore */ }
      this.recognition = null;
    }
  }

  onAutoStop(cb: (() => void) | undefined): void {
    this.autoStopCb = cb;
  }

  onPartialResult(cb: (text: string) => void): void {
    this.partialCbs.push(cb);
  }

  onError(cb: (err: STTError) => void): void {
    this.errorCbs.push(cb);
  }

  isRecording(): boolean { return this._recording; }
}
