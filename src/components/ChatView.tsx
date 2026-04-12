import React, { useEffect, useRef } from "react";
import type { LLMMessage } from "../llm/types";
import { ChatMessage } from "./ChatMessage";

interface ChatViewProps {
  messages: LLMMessage[];
  streamingText: string;
  isStreaming: boolean;
}

export function ChatView({ messages, streamingText, isStreaming }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  return (
    <div className="h-full overflow-y-auto px-3 py-3 flex flex-col gap-2.5 scroll-smooth">
      {messages.length === 0 && !isStreaming ? (
        <div className="flex-1 flex flex-col items-center justify-center h-full">
          <p className="text-[12px]" style={{ color: "var(--muted)" }}>
            Ask anything, or press the mic to speak
          </p>
        </div>
      ) : (
        <>
          {messages.map((msg, i) => (
            <ChatMessage key={i} message={msg} />
          ))}
          {isStreaming && streamingText && (
            <ChatMessage message={{ role: "assistant", content: streamingText }} isStreaming />
          )}
        </>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
