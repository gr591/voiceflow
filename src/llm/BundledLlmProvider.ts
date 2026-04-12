// Wraps the bundled llama-server.exe process as an LLM provider.
//
// On first use, calls start_bundled_llm (Rust) to spawn llama-server if needed,
// then polls /health until the model is loaded before sending requests.
// The underlying HTTP transport is identical to LocalProvider (OpenAI-compatible).

import { invoke } from "@tauri-apps/api/core";
import { OpenAIProvider } from "./OpenAIProvider";
import type { LLMRequestOptions, LLMStreamEvent } from "./types";

const LLAMA_PORT_DEFAULT = 8765;
const LLAMA_MODEL = "LFM2.5-350M-Q8_0";

export class BundledLlmProvider extends OpenAIProvider {
  override readonly id = "bundled";
  override readonly displayName = "Bundled (LFM2.5 350M · no API key)";

  private ready = false;
  private startPromise: Promise<void> | null = null;
  private port = LLAMA_PORT_DEFAULT;

  constructor() {
    super("__placeholder__", LLAMA_MODEL, `http://127.0.0.1:${LLAMA_PORT_DEFAULT}/v1`);
  }

  private ensureReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.startPromise) return this.startPromise;

    this.startPromise = (async () => {
      this.port = await invoke<number>("start_bundled_llm");
      (this as any).baseUrl = `http://127.0.0.1:${this.port}/v1`;

      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`http://127.0.0.1:${this.port}/health`);
          if (res.ok) { this.ready = true; return; }
        } catch { /* not yet */ }
        await new Promise(r => setTimeout(r, 600));
      }
      throw new Error("Bundled LLM did not become ready within 30 s");
    })().catch(err => {
      this.startPromise = null;
      throw err;
    });

    return this.startPromise;
  }

  override async *stream(
    messages: Parameters<OpenAIProvider["stream"]>[0],
    options?: LLMRequestOptions
  ): AsyncIterable<LLMStreamEvent> {
    await this.ensureReady();
    yield* super.stream(messages, { ...options, model: LLAMA_MODEL });
  }

  override async validateConfig(): Promise<{ valid: boolean; error?: string }> {
    const available = await invoke<boolean>("bundled_llm_available").catch(() => false);
    if (!available) {
      return {
        valid: false,
        error: "llama-server or model not found — run scripts/download-llama.ps1",
      };
    }
    return { valid: true };
  }

  override async listModels(): Promise<string[]> {
    return [LLAMA_MODEL];
  }
}
