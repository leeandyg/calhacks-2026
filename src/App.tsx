import { useState } from "react";
import { useAudioEngine } from "./audio/AudioEngine.js";
import { Room } from "./room/Room.js";
import { EnterRoom } from "./ui/EnterRoom.js";
import { PromptBar } from "./ui/PromptBar.js";

export function App() {
  const [entered, setEntered] = useState(false);
  useAudioEngine(entered);

  return (
    <div className="app">
      <Room />
      {entered ? <PromptBar /> : <EnterRoom onEnter={() => setEntered(true)} />}
    </div>
  );
}
