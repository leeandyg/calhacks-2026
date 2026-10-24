// One AudioContext for the whole app. Browsers start it suspended until a user gesture,
// so the "Enter room" click calls resumeAudio().

let ctx: AudioContext | undefined;

export function getAudioContext(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

export function resumeAudio(): Promise<void> {
  return getAudioContext().resume();
}
