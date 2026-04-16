import { WhisperCloudProvider } from "./WhisperCloudProvider";
import { WhisperLocalProvider } from "./WhisperLocalProvider";
import type { SpeechManagerAPI, STTError, STTProvider } from "./types";

export class SpeechManager implements SpeechManagerAPI {
  private provider: STTProvider;
  private _partialCbs: Array<(text: string) => void> = [];
  private _errorCbs: Array<(error: STTError) => void> = [];
  private _autoStopCb: (() => void) | undefined;

  constructor() {
    // Start with stub; setProvider is called once config loads
    this.provider = createStubProvider();
    this.wireProvider();
  }

  private wireProvider(): void {
    this.provider.onPartialResult(text => this._partialCbs.forEach(cb => cb(text)));
    this.provider.onError(err => this._errorCbs.forEach(cb => cb(err)));
    // Wire the current auto-stop callback into the new provider if it supports it
    if (this.provider.onAutoStop) {
      this.provider.onAutoStop(this._autoStopCb);
    }
  }

  setProvider(providerId: "whisper-cloud" | "whisper-local", apiKey?: string): void {
    const prior = this.provider;
    // Detach callbacks from the prior provider so any late-firing events from
    // its in-flight work don't leak into the new provider's wiring.
    prior.onPartialResult(() => {});
    prior.onError(() => {});
    if (prior.onAutoStop) prior.onAutoStop(undefined);
    if (prior.isRecording()) {
      prior.stop().catch(console.error);
    }
    if (providerId === "whisper-local") {
      this.provider = new WhisperLocalProvider();
    } else if (providerId === "whisper-cloud" && apiKey) {
      this.provider = new WhisperCloudProvider(apiKey);
    }
    this.wireProvider();
  }

  async startRecording(): Promise<void> {
    await this.provider.start();
  }

  async stopRecording(): Promise<string> {
    return await this.provider.stop();
  }

  onPartialTranscript(cb: (text: string) => void): () => void {
    this._partialCbs.push(cb);
    return () => { this._partialCbs = this._partialCbs.filter(x => x !== cb); };
  }

  onError(cb: (error: STTError) => void): () => void {
    this._errorCbs.push(cb);
    return () => { this._errorCbs = this._errorCbs.filter(x => x !== cb); };
  }

  onAutoStop(cb: () => void): () => void {
    this._autoStopCb = cb;
    if (this.provider.onAutoStop) {
      this.provider.onAutoStop(cb);
    }
    return () => {
      this._autoStopCb = undefined;
      if (this.provider.onAutoStop) {
        this.provider.onAutoStop(undefined);
      }
    };
  }
}

function createStubProvider(): STTProvider {
  return {
    name: "stub",
    async start() {},
    async stop() { return "No STT provider configured. Set an API key in Settings."; },
    onPartialResult() {},
    onError() {},
    isRecording() { return false; },
  };
}

export const speechManager = new SpeechManager();
