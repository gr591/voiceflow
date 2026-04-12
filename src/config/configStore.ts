import { DEFAULT_CONFIG } from "./defaults";
import type { VoiceFlowConfig } from "./types";

// STUB: In-memory config store until tauri-plugin-store is wired up
let _config: VoiceFlowConfig = { ...DEFAULT_CONFIG };

export async function loadConfig(): Promise<VoiceFlowConfig> {
  return { ..._config };
}

export async function saveConfig(
  patch: Partial<VoiceFlowConfig>
): Promise<void> {
  _config = { ..._config, ...patch };
}
