// Mono mic PCM only. No recordings are stored; batches go to the active voice socket.
class VoicePCM extends AudioWorkletProcessor {
  constructor() {
    super(); this.samples = new Int16Array(1600); this.offset = 0;
    this.port.onmessage = ({ data }) => {
      if (data === "flush") {
        if (this.offset) this.port.postMessage(this.samples.slice(0, this.offset).buffer);
        this.offset = 0; this.port.postMessage({ flushed: true });
      }
    };
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) for (const sample of channel) {
      const value = Math.max(-1, Math.min(1, sample));
      this.samples[this.offset++] = value < 0 ? value * 32768 : value * 32767;
      if (this.offset === this.samples.length) {
        this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
        this.samples = new Int16Array(1600); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("voice-pcm", VoicePCM);
