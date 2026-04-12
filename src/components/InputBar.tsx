import React, { forwardRef, useState } from "react";

interface InputBarProps {
  onSend: (text: string) => void;
  onMicToggle: () => void;
  isRecording: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export const InputBar = forwardRef<HTMLInputElement, InputBarProps>(
  function InputBar({ onSend, onMicToggle, isRecording, disabled, placeholder = "Ask anything…" }, ref) {
    const [value, setValue] = useState("");

    function handleKeyDown(e: React.KeyboardEvent) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
    }

    function submit() {
      const trimmed = value.trim();
      if (!trimmed || disabled) return;
      onSend(trimmed);
      setValue("");
    }

    return (
      <div className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0"
        style={{ borderTop: "1px solid var(--border)" }}>

        {/* Mic button */}
        <button
          onClick={onMicToggle}
          disabled={disabled && !isRecording}
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-150"
          style={isRecording
            ? { background: "var(--rec)", color: "#fff" }
            : { background: "var(--surface2)", color: "var(--muted)" }
          }
          aria-label={isRecording ? "Stop recording" : "Start recording"}
        >
          {isRecording
            ? <StopIcon />
            : <MicIcon />
          }
        </button>

        {/* Text input */}
        <input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[13px] outline-none"
          style={{ color: "var(--fg)" }}
        />

        {/* Send button — only visible when there's text */}
        {value.trim() && (
          <button
            onClick={submit}
            disabled={disabled}
            className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-150 disabled:opacity-40"
            style={{ background: "var(--accent)", color: "#fff" }}
            aria-label="Send"
          >
            <SendIcon />
          </button>
        )}
      </div>
    );
  }
);

function MicIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <rect x="5.5" y="1" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M2.5 8a5.5 5.5 0 0011 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="8" y1="13.5" x2="8" y2="15.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <rect width="10" height="10" rx="2"/>
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
      <path d="M1 11L11 1M11 1H4M11 1V8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
