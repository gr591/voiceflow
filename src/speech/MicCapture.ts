export class MicCapture {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start(250); // collect chunks every 250ms
  }

  async stop(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) { resolve(new Blob()); return; }
      this.mediaRecorder.onstop = () => {
        resolve(new Blob(this.chunks, { type: "audio/webm" }));
        // Stop all mic tracks
        this.mediaRecorder?.stream.getTracks().forEach(t => t.stop());
      };
      this.mediaRecorder.stop();
    });
  }
}
