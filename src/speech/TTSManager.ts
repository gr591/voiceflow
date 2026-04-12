import { TTSCloudProvider } from "./TTSCloudProvider";
import { TTSPiperProvider } from "./TTSPiperProvider";
import { TTSSystemProvider } from "./TTSSystemProvider";
import type { TTSError, TTSManagerAPI, TTSProviderId, TTSProvider, TTSState } from "./types";

export class TTSManager implements TTSManagerAPI {
  private provider: TTSProvider = new TTSPiperProvider();

  setProvider(id: TTSProviderId, options?: { apiKey?: string; voice?: string }): void {
    this.provider.stop();
    switch (id) {
      case "piper-local":
        this.provider = new TTSPiperProvider(options?.voice);
        break;
      case "openai-tts":
        this.provider = new TTSCloudProvider(options?.apiKey ?? "", options?.voice ?? "alloy");
        break;
      case "system":
        this.provider = new TTSSystemProvider();
        break;
      default:
        this.provider = new TTSPiperProvider();
        break;
    }
  }

  async speak(text: string): Promise<void> { return this.provider.speak(text); }
  stop(): void { this.provider.stop(); }
  isSpeaking(): boolean { return this.provider.isSpeaking(); }
  onStateChange(cb: (state: TTSState) => void): () => void { return this.provider.onStateChange(cb); }
  onError(cb: (error: TTSError) => void): () => void { return this.provider.onError(cb); }
}

export const ttsManager = new TTSManager();
