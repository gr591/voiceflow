import { load, type Store } from "@tauri-apps/plugin-store";
import { DEFAULT_CONFIG } from "./defaults";
import type { VoiceFlowConfig } from "./types";

// Single JSON file in the OS app-config dir. Tauri plugin-store handles
// cross-platform path resolution and atomic writes.
const STORE_FILE = "voiceflow.config.json";
const CONFIG_KEY = "config";

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load(STORE_FILE, { defaults: {}, autoSave: false });
  }
  return storePromise;
}

export async function loadConfig(): Promise<VoiceFlowConfig> {
  try {
    const store = await getStore();
    const stored = await store.get<Partial<VoiceFlowConfig>>(CONFIG_KEY);
    if (!stored) return { ...DEFAULT_CONFIG };
    // Merge with defaults so new fields added in later versions get sane values.
    return {
      ...DEFAULT_CONFIG,
      ...stored,
      llmProviders: {
        ...DEFAULT_CONFIG.llmProviders,
        ...(stored.llmProviders ?? {}),
      },
      postProcess: {
        ...DEFAULT_CONFIG.postProcess,
        ...(stored.postProcess ?? {}),
      },
    };
  } catch (e) {
    console.error("[configStore] loadConfig failed, using defaults:", e);
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(
  patch: Partial<VoiceFlowConfig>
): Promise<void> {
  try {
    const store = await getStore();
    const current = (await store.get<VoiceFlowConfig>(CONFIG_KEY)) ?? DEFAULT_CONFIG;
    const next = { ...current, ...patch };
    await store.set(CONFIG_KEY, next);
    await store.save();
  } catch (e) {
    console.error("[configStore] saveConfig failed:", e);
    throw e;
  }
}
