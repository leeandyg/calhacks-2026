import { resumeAudio } from "../audio/context.js";

// Browsers block audio until a user gesture, so the app starts behind this click.

export function EnterRoom({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="overlay">
      <h1>Spatial Soundscape</h1>
      <p>Put on headphones. The sound is placed around your head.</p>
      <button type="button" className="enter-room" onClick={() => void resumeAudio().then(onEnter)}>Enter room</button>
    </div>
  );
}
