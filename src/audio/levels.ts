// Live loudness per sound object, for visuals (#80): the room view calls soundLevel(id) each frame,
// e.g. in useFrame, and scales or pulses the prop by it. It measures what the object emits (after
// its volume and mute, before distance and panning), so the silence before a clip's first sample,
// a gap between events and a muted object all read near 0. It is not a store, so reading it never
// re-renders anything.

const FLOOR_DB = -60; // at or below: 0
const CEILING_DB = -18; // at or above: 1 (pack sounds sit near -20 LUFS at full volume)
const ATTACK_SEC = 0.03; // rises fast, so a cup clink shows right away
const RELEASE_SEC = 0.25; // falls slower, so a short click is a visible pulse, not a flicker

type Meter = { analyser: AnalyserNode; samples: Float32Array<ArrayBuffer>; level: number; readAt: number };
const meters = new Map<string, Meter>();

export function addMeter(id: string, analyser: AnalyserNode) {
  const samples = new Float32Array(analyser.fftSize);
  meters.set(id, { analyser, samples, level: 0, readAt: analyser.context.currentTime });
}

/** Only removes the meter if it is still this analyser's (a recreated voice may have replaced it). */
export function removeMeter(id: string, analyser: AnalyserNode) {
  if (meters.get(id)?.analyser === analyser) meters.delete(id);
}

/** 0 (silent, muted or unknown id) to 1 (loud), smoothed: fast rise, slower fall. */
export function soundLevel(id: string): number {
  const meter = meters.get(id);
  if (!meter) return 0;
  meter.analyser.getFloatTimeDomainData(meter.samples);
  let sum = 0;
  for (const sample of meter.samples) sum += sample * sample;
  const db = 20 * Math.log10(Math.sqrt(sum / meter.samples.length) || 1e-9);
  const target = Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEILING_DB - FLOOR_DB)));
  const now = meter.analyser.context.currentTime;
  const dt = Math.max(0, now - meter.readAt);
  meter.readAt = now;
  const timeConstant = target > meter.level ? ATTACK_SEC : RELEASE_SEC;
  meter.level += (target - meter.level) * (1 - Math.exp(-dt / timeConstant));
  return meter.level;
}
