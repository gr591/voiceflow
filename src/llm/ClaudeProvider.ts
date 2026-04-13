import type { LLMMessage, LLMProvider, LLMRequestOptions, LLMStreamEvent } from "./types";
import { parseSSEStream } from "./streaming";

export class ClaudeProvider implements LLMProvider {
  readonly id = "claude";
  readonly displayName = "Claude (Anthropic)";

  constructor(private apiKey: string, private defaultModel = "claude-sonnet-4-6") {}

  async validateConfig(): Promise<{ valid: boolean; error?: string }> {
    if (!this.apiKey) return { valid: false, error: "API key not set" };
    try {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
      });
      if (res.status === 401) return { valid: false, error: "Invalid API key" };
      return { valid: true };
    } catch (e) {
      return { valid: false, error: `Connection failed: ${e}` };
    }
  }

  async *stream(messages: LLMMessage[], options?: LLMRequestOptions): AsyncIterable<LLMStreamEvent> {
    const system = options?.systemPrompt;
    const body: Record<string, unknown> = {
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? 2048,
      messages: messages.filter(m => m.role !== "system"),
      stream: true,
    };
    if (system) body.system = system;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      yield { type: "error", error: `Claude API error ${res.status}: ${err}` };
      return;
    }

    // Anthropic SSE format: event: content_block_delta \n data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
    for await (const line of parseSSEStream(res)) {
      try {
        const data = JSON.parse(line);
        if (data.type === "content_block_delta" && data.delta?.type === "text_delta") {
          yield { type: "text_delta", text: data.delta.text };
        } else if (data.type === "message_stop") {
          yield { type: "done" };
          return;
        } else if (data.type === "message_delta" && data.usage) {
          yield {
            type: "done",
            usage: {
              inputTokens: data.usage.input_tokens ?? 0,
              outputTokens: data.usage.output_tokens ?? 0,
            },
          };
        } else if (data.type === "error") {
          yield { type: "error", error: data.error?.message ?? "Unknown error" };
          return;
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }

  async listModels(): Promise<string[]> {
    return [
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ];
  }
}
