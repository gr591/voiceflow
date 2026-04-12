// Post-processes whisper transcriptions through an LLM.
// Handles: vocabulary correction, context-aware tone, translation.
//
// Uses the bundled Qwen 0.5B model by default (no API key needed),
// falling back to the globally configured LLM provider.

import { BundledLlmProvider } from "../llm/BundledLlmProvider";
import { providerManager } from "../llm/ProviderManager";
import type { LLMRequestOptions } from "../llm/types";

// Singleton bundled provider used only for post-processing
const _bundled = new BundledLlmProvider();

export interface PostProcessOptions {
  fixVocabulary: boolean;
  autoTone: boolean;
  appName: string | null;
  targetLanguage: string; // "" = no translation
  useBundled?: boolean;   // true = use bundled Qwen model, false = use global LLM
}

// Map process/app names to tone descriptions
function getToneForApp(appName: string): string {
  const n = appName.toLowerCase();
  if (/slack|discord|teams|telegram|whatsapp|messenger|signal/.test(n))
    return "casual and conversational — short sentences, natural language, can use contractions";
  if (/outlook|thunderbird|gmail|fastmail|protonmail|mail/.test(n))
    return "professional and formal — polite, well-structured sentences";
  if (/code|vim|nvim|rider|idea|intellij|pycharm|eclipse|xcode|sublime|cursor/.test(n))
    return "technical and precise — exact terminology, concise phrasing";
  if (/word|docs|notion|confluence|pages|libreoffice|writer/.test(n))
    return "clear and well-structured — complete sentences, good paragraph flow";
  if (/twitter|x\.exe|instagram|linkedin|facebook/.test(n))
    return "engaging and concise — natural, punchy phrasing for social media";
  return "clear and natural";
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  zh: "Chinese (Simplified)",
  ja: "Japanese",
  ko: "Korean",
  pt: "Portuguese",
  it: "Italian",
  ru: "Russian",
  ar: "Arabic",
  hi: "Hindi",
  nl: "Dutch",
  sv: "Swedish",
  pl: "Polish",
  tr: "Turkish",
};

export const SUPPORTED_LANGUAGES = Object.entries(LANGUAGE_NAMES).map(
  ([value, label]) => ({ value, label })
);

export async function postProcess(
  text: string,
  options: PostProcessOptions
): Promise<string> {
  if (!text.trim()) return text;

  const instructions: string[] = [];

  if (options.fixVocabulary) {
    instructions.push(
      "Fix voice-to-text transcription errors: correct tech/domain terminology " +
      "(e.g. 'SAS' → 'SaaS', 'react' → 'React', 'open eye' → 'OpenAI', " +
      "'git hub' → 'GitHub', 'type script' → 'TypeScript', 'java script' → 'JavaScript', " +
      "'kubernetes' → 'Kubernetes', 'aws' → 'AWS', 'api' → 'API', 'ui' → 'UI'). " +
      "Fix punctuation and capitalisation. Preserve the original meaning exactly."
    );
  }

  if (options.autoTone && options.appName) {
    const tone = getToneForApp(options.appName);
    instructions.push(`Adapt the style to be ${tone}.`);
  }

  if (options.targetLanguage && options.targetLanguage !== "en") {
    const langName = LANGUAGE_NAMES[options.targetLanguage] ?? options.targetLanguage;
    instructions.push(`Translate the final text to ${langName}.`);
  }

  if (instructions.length === 0) return text;

  const systemPrompt =
    "You are a voice transcription post-processor. Apply the following instructions to the user's text, then return ONLY the result — no explanation, no quotes, no markdown:\n" +
    instructions.map((s, i) => `${i + 1}. ${s}`).join("\n");

  const opts: LLMRequestOptions = { systemPrompt, maxTokens: 1024, temperature: 0.2 };

  // Prefer the bundled model so post-processing works without any API key.
  // Fall back to the globally configured provider if bundled isn't available.
  const provider = options.useBundled !== false ? _bundled : null;

  let result = "";
  try {
    const stream = provider
      ? provider.stream([{ role: "user", content: text }], opts)
      : providerManager.stream([{ role: "user", content: text }], opts);
    for await (const ev of stream) {
      if (ev.type === "text_delta" && ev.text) result += ev.text;
    }
  } catch {
    return text; // graceful fallback — return original if LLM fails
  }

  return result.trim() || text;
}
