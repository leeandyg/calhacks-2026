import { useEffect, useState } from 'react';
import { startWorldRestore } from './ai/managedClient.js';
import { useAudioEngine } from './audio/AudioEngine.js';
import { RoomScene } from './room/RoomScene.js';
import { PromptBar } from './ui/PromptBar.js';
import { RotationArrows } from './ui/RotationArrows.js';
import { AssetsPanel } from './ui/AssetsPanel.js';

export default function App() {
  const [hasScene, setHasScene] = useState(false);
  const [generating, setGenerating] = useState(false);
  useAudioEngine(hasScene);
  useEffect(startWorldRestore, []); // reopens kept Claude worlds after a reload or a saved room (#112)
  return <>
    {(hasScene || generating) && <RoomScene loading={!hasScene}/>}
    {hasScene && <>
      <RotationArrows/>
      <AssetsPanel/>
    </>}
    <div className={`room-controls${hasScene || generating ? '' : ' room-controls-centered'}`}>
      <PromptBar hasScene={hasScene} onSceneReady={() => setHasScene(true)} onBusyChange={setGenerating}/>
    </div>
  </>;
}
