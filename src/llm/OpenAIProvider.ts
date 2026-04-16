import type { LLMMessage, LLMProvider, LLMRequestOptions, LLMStreamEvent } from "./types";
import { parseSSEStream } from "./streaming";

export class OpenAIProvider implements LLMProvider {
  readonly id: string = "openai";
  readonly displayName: string = "OpenAI";

  constructor(
    private apiKey: string,
    private defaultModel = "gpt-4o",
    protected baseUrl = "https://api.openai.com/v1"
  ) {}

  async validateConfig(): Promise<{ valid: boolean; error?: string }> {
    if (!this.apiKey) return { valid: false, error: "API key not set" };
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (res.status === 401) return { valid: false, error: "Invalid API key" };
      return { valid: true };
    } catch (e) {
      return { valid: false, error: `Connection failed: ${e}` };
    }
  }

  async *stream(messages: LLMMessage[], options?: LLMRequestOptions): AsyncIterable<LLMStreamEvent> {
    const systemMsg = options?.systemPrompt
      ? [{ role: "system" as const, content: options.systemPrompt }]
      : [];

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options?.model ?? this.defaultModel,
        messages: [...systemMsg, ...messages],
        stream: true,
        max_tokens: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0.7,
      }),
      signal: options?.signal,
    });

    if (!res.ok) {
      const err = (await res.text()).slice(0, 500);
      const prefix =
        res.status === 401
          ? "Invalid API key"
          : res.status === 429
            ? "Rate limited — try again in a moment"
            : `OpenAI API error ${res.status}`;
      yield { type: "error", error: `${prefix}: ${err}` };
      return;
    }

    for await (const line of parseSSEStream(res)) {
      try {
        const data = JSON.parse(line);
        const delta = data.choices?.[0]?.delta;
        if (delta?.content) {
          yield { type: "text_delta", text: delta.content };
        }
        if (data.choices?.[0]?.finish_reason === "stop") {
          const usage = data.usage;
          yield {
            type: "done",
            usage: usage
              ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
              : undefined,
          };
          return;
        }
      } catch {
        // Skip
      }
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      // 401/403: surface as empty list so UI can show "invalid key" hint
      // instead of a bogus default. Other failures fall back to default.
      if (res.status === 401 || res.status === 403) return [];
      if (!res.ok) return [this.defaultModel];
      const data = await res.json();
      return (data.data as Array<{ id: string }>)
        .map(m => m.id)
        .filter(id => id.startsWith("gpt"))
        .sort();
    } catch {
      return [this.defaultModel];
    }
  }
}
