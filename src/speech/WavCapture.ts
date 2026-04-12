/**
 * Captures microphone audio as a 16 kHz mono 16-bit PCM WAV buffer.
 * Required by whisper.cpp which expects this exact format.
 *
 * Also implements simple energy-based VAD: fires onAutoStop after 1.4 s of
 * silence that follows at least one detected voice burst.
 */
export class WavCapture {
  private ctx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private samples: Float32Array[] = [];
  private sampleRate = 16000;

  // VAD state
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private hadVoice = false;

  async start(onAutoStop?: () => void): Promise<void> {
    this.samples = [];
    this.hadVoice = false;
    this.silenceTimer = null;

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Use 16 kHz if the browser supports it.
    this.ctx = new AudioContext({ sampleRate: this.sampleRate });
    this.sampleRate = this.ctx.sampleRate;

    this.source = this.ctx.createMediaStreamSource(this.stream);
    // bufferSize 4096 gives ~250 ms chunks at 16 kHz
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      this.samples.push(new Float32Array(data));

      if (!onAutoStop) return;

      // RMS energy
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);

      const VOICE_THRESHOLD   = 0.008; // RMS above this = voice
      const SILENCE_DELAY_MS  = 1400;  // silence duration before auto-stop

      if (rms > VOICE_THRESHOLD) {
        // Voice detected: cancel any pending silence timer
        this.hadVoice = true;
        if (this.silenceTimer !== null) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
      } else if (this.hadVoice && this.silenceTimer === null) {
        // First silent chunk after voice — start countdown
        this.silenceTimer = setTimeout(() => {
          this.silenceTimer = null;
          onAutoStop();
        }, SILENCE_DELAY_MS);
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
  }

  stop(): ArrayBuffer {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    this.ctx?.close();

    // Flatten samples
    const total = this.samples.reduce((n, s) => n + s.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.samples) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    // Resample to 16 kHz. WKWebView on macOS ignores the AudioContext sampleRate
    // hint and runs at the hardware rate (usually 48 kHz); older whisper.cpp
    // builds from Homebrew don't auto-resample and return empty output for
    // non-16 kHz input. Doing it here makes the WAV format deterministic.
    const TARGET_RATE = 16000;
    const out = this.sampleRate === TARGET_RATE
      ? merged
      : resampleLinear(merged, this.sampleRate, TARGET_RATE);

    return encodeWav(out, TARGET_RATE);
  }
}

/**
 * Linear-interpolation resampler. Sufficient quality for speech recognition
 * (whisper handles up to ~8 kHz content, half the 16 kHz rate).
 */
function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcIdx - lo;
    out[i] = samples[lo] * (1 - frac) + samples[hi] * frac;
  }
  return out;
}

/** Encode Float32 PCM samples as a 16-bit mono WAV ArrayBuffer. */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = samples.length;
  const buf = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buf);

  function writeStr(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, 1, true);            // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, numSamples * 2, true);

  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    off += 2;
  }

  return buf;
}
