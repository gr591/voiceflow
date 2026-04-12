export interface LLMProviderConfig {
  claude: { apiKey: string; model: string };
  openai: { apiKey: string; model: string };
  local: { endpoint: string; model: string };
}

export interface VoiceFlowConfig {
  // Core Shell
  hotkey: string;
  overlayPosition: "center" | "cursor" | "top-center";
  autoStart: boolean;

  // UI
  theme: "system" | "light" | "dark";
  fontSize: number;

  // STT
  sttProvider: "whisper-cloud" | "whisper-local";
  whisperApiKey: string;
  whisperModel: string;
  localWhisperModelPath: string;

  // TTS
  ttsProvider: "openai-tts" | "elevenlabs" | "piper-local" | "system";
  ttsAutoPlay: boolean;
  ttsVoice: string;
  ttsApiKey: string;

  // LLM
  activeLlmProvider: "claude" | "openai" | "local" | "bundled";
  llmProviders: LLMProviderConfig;

  // Post-processing (runs after whisper transcription via the active LLM)
  postProcess: {
    enabled: boolean;
    fixVocabulary: boolean;    // Fix "SAS" → "SaaS", "open eye" → "OpenAI", etc.
    autoTone: boolean;         // Adjust formality based on the active app
    targetLanguage: string;    // "" = no translation, "es" = Spanish, etc.
  };
}
