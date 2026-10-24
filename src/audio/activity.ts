// Playback state is view-only. Canonical positions and volumes stay in the scene store.
const events = new Set<string>();
export const eventIsPlaying = (id: string) => events.has(id);
export const setEventPlaying = (id: string, playing: boolean) => { if (playing) events.add(id); else events.delete(id); };
