import { OpenAIProvider } from "./OpenAIProvider";

export class LocalProvider extends OpenAIProvider {
  override readonly id = "local";
  override readonly displayName = "Local (Ollama / LM Studio)";

  constructor(endpoint = "http://localhost:11434/v1", defaultModel = "llama3") {
    // Use a placeholder key — local servers typically don't require auth
    super("ollama", defaultModel, endpoint);
  }

  override async validateConfig(): Promise<{ valid: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/models`);
      if (!res.ok) return { valid: false, error: `Server returned ${res.status}` };
      return { valid: true };
    } catch (e) {
      return { valid: false, error: `Cannot reach local server: ${e}` };
    }
  }

  override async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data as Array<{ id: string }>).map(m => m.id);
    } catch {
      return [];
    }
  }
}
