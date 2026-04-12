import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import React, { useEffect, useRef, useState } from "react";
import { useConfig } from "../config/ConfigContext";
import { useOverlayVisibility } from "../hooks/useOverlayVisibility";
import { useStreamingResponse } from "../hooks/useStreamingResponse";
import type { LLMMessage } from "../llm/types";
import { speechManager } from "../speech";
import { postProcess } from "../speech/PostProcessor";
import { ChatView } from "./ChatView";
import { SettingsPanel } from "./SettingsPanel";
import type { AppMode } from "./ModeToggle";

export type AppStatus = "idle" | "recording" | "transcribing" | "processing" | "thinking" | "speaking" | "error";
type UIMode = "small" | "large";

// Window dimensions
const SMALL_W        = 264;
const SMALL_EMPTY_H  = 96;   // buttons only
const SMALL_TEXT_H   = 252;  // text preview + buttons
const LARGE_W        = 480;
const LARGE_H        = 400;

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────

export function Overlay() {
  const { visible } = useOverlayVisibility();
  const { config } = useConfig();

  const [uiMode, setUiMode]           = useState<UIMode>("small");
  const [appMode, setAppMode]         = useState<AppMode>("chat");
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages]       = useState<LLMMessage[]>([]);
  const [transcript, setTranscript]   = useState("");   // confirmed text (additive)
  const [partial, setPartial]         = useState("");   // live partial from VAD
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus]           = useState<AppStatus>("idle");
  const [error, setError]             = useState<string | null>(null);

  const { text: streamingText, isStreaming, stream } = useStreamingResponse();
  const inputRef        = useRef<HTMLInputElement>(null);
  const unsubPartialRef = useRef<(() => void) | null>(null);
  const isRecordingRef  = useRef(false);
  const uiModeRef       = useRef<UIMode>("small");

  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { uiModeRef.current = uiMode; }, [uiMode]);

  // ── Window resize for small mode ──────────────────────────────────────────
  useEffect(() => {
    if (uiMode !== "small" || !visible) return;
    const hasContent = isRecording || !!partial || !!transcript;
    const h = hasContent ? SMALL_TEXT_H : SMALL_EMPTY_H;
    invoke("set_window_size", { width: SMALL_W, height: h }).catch(console.error);
  }, [isRecording, partial, transcript, uiMode, visible]);

  // ── VAD auto-stop wires into stopRecording ────────────────────────────────
  useEffect(() => {
    const unsub = speechManager.onAutoStop(() => {
      if (isRecordingRef.current) stopRecording();
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── On overlay show: reset to small, auto-start recording ─────────────────
  useEffect(() => {
    if (!visible) {
      // Stop any in-progress recording when hidden
      if (isRecordingRef.current) {
        speechManager.stopRecording().catch(() => {});
        setIsRecording(false);
        setStatus("idle");
      }
      setPartial("");
      setError(null);
      setUiMode("small");
      return;
    }

    setUiMode("small");
    invoke("set_window_size", { width: SMALL_W, height: SMALL_EMPTY_H }).catch(console.error);
    // Auto-start recording after window settles
    const t = setTimeout(() => {
      if (!isRecordingRef.current) startRecording();
    }, 130);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ── Escape to hide ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") invoke("hide_overlay").catch(console.error);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  // ── Focus input when large ────────────────────────────────────────────────
  useEffect(() => {
    if (visible && uiMode === "large") setTimeout(() => inputRef.current?.focus(), 60);
  }, [visible, uiMode]);

  // ── Recording ─────────────────────────────────────────────────────────────
  async function startRecording() {
    try {
      setIsRecording(true);
      setStatus("recording");
      setPartial("");
      unsubPartialRef.current?.();
      unsubPartialRef.current = speechManager.onPartialTranscript((t) => setPartial(t));
      await speechManager.startRecording();
    } catch (e) {
      setIsRecording(false);
      setStatus("error");
      setError(String(e));
    }
  }

  async function stopRecording() {
    setIsRecording(false);
    setStatus("transcribing");
    try {
      let text = await speechManager.stopRecording();
      setPartial("");

      // Run LLM post-processing if enabled (vocab fix, auto-tone, translation)
      if (text.trim() && config.postProcess?.enabled) {
        setStatus("processing");
        const appName = await invoke<string | null>("get_foreground_app_name").catch(() => null);
        text = await postProcess(text.trim(), {
          fixVocabulary: config.postProcess.fixVocabulary,
          autoTone: config.postProcess.autoTone,
          appName,
          targetLanguage: config.postProcess.targetLanguage,
        }).catch(() => text); // never lose the original on failure
      }

      if (text.trim()) {
        setTranscript(prev => prev ? prev + " " + text.trim() : text.trim());
      }
      setStatus("idle");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  async function handleMicToggle() {
    if (isRecording) await stopRecording();
    else await startRecording();
  }

  // ── Insert at cursor (manual via checkmark) ───────────────────────────────
  async function handleInsert() {
    const text = transcript || partial;
    if (!text.trim()) return;
    try {
      await invoke("insert_at_cursor", { text: text.trim() });
      setTranscript("");
      setPartial("");
      invoke("hide_overlay").catch(console.error);
    } catch (e) {
      setError(String(e));
    }
  }

  // ── Large mode: send to LLM ───────────────────────────────────────────────
  async function handleSend(text: string) {
    const userMsg: LLMMessage = { role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setStatus("thinking");
    const finalText = await stream(history, {
      systemPrompt: "You are a helpful AI assistant.",
      model: config.llmProviders[config.activeLlmProvider as keyof typeof config.llmProviders]?.model ?? "gpt-4o",
    });
    setMessages([...history, { role: "assistant", content: finalText || "" }]);
    setStatus("idle");
  }

  // ── Large mode: insert last assistant reply ───────────────────────────────
  async function handleInsertLarge() {
    // In chat mode: insert last assistant message; in dictation: insert transcript
    const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
    const text = appMode === "chat" && lastAssistant
      ? lastAssistant.content
      : transcript || streamingText;
    if (!text?.trim()) return;
    try {
      await invoke("insert_at_cursor", { text: text.trim() });
      invoke("hide_overlay").catch(console.error);
    } catch (e) {
      setError(String(e));
    }
  }

  // ── Mode switch ───────────────────────────────────────────────────────────
  async function expandToLarge() {
    if (isRecordingRef.current) {
      speechManager.stopRecording().catch(() => {});
      setIsRecording(false);
      setStatus("idle");
    }
    setUiMode("large");
    await invoke("set_window_size", { width: LARGE_W, height: LARGE_H, position: "top-center" }).catch(console.error);
  }

  function collapseToSmall() {
    setUiMode("small");
    // Show overlay in small mode — re-use show_overlay to get below-caret repositioning
    invoke("show_overlay", {}).catch(console.error);
    invoke("set_window_size", {
      width: SMALL_W,
      height: (transcript || partial) ? SMALL_TEXT_H : SMALL_EMPTY_H,
    }).catch(console.error);
  }

  const onInsert = uiMode === "small" ? handleInsert : handleInsertLarge;
  const onExpand = uiMode === "small" ? expandToLarge : collapseToSmall;

  return (
    <AnimatePresence>
      {visible && (
        uiMode === "small"
          ? <SmallMode
              key="small"
              isRecording={isRecording}
              status={status}
              transcript={transcript}
              partial={partial}
              error={error}
              uiMode={uiMode}
              onMicToggle={handleMicToggle}
              onInsert={onInsert}
              onExpand={onExpand}
              onClearTranscript={() => setTranscript("")}
              onClearError={() => setError(null)}
            />
          : <LargeMode
              key="large"
              appMode={appMode}
              setAppMode={setAppMode}
              showSettings={showSettings}
              setShowSettings={setShowSettings}
              messages={messages}
              streamingText={streamingText}
              isStreaming={isStreaming}
              transcript={transcript}
              partial={partial}
              error={error}
              isRecording={isRecording}
              status={status}
              uiMode={uiMode}
              inputRef={inputRef}
              onSend={handleSend}
              onMicToggle={handleMicToggle}
              onInsert={onInsert}
              onExpand={onExpand}
              onClearTranscript={() => setTranscript("")}
              onClearError={() => setError(null)}
            />
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small Mode  —  Compact pill with text preview
// ─────────────────────────────────────────────────────────────────────────────

interface SmallModeProps {
  isRecording: boolean;
  status: AppStatus;
  transcript: string;
  partial: string;
  error: string | null;
  uiMode: UIMode;
  onMicToggle: () => void;
  onInsert: () => void;
  onExpand: () => void;
  onClearTranscript: () => void;
  onClearError: () => void;
}

function SmallMode({
  isRecording, status, transcript, partial, error,
  onMicToggle, onInsert, onExpand, onClearTranscript, onClearError,
}: SmallModeProps) {
  const isTranscribing = status === "transcribing";
  const hasText = !!transcript || !!partial;
  const displayText = transcript || "";
  const displayPartial = partial;
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    const text = transcript || partial;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard may fail in some contexts; silently ignore
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.88, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.88, y: 6 }}
      transition={{ duration: 0.20, ease: [0.34, 1.2, 0.64, 1] }}
      className="w-full h-full flex flex-col"
      style={{
        background: "var(--bg)",
        backdropFilter: "var(--blur)",
        WebkitBackdropFilter: "var(--blur)",
        borderRadius: 24,
        border: "1px solid var(--border-strong)",
        boxShadow: "var(--shadow)",
        overflow: "hidden",
      }}
    >
      {/* Text preview area */}
      <AnimatePresence>
        {hasText && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                padding: "14px 16px 10px",
                minHeight: 120,
                maxHeight: 156,
                overflowY: "auto",
                position: "relative",
              }}
            >
              {/* Copy + Clear buttons */}
              <div style={{
                position: "absolute",
                top: 9,
                right: 9,
                display: "flex",
                gap: 4,
              }}>
                {/* Copy */}
                <button
                  onClick={handleCopy}
                  title="Copy text"
                  aria-label="Copy text"
                  style={{
                    width: 20, height: 20,
                    borderRadius: 6,
                    background: copied ? "var(--accent-dim, rgba(61,174,233,0.18))" : "var(--surface2)",
                    border: "none",
                    cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: copied ? "var(--accent)" : "var(--muted)",
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={e => { if (!copied) e.currentTarget.style.background = "var(--surface-hover)"; }}
                  onMouseLeave={e => { if (!copied) e.currentTarget.style.background = "var(--surface2)"; }}
                >
                  {copied ? <CopiedIcon /> : <CopyIcon />}
                </button>

                {/* Clear */}
                <button
                  onClick={onClearTranscript}
                  title="Clear text"
                  aria-label="Clear text"
                  style={{
                    width: 20, height: 20,
                    borderRadius: 6,
                    background: "var(--surface2)",
                    border: "none",
                    cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--muted)",
                    fontSize: 9,
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-hover)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "var(--surface2)")}
                >
                  ✕
                </button>
              </div>

              {/* Confirmed text */}
              {displayText && (
                <p style={{
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "var(--fg)",
                  letterSpacing: "-0.01em",
                  paddingRight: 48,
                  fontWeight: 400,
                }}>
                  {displayText}
                </p>
              )}

              {/* Live partial */}
              {displayPartial && (
                <p
                  className={isRecording ? "blink-cursor" : ""}
                  style={{
                    fontSize: 13,
                    lineHeight: 1.55,
                    color: "var(--fg-secondary)",
                    letterSpacing: "-0.01em",
                    marginTop: displayText ? 4 : 0,
                    paddingRight: 48,
                    fontStyle: "italic",
                    fontWeight: 400,
                  }}
                >
                  {displayPartial}
                </p>
              )}

              {/* Placeholder while recording but no text yet */}
              {isRecording && !displayText && !displayPartial && (
                <p style={{
                  fontSize: 13,
                  color: "var(--muted)",
                  fontStyle: "italic",
                  letterSpacing: "-0.01em",
                }}>
                  Listening…
                </p>
              )}

              {/* Error */}
              {error && (
                <p style={{ fontSize: 11, color: "var(--rec)", marginTop: 4 }}>
                  {error}
                  <button
                    onClick={onClearError}
                    style={{ marginLeft: 6, opacity: 0.7, cursor: "pointer", background: "none", border: "none", color: "inherit" }}
                  >✕</button>
                </p>
              )}
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: "var(--border)", marginBottom: 0 }} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Button row */}
      <div
        className="flex items-center no-select"
        style={{ padding: "12px 12px", gap: 8, justifyContent: "center" }}
      >
        {/* Expand */}
        <button className="cmd-btn" onClick={onExpand} aria-label="Expand to full view" title="Open full view">
          <ExpandIcon />
        </button>

        {/* Mic */}
        <button
          className={`cmd-btn ${isRecording ? "cmd-recording" : "cmd-idle-glow"}`}
          onClick={onMicToggle}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
          title={isRecording ? "Stop" : "Record"}
        >
          {isTranscribing ? <ThinkingDots /> : isRecording ? <WaveformIcon /> : <MicIcon />}
        </button>

        {/* Insert / confirm */}
        <button
          className="cmd-btn cmd-confirm"
          onClick={onInsert}
          disabled={!transcript && !partial}
          style={{ opacity: (transcript || partial) ? 1 : 0.32 }}
          aria-label="Insert text at cursor"
          title="Insert"
        >
          <CheckIcon />
        </button>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Large Mode  —  Full panel
// ─────────────────────────────────────────────────────────────────────────────

interface LargeModeProps {
  appMode: AppMode;
  setAppMode: (m: AppMode) => void;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  messages: LLMMessage[];
  streamingText: string;
  isStreaming: boolean;
  transcript: string;
  partial: string;
  error: string | null;
  isRecording: boolean;
  status: AppStatus;
  uiMode: UIMode;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSend: (text: string) => void;
  onMicToggle: () => void;
  onInsert: () => void;
  onExpand: () => void;
  onClearTranscript: () => void;
  onClearError: () => void;
}

function LargeMode({
  appMode, setAppMode, showSettings, setShowSettings,
  messages, streamingText, isStreaming,
  transcript, partial, error,
  isRecording, status, uiMode,
  inputRef, onSend, onMicToggle, onInsert, onExpand,
  onClearTranscript, onClearError,
}: LargeModeProps) {
  const [inputValue, setInputValue] = useState("");
  const isTranscribing = status === "transcribing";

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (inputValue.trim() && !isStreaming) {
        onSend(inputValue.trim());
        setInputValue("");
      }
    }
  }

  const modeLabel = appMode === "dictation" ? "Dictate" : "Chat";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: -6 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="w-full h-full flex flex-col"
      style={{
        background: "var(--bg)",
        backdropFilter: "var(--blur)",
        WebkitBackdropFilter: "var(--blur)",
        borderRadius: 20,
        border: "1px solid var(--border-strong)",
        boxShadow: "var(--shadow)",
        overflow: "hidden",
      }}
    >
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {/* ── Header ── */}
      <div
        className="flex items-center justify-between no-select flex-shrink-0"
        style={{
          padding: "11px 14px 10px",
          borderBottom: "1px solid var(--border)",
          minHeight: 44,
        }}
      >
        {/* Mode tabs */}
        <div className="flex items-center gap-1" style={{ background: "var(--surface2)", borderRadius: 10, padding: "3px 3px" }}>
          {(["dictation", "chat"] as AppMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setAppMode(m)}
              style={{
                fontSize: 12,
                fontWeight: 500,
                padding: "3px 10px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                transition: "all 0.12s",
                background: appMode === m ? "var(--btn-bg)" : "transparent",
                color: appMode === m ? "var(--fg)" : "var(--muted)",
                letterSpacing: "-0.01em",
              }}
            >
              {m === "dictation" ? "Dictate" : "Chat"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Status */}
          {status !== "idle" && status !== "error" && <StatusPill status={status} />}

          {/* Error */}
          {error && (
            <button
              onClick={onClearError}
              style={{ fontSize: 11, color: "var(--rec)", cursor: "pointer", background: "none", border: "none" }}
            >
              ✕ {error.length > 24 ? error.slice(0, 24) + "…" : error}
            </button>
          )}

          {/* Clear transcript */}
          {(transcript || partial) && (
            <button
              onClick={onClearTranscript}
              style={{
                fontSize: 11, fontWeight: 500,
                color: "var(--muted)",
                cursor: "pointer",
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "2px 7px",
                transition: "color 0.12s",
                letterSpacing: "-0.01em",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--fg)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--muted)")}
            >
              clear
            </button>
          )}

          {/* Settings */}
          <button
            onClick={() => setShowSettings(true)}
            style={{
              width: 26, height: 26,
              borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "none", border: "none", cursor: "pointer",
              color: "var(--muted)", transition: "color 0.12s",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--fg)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--muted)")}
            aria-label="Settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: "12px 14px" }}>
        {appMode === "chat" ? (
          <>
            <ChatView messages={messages} streamingText={streamingText} isStreaming={isStreaming} />
            {/* Show transcript below chat if present */}
            {(transcript || partial) && (
              <div style={{
                marginTop: 8,
                padding: "8px 10px",
                borderRadius: 10,
                background: "var(--surface2)",
                fontSize: 13,
                color: "var(--fg-secondary)",
                letterSpacing: "-0.01em",
              }}>
                {transcript && <span>{transcript}</span>}
                {partial && <span className={isRecording ? "blink-cursor" : ""} style={{ fontStyle: "italic", color: "var(--muted)" }}>
                  {transcript ? " " : ""}{partial}
                </span>}
              </div>
            )}
          </>
        ) : (
          /* Dictation view */
          <div style={{ height: "100%" }}>
            {transcript || partial || isRecording ? (
              <div style={{ fontSize: 15, lineHeight: 1.6, letterSpacing: "-0.01em" }}>
                {transcript && (
                  <p style={{ color: "var(--fg)", fontWeight: 400 }}>{transcript}</p>
                )}
                {partial && (
                  <p className={isRecording ? "blink-cursor" : ""}
                    style={{ color: "var(--fg-secondary)", fontStyle: "italic", marginTop: transcript ? 6 : 0 }}>
                    {partial}
                  </p>
                )}
                {isRecording && !transcript && !partial && (
                  <p style={{ color: "var(--muted)", fontStyle: "italic" }}>Listening…</p>
                )}
              </div>
            ) : (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: "100%",
                color: "var(--muted)", fontSize: 13, letterSpacing: "-0.01em",
                fontStyle: "italic",
              }}>
                Press mic to start dictating
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Text input (chat mode) ── */}
      {appMode === "chat" && (
        <div style={{ padding: "0 14px 10px", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "var(--surface2)", borderRadius: 12,
            padding: "6px 12px",
            border: "1px solid var(--border)",
          }}>
            <input
              ref={inputRef}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming || isTranscribing}
              placeholder="Ask anything…"
              style={{
                flex: 1, background: "none", border: "none", outline: "none",
                fontSize: 13, color: "var(--fg)", letterSpacing: "-0.01em",
              }}
            />
            {inputValue.trim() && (
              <button
                onClick={() => { if (inputValue.trim()) { onSend(inputValue.trim()); setInputValue(""); } }}
                style={{
                  width: 22, height: 22, borderRadius: 7,
                  background: "var(--accent)", border: "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "#fff", flexShrink: 0,
                }}
              >
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Bottom button row ── */}
      <div
        className="flex items-center no-select flex-shrink-0"
        style={{
          padding: "10px 12px 12px",
          gap: 8,
          justifyContent: "center",
          borderTop: "1px solid var(--border)",
        }}
      >
        {/* Collapse */}
        <button className="cmd-btn" onClick={onExpand} aria-label="Collapse to small" title="Collapse">
          <CollapseIcon />
        </button>

        {/* Mic */}
        <button
          className={`cmd-btn ${isRecording ? "cmd-recording" : "cmd-idle-glow"}`}
          onClick={onMicToggle}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
        >
          {isTranscribing ? <ThinkingDots /> : isRecording ? <WaveformIcon /> : <MicIcon />}
        </button>

        {/* Insert */}
        <button
          className="cmd-btn cmd-confirm"
          onClick={onInsert}
          style={{ opacity: 1 }}
          aria-label="Insert at cursor"
          title="Insert"
        >
          <CheckIcon />
        </button>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: AppStatus }) {
  const labels: Record<AppStatus, string> = {
    idle: "", recording: "Listening", transcribing: "Transcribing",
    processing: "Polishing", thinking: "Thinking", speaking: "Speaking", error: "",
  };
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 5,
      padding: "2px 8px", borderRadius: 20,
      background: "var(--surface2)",
      fontSize: 11, fontWeight: 500,
      color: "var(--muted)", letterSpacing: "-0.01em",
    }}>
      {status === "recording"
        ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--rec)", display: "inline-block" }} />
        : status === "thinking"
          ? <ThinkingDots />
          : <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />
      }
      {labels[status]}
    </div>
  );
}

function ThinkingDots() {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <span className="dot-1" style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--muted)", display: "inline-block" }} />
      <span className="dot-2" style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--muted)", display: "inline-block" }} />
      <span className="dot-3" style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--muted)", display: "inline-block" }} />
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function MicIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <rect x="9" y="2" width="8" height="12" rx="4" stroke="currentColor" strokeWidth="2" />
      <path d="M4 13a9 9 0 0018 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="13" y1="22" x2="13" y2="24.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="9" y1="24.5" x2="17" y2="24.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function WaveformIcon() {
  return (
    <svg width="30" height="20" viewBox="0 0 30 20" fill="none">
      <rect className="wave-bar" x="0"  y="6"  width="4" height="8"  rx="2" fill="currentColor" />
      <rect className="wave-bar" x="6"  y="2"  width="4" height="16" rx="2" fill="currentColor" />
      <rect className="wave-bar" x="12" y="0"  width="4" height="20" rx="2" fill="currentColor" />
      <rect className="wave-bar" x="18" y="2"  width="4" height="16" rx="2" fill="currentColor" />
      <rect className="wave-bar" x="24" y="6"  width="4" height="8"  rx="2" fill="currentColor" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <polyline points="5,13 10.5,19 21,7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <polyline points="15,3 21,3 21,9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="9,21 3,21 3,15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="21" y1="3" x2="14" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="3" y1="21" x2="10" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <polyline points="21,9 21,3 15,3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="3,15 3,21 9,21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="14" y1="10" x2="21" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="3" y1="21" x2="10" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
      <path d="M1 11L11 1M11 1H4M11 1V8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M11.54 4.46l-1.41 1.41M4.95 11.54l-1.41 1.41"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
      <rect x="4" y="4" width="8" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M2 10V2.5A1.5 1.5 0 013.5 1H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}

function CopiedIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
      <polyline points="2,7 5.5,10.5 12,4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
