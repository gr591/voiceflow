import { BundledLlmProvider } from "./BundledLlmProvider";
import { ClaudeProvider } from "./ClaudeProvider";
import { LocalProvider } from "./LocalProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import type {
  LLMMessage,
  LLMProvider,
  LLMRequestOptions,
  LLMStreamEvent,
  ProviderManagerAPI,
} from "./types";

// Keep the StubProvider for when no API key is configured
class StubProvider implements LLMProvider {
  readonly id = "stub";
  readonly displayName = "Stub Provider";

  async validateConfig() {
    return { valid: true };
  }

  async *stream(
    _messages: LLMMessage[],
    _options?: LLMRequestOptions
  ): AsyncIterable<LLMStreamEvent> {
    const words =
      "No LLM provider configured. Add an API key in Settings.".split(" ");
    for (const word of words) {
      await new Promise((r) => setTimeout(r, 60));
      yield { type: "text_delta", text: word + " " };
    }
    yield { type: "done" };
  }

  async listModels() {
    return [];
  }
}

class ProviderManager implements ProviderManagerAPI {
  private providers = new Map<string, LLMProvider>();
  private activeId = "stub";

  constructor() {
    this.providers.set("stub", new StubProvider());
    // Always register bundled — it self-validates availability
    this.providers.set("bundled", new BundledLlmProvider());
  }

  /** Call this once config is loaded to register real providers */
  configure(config: {
    activeId: string;
    claude?: { apiKey: string; model: string };
    openai?: { apiKey: string; model: string };
    local?: { endpoint: string; model: string };
  }) {
    if (config.claude?.apiKey) {
      this.providers.set("claude", new ClaudeProvider(config.claude.apiKey, config.claude.model));
    }
    if (config.openai?.apiKey) {
      this.providers.set("openai", new OpenAIProvider(config.openai.apiKey, config.openai.model));
    }
    // Local provider always registered (no API key needed)
    this.providers.set(
      "local",
      new LocalProvider(config.local?.endpoint, config.local?.model)
    );

    if (this.providers.has(config.activeId)) {
      this.activeId = config.activeId;
    }
  }

  getProviders(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  getActiveProvider(): LLMProvider {
    return this.providers.get(this.activeId) ?? this.providers.get("stub")!;
  }

  setActiveProvider(id: string): void {
    if (this.providers.has(id)) this.activeId = id;
  }

  stream(
    messages: LLMMessage[],
    options?: LLMRequestOptions
  ): AsyncIterable<LLMStreamEvent> {
    return this.getActiveProvider().stream(messages, options);
  }
}

export const providerManager = new ProviderManager();
