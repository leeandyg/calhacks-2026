// Temporary voice attenuation, separate from every saved scene volume/mute.
const holders = new Set<symbol>();
const listeners = new Set<(gain: number) => void>();
export const soundscapeGain = () => holders.size ? 0.25 : 1; // -12 dB during voice
function notify() { for (const listener of listeners) listener(soundscapeGain()); }
export function subscribeDucking(listener: (gain: number) => void) {
  listeners.add(listener); listener(soundscapeGain());
  return () => { listeners.delete(listener); };
}
export function duckSoundscape() {
  const holder = Symbol(); holders.add(holder); notify();
  return () => { if (holders.delete(holder)) notify(); };
}
