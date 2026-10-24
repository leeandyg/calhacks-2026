// Portal "swoosh" one-shot. The sound is authored with chirp (scripts/swoosh.cx.js) and built to
// public/swoosh.wav. Browsers block audio before a user gesture, so the very first load swoosh may
// be silent; it becomes reliable once the user has touched the page (see the unlock listener below).

type WebkitWindow = typeof window & { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | undefined;
let loading: Promise<AudioBuffer | undefined> | undefined;

function context(): AudioContext {
  const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext!;
  return (ctx ??= new Ctor());
}

function load(): Promise<AudioBuffer | undefined> {
  return (loading ??= fetch('/swoosh.wav')
    .then(res => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`swoosh ${res.status}`))))
    .then(data => context().decodeAudioData(data))
    .catch(() => undefined));
}

export function unlockAudio(): void {
  const c = context();
  if (c.state === 'suspended') void c.resume();
}

export function playSwoosh(): void {
  const c = context();
  if (c.state === 'suspended') void c.resume();
  void load().then(buf => {
    if (!buf || c.state !== 'running') return;
    const source = c.createBufferSource();
    source.buffer = buf;
    const gain = c.createGain();
    gain.gain.value = 0.5;
    source.connect(gain).connect(c.destination);
    source.start();
  });
}

// Resume the context on the first user gesture so later spawns are audible.
if (typeof window !== 'undefined') {
  const unlock = () => {
    unlockAudio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}
