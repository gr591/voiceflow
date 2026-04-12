import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { enable as autostartEnable, disable as autostartDisable } from "@tauri-apps/plugin-autostart";
import { providerManager } from "../llm/ProviderManager";
import { speechManager } from "../speech/SpeechManager";
import { ttsManager } from "../speech/TTSManager";
import { loadConfig, saveConfig } from "./configStore";
import { DEFAULT_CONFIG } from "./defaults";
import type { VoiceFlowConfig } from "./types";

interface ConfigContextValue {
  config: VoiceFlowConfig;
  updateConfig: (patch: Partial<VoiceFlowConfig>) => Promise<void>;
}

const ConfigContext = createContext<ConfigContextValue>({
  config: DEFAULT_CONFIG,
  updateConfig: async () => {},
});

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<VoiceFlowConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    loadConfig().then((cfg) => {
      setConfig(cfg);
      providerManager.configure({
        activeId: cfg.activeLlmProvider,
        claude: cfg.llmProviders.claude,
        openai: cfg.llmProviders.openai,
        local: cfg.llmProviders.local,
      });
      speechManager.setProvider(cfg.sttProvider, cfg.whisperApiKey);
      ttsManager.setProvider(cfg.ttsProvider, { apiKey: cfg.ttsApiKey, voice: cfg.ttsVoice });

      // Sync autostart state with the OS on every launch.
      if (cfg.autoStart) {
        autostartEnable().catch(() => {});
      } else {
        autostartDisable().catch(() => {});
      }
    });
  }, []);

  async function updateConfig(patch: Partial<VoiceFlowConfig>) {
    await saveConfig(patch);
    setConfig((prev) => ({ ...prev, ...patch }));
  }

  return (
    <ConfigContext.Provider value={{ config, updateConfig }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  return useContext(ConfigContext);
}
