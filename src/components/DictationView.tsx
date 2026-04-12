import React from "react";
import { ResponseActions } from "./ResponseActions";

interface DictationViewProps {
  transcript: string;
  partial: string;
  isRecording: boolean;
}

export function DictationView({ transcript, partial, isRecording }: DictationViewProps) {
  const displayText = partial || transcript;

  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 px-6">
      {isRecording && !partial && (
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[11px]" style={{ color: "var(--muted)" }}>Listening…</span>
        </div>
      )}

      {displayText ? (
        <>
          <p className="text-[14px] text-center leading-relaxed max-w-full"
            style={{ color: partial ? "var(--muted)" : "var(--fg)", fontStyle: partial ? "italic" : "normal" }}>
            {displayText}
          </p>
          {!partial && transcript && <ResponseActions text={transcript} />}
        </>
      ) : !isRecording ? (
        <p className="text-[12px] text-center" style={{ color: "var(--muted)" }}>
          Press the mic button to start dictating
        </p>
      ) : null}
    </div>
  );
}
