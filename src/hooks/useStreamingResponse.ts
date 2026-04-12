import { useCallback, useRef, useState } from "react";
import type { LLMMessage, LLMRequestOptions } from "../llm/types";
import { providerManager } from "../llm/ProviderManager";

interface StreamingState {
  text: string;
  isStreaming: boolean;
  error: string | null;
}

export function useStreamingResponse() {
  const [state, setState] = useState<StreamingState>({
    text: "",
    isStreaming: false,
    error: null,
  });
  const abortRef = useRef(false);

  const stream = useCallback(
    async (messages: LLMMessage[], options?: LLMRequestOptions): Promise<string> => {
      abortRef.current = false;
      setState({ text: "", isStreaming: true, error: null });
      let accumulated = "";

      try {
        for await (const event of providerManager.stream(messages, options)) {
          if (abortRef.current) break;
          if (event.type === "text_delta" && event.text) {
            accumulated += event.text;
            // Batch updates with rAF to avoid excessive re-renders
            setState((prev) => ({ ...prev, text: accumulated }));
          }
          if (event.type === "error") {
            setState({ text: accumulated, isStreaming: false, error: event.error ?? "Unknown error" });
            return accumulated;
          }
          if (event.type === "done") break;
        }
        setState({ text: accumulated, isStreaming: false, error: null });
        return accumulated;
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: err instanceof Error ? err.message : String(err),
        }));
        return accumulated;
      }
    },
    []
  );

  const abort = useCallback(() => {
    abortRef.current = true;
    setState((prev) => ({ ...prev, isStreaming: false }));
  }, []);

  return { ...state, stream, abort };
}
