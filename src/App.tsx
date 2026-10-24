import { useState } from 'react';
import { useAudioEngine } from './audio/AudioEngine.js';
import { RoomScene } from './room/RoomScene.js';
import { EnterRoom } from './ui/EnterRoom.js';
import { PromptBar } from './ui/PromptBar.js';
import { RotationArrows } from './ui/RotationArrows.js';

export default function App() {
  const [entered, setEntered] = useState(false);
  useAudioEngine(entered);
  return <>
    <RoomScene/>
    {entered ? <>
      <RotationArrows/>
      <div className="room-controls"><PromptBar/></div>
    </> : <EnterRoom onEnter={() => setEntered(true)}/>}
  </>;
}
