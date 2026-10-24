import { createContext, useContext, useRef, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box3, Vector3 } from 'three';
import { useSoundStatus } from '../audio/generated.js';
import { useSceneStore } from '../scene/store.js';

// "Cat purring · generating…" over a prop while its sound is generated with ElevenLabs (#38).
// The labels are DOM, drawn over the pixel canvas; a tracker inside the canvas moves each one to
// the top of its prop every frame, so they follow drags and room turns.

const LabelLayer = createContext<RefObject<HTMLDivElement | null> | null>(null);

export function SoundStatusProvider({ children }: { children: ReactNode }) {
  const layer = useRef<HTMLDivElement>(null);
  return <LabelLayer.Provider value={layer}>{children}<SoundStatusLayer layer={layer}/></LabelLayer.Provider>;
}

function SoundStatusLayer({ layer }: { layer: RefObject<HTMLDivElement | null> }) {
  const objects = useSceneStore(state => state.scene.objects);
  const status = useSoundStatus();
  const labelled = objects.filter(object => object.sound.assetId && status[object.sound.assetId]);
  return <div ref={layer} className="sound-status-layer" aria-live="polite">
    {labelled.map(object => {
      const failed = status[object.sound.assetId!] === 'failed';
      return <div key={object.id} data-sound-id={object.id} className={`sound-status${failed ? ' sound-status-failed' : ''}`}>
        {object.label} · {failed ? 'using the closest sound' : 'generating…'}
      </div>;
    })}
  </div>;
}

const box = new Box3();
const top = new Vector3();
/** Lives inside the Canvas. */
export function SoundStatusTracker() {
  const layer = useContext(LabelLayer);
  useFrame(({ scene, camera, gl }) => {
    const labels = layer?.current?.children;
    if (!labels?.length) return;
    const bounds = gl.domElement.getBoundingClientRect();
    for (const label of labels as HTMLCollectionOf<HTMLElement>) {
      const prop = scene.getObjectByName(`sound-${label.dataset.soundId}`);
      if (!prop) { label.style.visibility = 'hidden'; continue; }
      box.setFromObject(prop);
      if (box.isEmpty()) { label.style.visibility = 'hidden'; continue; }
      top.set((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).project(camera);
      label.style.visibility = 'visible';
      label.style.transform = `translate(${bounds.left + (top.x + 1) / 2 * bounds.width}px, ${bounds.top + (1 - top.y) / 2 * bounds.height}px) translate(-50%, calc(-100% - 6px))`;
    }
  });
  return null;
}
