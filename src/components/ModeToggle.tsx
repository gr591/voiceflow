import React from "react";

export type AppMode = "dictation" | "chat";

interface ModeToggleProps {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
}

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div className="flex items-center gap-0 p-0.5 rounded-lg"
      style={{ background: "var(--surface2)" }}>
      {(["dictation", "chat"] as AppMode[]).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className="px-2.5 py-0.5 rounded-md capitalize transition-all duration-150 font-medium text-[11px]"
          style={mode === m
            ? { background: "var(--surface)", color: "var(--fg)", boxShadow: "0 1px 2px rgba(0,0,0,0.10)" }
            : { color: "var(--muted)", background: "transparent" }
          }
        >
          {m}
        </button>
      ))}
    </div>
  );
}
