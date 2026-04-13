export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export type LLMStreamEventType = "text_delta" | "done" | "error";

export interface LLMStreamEvent {
  type: LLMStreamEventType;
  text?: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMRequestOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
}

export interface LLMProvider {
  readonly id: string;
  readonly displayName: string;
  validateConfig(): Promise<{ valid: boolean; error?: string }>;
  stream(
    messages: LLMMessage[],
    options?: LLMRequestOptions
  ): AsyncIterable<LLMStreamEvent>;
  listModels(): Promise<string[]>;
}

export interface ProviderManagerAPI {
  getProviders(): LLMProvider[];
  getActiveProvider(): LLMProvider;
  setActiveProvider(id: string): void;
  stream(
    messages: LLMMessage[],
    options?: LLMRequestOptions
  ): AsyncIterable<LLMStreamEvent>;
}
