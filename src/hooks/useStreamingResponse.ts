import { useCallback, useEffect, useRef, useState } from "react";
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
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const safeSetState: typeof setState = useCallback((update) => {
    if (mountedRef.current) setState(update);
  }, []);

  const stream = useCallback(
    async (messages: LLMMessage[], options?: LLMRequestOptions): Promise<string> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      safeSetState({ text: "", isStreaming: true, error: null });
      let accumulated = "";

      try {
        const mergedOptions: LLMRequestOptions = { ...options, signal: controller.signal };
        for await (const event of providerManager.stream(messages, mergedOptions)) {
          if (controller.signal.aborted) break;
          if (event.type === "text_delta" && event.text) {
            accumulated += event.text;
            safeSetState((prev) => ({ ...prev, text: accumulated }));
          }
          if (event.type === "error") {
            safeSetState({ text: accumulated, isStreaming: false, error: event.error ?? "Unknown error" });
            return accumulated;
          }
          if (event.type === "done") break;
        }
        safeSetState({ text: accumulated, isStreaming: false, error: null });
        return accumulated;
      } catch (err) {
        if (controller.signal.aborted) {
          safeSetState((prev) => ({ ...prev, isStreaming: false }));
          return accumulated;
        }
        safeSetState((prev) => ({
          ...prev,
          isStreaming: false,
          error: err instanceof Error ? err.message : String(err),
        }));
        return accumulated;
      }
    },
    [safeSetState]
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    safeSetState((prev) => ({ ...prev, isStreaming: false }));
  }, [safeSetState]);

  return { ...state, stream, abort };
}
