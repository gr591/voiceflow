import type { VoiceFlowConfig } from "./types";

export const DEFAULT_CONFIG: VoiceFlowConfig = {
  hotkey: "CmdOrCtrl+Shift+Space",
  overlayPosition: "top-center",
  autoStart: true,
  theme: "dark",
  fontSize: 14,
  sttProvider: "whisper-local",
  whisperApiKey: "",
  whisperModel: "whisper-1",
  localWhisperModelPath: "",
  ttsProvider: "piper-local",
  ttsAutoPlay: false,
  ttsVoice: "alloy",
  ttsApiKey: "",
  activeLlmProvider: "openai",
  llmProviders: {
    claude: { apiKey: "", model: "claude-sonnet-4-6" },
    openai: { apiKey: "", model: "gpt-4o" },
    local: { endpoint: "http://localhost:11434/v1", model: "llama3" },
  },
  postProcess: {
    enabled: false,
    fixVocabulary: true,
    autoTone: true,
    targetLanguage: "",
  },
};
