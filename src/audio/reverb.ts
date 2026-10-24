import type { Room } from "../scene/scene.js";

// Room reverb (#12): one shared ConvolverNode that every voice sends into. Impulse responses are
// synthesized (decaying, filtered noise), so there are no files or licenses. The preset comes from
// room.reverb, which the agent picks from the prompt; it doesn't depend on the drawn room's size.
//
// Each voice sends its signal from before the panner, so the reverb level doesn't drop with
// distance while the direct sound does (inverse distance). Far sounds come out wetter, which is
// how distance sounds in a real room.

type Preset = Room["reverb"];

/**
 * decaySec: time to fall 60 dB. brightness: 0 (dark, absorbent room) to 1 (bright, hard surfaces).
 * wet: set by rendering the engine offline (brown noise, HRTF panning). For a source 1 m away the reverb
 * sits about 16 dB (small room), 14 dB (large room) or 20 dB (outdoor) below the direct sound; at 6 m
 * it's about 15 dB wetter, roughly level with the direct sound indoors.
 */
const PRESETS: Record<Exclude<Preset, "none">, { decaySec: number; brightness: number; wet: number }> = {
  "small-room": { decaySec: 0.6, brightness: 0.45, wet: 0.08 },
  "large-room": { decaySec: 1.8, brightness: 0.3, wet: 0.1 },
  outdoor: { decaySec: 0.4, brightness: 0.8, wet: 0.08 },
};

const SWAP_SEC = 0.15; // fade the wet signal out, swap the impulse response, fade back in

export class Reverb {
  /** Voices connect their reverb send here. */
  readonly input: GainNode;
  private convolver: ConvolverNode;
  private wet: GainNode;
  private preset: Preset = "none";
  private swapTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private ctx: BaseAudioContext,
    output: AudioNode,
  ) {
    this.input = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.convolver.normalize = false; // impulseResponse() already scales to unit energy
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.input.connect(this.convolver).connect(this.wet).connect(output);
  }

  setPreset(preset: Preset) {
    if (preset === this.preset) return;
    this.preset = preset;
    clearTimeout(this.swapTimer);
    this.wet.gain.setTargetAtTime(0, this.ctx.currentTime, SWAP_SEC / 3);
    if (preset === "none") return;
    const { wet } = PRESETS[preset];
    this.swapTimer = setTimeout(() => {
      this.convolver.buffer = impulseResponse(this.ctx, preset);
      this.wet.gain.setTargetAtTime(wet, this.ctx.currentTime, SWAP_SEC / 3);
    }, SWAP_SEC * 1000);
  }

  disconnect() {
    clearTimeout(this.swapTimer);
    this.wet.disconnect();
  }
}

const impulses = new WeakMap<BaseAudioContext, Map<Preset, AudioBuffer>>();

/**
 * Stereo noise with an exponential decay, darkened by a one-pole lowpass. Scaled to unit energy,
 * so the preset's wet level alone sets how loud the reverb is.
 */
export function impulseResponse(ctx: BaseAudioContext, preset: Exclude<Preset, "none">): AudioBuffer {
  let cache = impulses.get(ctx);
  if (!cache) impulses.set(ctx, (cache = new Map()));
  const cached = cache.get(preset);
  if (cached) return cached;

  const { decaySec, brightness } = PRESETS[preset];
  const rate = ctx.sampleRate;
  const length = Math.ceil(decaySec * rate);
  const buffer = ctx.createBuffer(2, length, rate);
  const fadeIn = Math.round(0.005 * rate); // no click at the start
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let low = 0;
    let energy = 0;
    for (let i = 0; i < length; i++) {
      const noise = Math.random() * 2 - 1;
      low += (0.05 + 0.9 * brightness) * (noise - low);
      const envelope = Math.exp((-6.91 * i) / length) * Math.min(1, i / fadeIn); // -60 dB at the end
      data[i] = low * envelope;
      energy += data[i] * data[i];
    }
    const scale = 1 / Math.sqrt(energy);
    for (let i = 0; i < length; i++) data[i] *= scale;
  }
  cache.set(preset, buffer);
  return buffer;
}
