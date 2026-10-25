import { createContext, useContext, useRef, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box3, Vector3 } from 'three';
import { useSoundStatus } from '../audio/generated.js';
import { useSceneStore } from '../scene/store.js';
import { spriteKey, useArtStore } from '../art/store.js';
import { useRoomStore } from './useRoomStore.js';

// Show the hovered sound's name and any pending generation status above its prop.
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
  const envId = useSceneStore(state => state.scene.room.art);
  const sprites = useArtStore(state => state.sprites);
  const hovered = useRoomStore(state => state.hoveredObjectId);
  const labelled = objects.filter(object => object.id === hovered || (object.sound.assetId && status[object.sound.assetId]) || (envId && sprites[spriteKey(envId, object)]?.status === 'painting'));
  return <div ref={layer} className="sound-status-layer" aria-live="polite">
    {labelled.map(object => {
      const painting = envId && sprites[spriteKey(envId, object)]?.status === 'painting';
      const failed = !painting && status[object.sound.assetId!] === 'failed';
      const pending = painting || status[object.sound.assetId!] === 'generating';
      return <div key={object.id} data-sound-id={object.id} role={object.id === hovered ? 'tooltip' : undefined} className={`sound-status${object.id === hovered ? ' sound-name' : ''}${failed ? ' sound-status-failed' : ''}`}>
        {object.label}{failed ? ' · using the closest sound' : pending ? ' · generating…' : ''}
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
      const source = scene.getObjectByName(`sound-${label.dataset.soundId}`);
      const prop = source?.scale.x ? source : scene.getObjectByName(`portal-${label.dataset.soundId}`);
      if (!prop) { label.style.visibility = 'hidden'; continue; }
      box.setFromObject(prop);
      if (box.isEmpty()) { label.style.visibility = 'hidden'; continue; }
      let left = Infinity, right = -Infinity, above = Infinity;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        top.set(x, y, z).project(camera);
        left = Math.min(left, top.x); right = Math.max(right, top.x); above = Math.min(above, 1 - top.y);
      }
      label.style.visibility = 'visible';
      label.style.transform = `translate(${bounds.left + ((left + right) / 2 + 1) / 2 * bounds.width}px, ${bounds.top + above / 2 * bounds.height}px) translate(-50%, calc(-100% - 6px))`;
    }
  });
  return null;
}
