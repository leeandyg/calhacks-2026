import { useEffect, useState } from 'react';
import { startWorldRestore } from './ai/managedClient.js';
import { useAudioEngine } from './audio/AudioEngine.js';
import { RoomScene } from './room/RoomScene.js';
import { PromptBar } from './ui/PromptBar.js';
import { RotationArrows } from './ui/RotationArrows.js';
import { AssetsPanel } from './ui/AssetsPanel.js';
import { SettingsPanel } from './ui/SettingsPanel.js';
import { PlacesPanel } from './ui/PlacesPanel.js';

export default function App() {
  const [sidebarPlacesTarget, setSidebarPlacesTarget] = useState<HTMLDivElement | null>(null);
  const [initialPlacesTarget, setInitialPlacesTarget] = useState<HTMLDivElement | null>(null);
  const [templatesTarget, setTemplatesTarget] = useState<HTMLDivElement | null>(null);
  const [voiceControlsTarget, setVoiceControlsTarget] = useState<HTMLDivElement | null>(null);
  const [hasScene, setHasScene] = useState(false);
  const [generating, setGenerating] = useState(false);
  useAudioEngine(hasScene);
  useEffect(startWorldRestore, []); // reopens kept Claude worlds after a reload or a saved room (#112)
  return <>
    {(hasScene || generating) && <RoomScene loading={!hasScene}/>}
    <div className={`places-dock${hasScene ? "" : " places-dock-hidden"}`}>
      <div className="templates-slot" ref={setTemplatesTarget}/>
      <div className="places-slot" ref={setSidebarPlacesTarget}/>
    </div>
    <PlacesPanel target={hasScene ? sidebarPlacesTarget : initialPlacesTarget} hasScene={hasScene} onReset={() => setHasScene(false)} onLoad={() => setHasScene(true)}/>
    {hasScene && <>
      <RotationArrows/>
      <div className="assets-dock">
        <AssetsPanel/>
        <SettingsPanel voiceControlsRef={setVoiceControlsTarget}/>
      </div>
    </>}
    <div className={`room-controls${hasScene || generating ? '' : ' room-controls-centered'}`}>
      <PromptBar templatesTarget={templatesTarget} voiceSettingsTarget={voiceControlsTarget} hasScene={hasScene} onSceneReady={() => setHasScene(true)} onBusyChange={setGenerating}/>
      <div className="initial-places-slot" ref={setInitialPlacesTarget}/>
    </div>
  </>;
}
