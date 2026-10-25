// Plays one live app stream from the room helper (src/audio/live.ts, #28). Frames arrive about
// every 10 ms over a WebSocket, so it keeps ~80 ms buffered against jitter: silence until then and
// whenever it runs dry, and it skips ahead when it falls more than 300 ms behind. It resamples
// linearly if the helper's rate differs from the AudioContext's.

const TARGET_SEC = 0.08;
const MAX_SEC = 0.3;

class LiveStreamProcessor extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    this.inputRate = processorOptions.inputRate;
    this.step = this.inputRate / sampleRate;
    this.ring = new Float32Array(Math.ceil(this.inputRate)); // 1 s
    this.written = 0; // samples received in total
    this.position = 0; // read position in received samples (fractional when resampling)
    this.playing = false;
    this.ended = false;
    this.port.onmessage = ({ data }) => {
      if (data === "end") this.ended = true;
      else this.push(data);
    };
  }

  push(samples) {
    for (let i = 0; i < samples.length; i++) this.ring[(this.written + i) % this.ring.length] = samples[i];
    this.written += samples.length;
    if (this.written - this.position > MAX_SEC * this.inputRate) this.position = this.written - TARGET_SEC * this.inputRate;
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!this.playing && this.written - this.position >= TARGET_SEC * this.inputRate) this.playing = true;
    if (!this.playing) {
      out.fill(0);
      return !this.ended;
    }
    const length = this.ring.length;
    for (let i = 0; i < out.length; i++) {
      if (this.written - this.position < 2) {
        this.playing = false; // ran dry: wait for the buffer to refill
        out.fill(0, i);
        break;
      }
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      const a = this.ring[index % length];
      const b = this.ring[(index + 1) % length];
      out[i] = a + (b - a) * fraction;
      this.position += this.step;
    }
    return !this.ended;
  }
}

registerProcessor("live-stream", LiveStreamProcessor);
