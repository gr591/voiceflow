import React from "react";
import type { LLMMessage } from "../llm/types";
import { ResponseActions } from "./ResponseActions";

interface ChatMessageProps {
  message: LLMMessage;
  isStreaming?: boolean;
}

function renderContent(text: string): React.ReactNode[] {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith("```")) {
      const code = part.replace(/^```\w*\n?/, "").replace(/```$/, "");
      return (
        <pre key={i} className="rounded-lg p-2 text-[11px] overflow-x-auto font-mono mt-1.5"
          style={{ background: "rgba(0,0,0,0.15)" }}>
          {code}
        </pre>
      );
    }
    return (
      <span key={i}>
        {part.split("\n").map((line, j, arr) => (
          <React.Fragment key={j}>
            {line}{j < arr.length - 1 && <br />}
          </React.Fragment>
        ))}
      </span>
    );
  });
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isAssistant = message.role === "assistant";

  return (
    <div className={`flex flex-col ${isAssistant ? "items-start" : "items-end"}`}>
      <div
        className="max-w-[88%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed break-words"
        style={isAssistant
          ? { background: "var(--surface)", color: "var(--fg)", borderBottomLeftRadius: 6 }
          : { background: "var(--accent)", color: "#fff", borderBottomRightRadius: 6 }
        }
      >
        {renderContent(message.content)}
        {isStreaming && (
          <span className="inline-block w-0.5 h-3.5 ml-0.5 rounded-full bg-current animate-pulse" />
        )}
      </div>
      {isAssistant && !isStreaming && message.content && (
        <ResponseActions text={message.content} />
      )}
    </div>
  );
}
