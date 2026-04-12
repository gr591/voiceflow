import React from "react";
import { useConfig } from "../config/ConfigContext";
import { SUPPORTED_LANGUAGES } from "../speech/PostProcessor";

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { config, updateConfig } = useConfig();

  return (
    <div className="absolute inset-0 bg-bg z-20 flex flex-col rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-medium text-fg">Settings</span>
        <button
          onClick={onClose}
          className="text-muted hover:text-fg text-xs"
        >
          Done
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4 text-xs">
        <Section title="LLM Provider">
          <Select
            label="Active Provider"
            value={config.activeLlmProvider}
            options={[
              { value: "bundled", label: "Bundled (LFM2.5 350M · no API key)" },
              { value: "claude", label: "Claude (Anthropic)" },
              { value: "openai", label: "OpenAI" },
              { value: "local", label: "Local (Ollama / LM Studio)" },
            ]}
            onChange={(v) => updateConfig({ activeLlmProvider: v as "claude" | "openai" | "local" })}
          />
          {config.activeLlmProvider === "claude" && (
            <>
              <Input
                label="API Key"
                type="password"
                value={config.llmProviders.claude.apiKey}
                onChange={(v) =>
                  updateConfig({
                    llmProviders: {
                      ...config.llmProviders,
                      claude: { ...config.llmProviders.claude, apiKey: v },
                    },
                  })
                }
              />
              <Input
                label="Model"
                value={config.llmProviders.claude.model}
                onChange={(v) =>
                  updateConfig({
                    llmProviders: {
                      ...config.llmProviders,
                      claude: { ...config.llmProviders.claude, model: v },
                    },
                  })
                }
              />
            </>
          )}
          {config.activeLlmProvider === "openai" && (
            <>
              <Input
                label="API Key"
                type="password"
                value={config.llmProviders.openai.apiKey}
                onChange={(v) =>
                  updateConfig({
                    llmProviders: {
                      ...config.llmProviders,
                      openai: { ...config.llmProviders.openai, apiKey: v },
                    },
                  })
                }
              />
              <Input
                label="Model"
                value={config.llmProviders.openai.model}
                onChange={(v) =>
                  updateConfig({
                    llmProviders: {
                      ...config.llmProviders,
                      openai: { ...config.llmProviders.openai, model: v },
                    },
                  })
                }
              />
            </>
          )}
          {config.activeLlmProvider === "local" && (
            <>
              <Input
                label="Endpoint"
                value={config.llmProviders.local.endpoint}
                onChange={(v) =>
                  updateConfig({
                    llmProviders: {
                      ...config.llmProviders,
                      local: { ...config.llmProviders.local, endpoint: v },
                    },
                  })
                }
              />
              <Input
                label="Model"
                value={config.llmProviders.local.model}
                onChange={(v) =>
                  updateConfig({
                    llmProviders: {
                      ...config.llmProviders,
                      local: { ...config.llmProviders.local, model: v },
                    },
                  })
                }
              />
            </>
          )}
        </Section>

        <Section title="Speech-to-Text">
          <Select
            label="STT Provider"
            value={config.sttProvider}
            options={[
              { value: "whisper-cloud", label: "Whisper (OpenAI)" },
              { value: "whisper-local", label: "Whisper (Local)" },
            ]}
            onChange={(v) => updateConfig({ sttProvider: v as "whisper-cloud" | "whisper-local" })}
          />
          {config.sttProvider === "whisper-cloud" && (
            <Input
              label="Whisper API Key"
              type="password"
              value={config.whisperApiKey}
              onChange={(v) => updateConfig({ whisperApiKey: v })}
            />
          )}
        </Section>

        <Section title="Text-to-Speech">
          <Select
            label="TTS Provider"
            value={config.ttsProvider}
            options={[
              { value: "system", label: "Windows (System)" },
              { value: "openai-tts", label: "OpenAI TTS" },
              { value: "elevenlabs", label: "ElevenLabs" },
              { value: "piper-local", label: "Piper (Local)" },
            ]}
            onChange={(v) => updateConfig({ ttsProvider: v as typeof config.ttsProvider })}
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config.ttsAutoPlay}
              onChange={(e) => updateConfig({ ttsAutoPlay: e.target.checked })}
              className="w-3 h-3 accent-accent"
            />
            <span className="text-muted">Auto-speak responses</span>
          </label>
        </Section>

        <Section title="AI Polish (Post-processing)">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config.postProcess?.enabled ?? false}
              onChange={(e) =>
                updateConfig({ postProcess: { ...(config.postProcess ?? {}), enabled: e.target.checked } as typeof config.postProcess })
              }
              className="w-3 h-3 accent-accent"
            />
            <span className="text-fg">Enable AI polish after dictation</span>
          </label>
          {config.postProcess?.enabled && (
            <>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.postProcess.fixVocabulary}
                  onChange={(e) =>
                    updateConfig({ postProcess: { ...config.postProcess, fixVocabulary: e.target.checked } })
                  }
                  className="w-3 h-3 accent-accent"
                />
                <span className="text-muted">Fix vocabulary (SaaS, GitHub, API…)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.postProcess.autoTone}
                  onChange={(e) =>
                    updateConfig({ postProcess: { ...config.postProcess, autoTone: e.target.checked } })
                  }
                  className="w-3 h-3 accent-accent"
                />
                <span className="text-muted">Auto-adjust tone for active app</span>
              </label>
              <Select
                label="Translate to"
                value={config.postProcess.targetLanguage || ""}
                options={[
                  { value: "", label: "No translation" },
                  ...SUPPORTED_LANGUAGES,
                ]}
                onChange={(v) =>
                  updateConfig({ postProcess: { ...config.postProcess, targetLanguage: v } })
                }
              />
            </>
          )}
        </Section>

        <Section title="Appearance">
          <Select
            label="Theme"
            value={config.theme}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onChange={(v) => updateConfig({ theme: v as "system" | "light" | "dark" })}
          />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted font-medium uppercase tracking-wider text-[10px]">{title}</p>
      {children}
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface text-fg rounded-md px-2 py-1 outline-none border border-border focus:border-accent text-xs"
      />
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface text-fg rounded-md px-2 py-1 outline-none border border-border focus:border-accent text-xs"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
