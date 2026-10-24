import { useState } from 'react';
import { useAudioEngine } from './audio/AudioEngine.js';
import { RoomScene } from './room/RoomScene.js';
import { PromptBar } from './ui/PromptBar.js';
import { RotationArrows } from './ui/RotationArrows.js';

export default function App() {
  const [hasScene, setHasScene] = useState(false);
  useAudioEngine(hasScene);
  return <>
    {hasScene && <>
      <RoomScene/>
      <RotationArrows/>
    </>}
    <div className={`room-controls${hasScene ? '' : ' room-controls-centered'}`}>
      <PromptBar hasScene={hasScene} onSceneReady={() => setHasScene(true)}/>
    </div>
  </>;
}
