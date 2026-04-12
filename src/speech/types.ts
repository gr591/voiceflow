// ── STT ─────────────────────────────────────────────────────────────────────

export type STTErrorCode =
  | "NO_MIC"
  | "PERMISSION_DENIED"
  | "SIDECAR_FAILED"
  | "API_ERROR"
  | "UNKNOWN";

export interface STTError {
  code: STTErrorCode;
  message: string;
}

export interface STTProvider {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<string>;
  onPartialResult(cb: (text: string) => void): void;
  onError(cb: (error: STTError) => void): void;
  isRecording(): boolean;
  /** Optional: called when VAD detects end of speech. Provider fires cb automatically. */
  onAutoStop?(cb: (() => void) | undefined): void;
}

export interface SpeechManagerAPI {
  setProvider(provider: "whisper-cloud" | "whisper-local", apiKey?: string): void;
  startRecording(): Promise<void>;
  stopRecording(): Promise<string>;
  onPartialTranscript(cb: (text: string) => void): () => void;
  onError(cb: (error: STTError) => void): () => void;
  /** Register a callback that fires when VAD auto-stops recording. Returns unsubscribe fn. */
  onAutoStop(cb: () => void): () => void;
}

// ── TTS ─────────────────────────────────────────────────────────────────────

export type TTSProviderId = "openai-tts" | "elevenlabs" | "piper-local" | "system";

export type TTSState = "idle" | "speaking" | "loading";

export interface TTSError {
  code: "API_ERROR" | "SIDECAR_FAILED" | "AUDIO_FAILED" | "UNKNOWN";
  message: string;
}

export interface TTSProvider {
  readonly id: TTSProviderId;
  readonly displayName: string;
  speak(text: string, voice?: string): Promise<void>;
  stop(): void;
  isSpeaking(): boolean;
  onStateChange(cb: (state: TTSState) => void): () => void;
  onError(cb: (error: TTSError) => void): () => void;
}

export interface TTSManagerAPI {
  setProvider(id: TTSProviderId, options?: { apiKey?: string; voice?: string }): void;
  speak(text: string): Promise<void>;
  stop(): void;
  isSpeaking(): boolean;
  onStateChange(cb: (state: TTSState) => void): () => void;
  onError(cb: (error: TTSError) => void): () => void;
}
