// Capture continuously; downsample the browser's actual rate to mono 16 kHz PCM.
class CoachMicrophone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.chunk = new Int16Array(320);
    this.index = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const value of input) {
      this.sum += value;
      this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const sample = Math.max(-1, Math.min(1, this.sum / this.count));
        this.chunk[this.index++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
        this.sum = 0;
        this.count = 0;
        if (this.index === this.chunk.length) {
          this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
          this.chunk = new Int16Array(320);
          this.index = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('coach-microphone', CoachMicrophone);
