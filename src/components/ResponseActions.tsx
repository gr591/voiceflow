import React, { useState } from "react";
import { insertionManager } from "../insertion";
import { ttsManager } from "../speech";

interface ResponseActionsProps {
  text: string;
}

export function ResponseActions({ text }: ResponseActionsProps) {
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  async function handleCopy() {
    await insertionManager.copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleInsert() {
    await insertionManager.insertAtCursor(text);
  }

  async function handleSpeak() {
    if (speaking) { ttsManager.stop(); setSpeaking(false); return; }
    setSpeaking(true);
    await ttsManager.speak(text);
    setSpeaking(false);
  }

  return (
    <div className="flex gap-1 mt-1">
      <button onClick={handleCopy} className="action-btn">{copied ? "✓ Copied" : "Copy"}</button>
      <button onClick={handleInsert} className="action-btn">Insert</button>
      <button onClick={handleSpeak} className="action-btn">{speaking ? "■ Stop" : "Speak"}</button>
    </div>
  );
}
