import React from "react";

export type AppStatus =
  | "idle"
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

interface StatusIndicatorProps {
  status: AppStatus;
  errorMessage?: string;
}

const STATUS_LABEL: Record<AppStatus, string> = {
  idle: "",
  recording: "Listening...",
  transcribing: "Transcribing...",
  thinking: "Thinking...",
  speaking: "Speaking...",
  error: "Error",
};

export function StatusIndicator({ status, errorMessage }: StatusIndicatorProps) {
  if (status === "idle") return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1 text-xs text-muted">
      {status === "recording" && (
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
      )}
      {status === "speaking" && (
        <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
      )}
      {(status === "transcribing" || status === "thinking") && (
        <span className="w-2 h-2 rounded-full bg-muted animate-bounce" />
      )}
      <span>{status === "error" ? errorMessage : STATUS_LABEL[status]}</span>
    </div>
  );
}
