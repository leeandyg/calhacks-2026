import { useEffect, useState } from 'react';
import { startWorldRestore } from './ai/managedClient.js';
import { useAudioEngine } from './audio/AudioEngine.js';
import { RoomScene } from './room/RoomScene.js';
import { PromptBar } from './ui/PromptBar.js';
import { RotationArrows } from './ui/RotationArrows.js';

export default function App() {
  const [hasScene, setHasScene] = useState(false);
  useAudioEngine(hasScene);
  useEffect(startWorldRestore, []); // reopens kept Claude worlds after a reload or a saved room (#112)
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
