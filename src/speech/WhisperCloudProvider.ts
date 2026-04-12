import type { STTError, STTProvider } from "./types";
import { MicCapture } from "./MicCapture";

export class WhisperCloudProvider implements STTProvider {
  readonly name = "whisper-cloud";
  private capture = new MicCapture();
  private partialCbs: Array<(text: string) => void> = [];
  private errorCbs: Array<(error: STTError) => void> = [];
  private _recording = false;

  constructor(private apiKey: string, private model = "whisper-1") {}

  async start(): Promise<void> {
    this._recording = true;
    await this.capture.start();
  }

  async stop(): Promise<string> {
    this._recording = false;
    const blob = await this.capture.stop();

    const formData = new FormData();
    formData.append("file", blob, "audio.webm");
    formData.append("model", this.model);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Whisper API error: ${err}`);
    }

    const data = await res.json() as { text: string };
    return data.text;
  }

  onPartialResult(cb: (text: string) => void): void { this.partialCbs.push(cb); }
  onError(cb: (error: STTError) => void): void { this.errorCbs.push(cb); }
  isRecording(): boolean { return this._recording; }
}
