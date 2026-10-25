import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { createInstance, destroyInstance, PRESETS } from 'img-fx';
import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three';
import type { RoomConfig } from './types.js';

/** The ImageGeneration shader, mapped onto real room surfaces instead of DOM cards. */
export function GenerationSurfaces({ config }: { config: RoomConfig }) {
  const [texture, setTexture] = useState<CanvasTexture>();
  const source = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = document.createElement('canvas');
    const instance = createInstance({ canvas, cssWidth: 320, cssHeight: 320,
      preset: PRESETS['pixels-organic'].modes.dark });
    source.current = canvas;
    // img-fx sizes its output on the first frame (and for display DPR). Keep the
    // GPU texture dimensions fixed, and composite its translucent mosaic over gray.
    const buffer = document.createElement('canvas');
    buffer.width = buffer.height = 320;
    const map = new CanvasTexture(buffer);
    map.minFilter = map.magFilter = NearestFilter;
    map.generateMipmaps = false;
    map.colorSpace = SRGBColorSpace;
    setTexture(map);
    return () => { source.current = null; destroyInstance(instance); map.dispose(); };
  }, []);
  // img-fx paints at 10 fps; upload on that same cadence to the shared pixel renderer.
  useFrame(({ clock }) => {
    if (!texture || !source.current) return;
    const tick = Math.floor(clock.elapsedTime * 10);
    if (texture.userData.tick !== tick) {
      const buffer = texture.image as HTMLCanvasElement;
      const context = buffer.getContext('2d')!;
      context.fillStyle = PRESETS['pixels-organic'].modes.dark.cardBg;
      context.fillRect(0, 0, buffer.width, buffer.height);
      context.imageSmoothingEnabled = false;
      context.drawImage(source.current, 0, 0, buffer.width, buffer.height);
      texture.needsUpdate = true;
      texture.userData.tick = tick;
    }
  });
  if (!texture) return null;
  const { width, depth, height, wallThickness } = config.dimensions;
  return <group name="generation-surfaces">
    <mesh name="generating-floor" position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width - wallThickness, depth - wallThickness]}/>
      <meshBasicMaterial map={texture} toneMapped={false}/>
    </mesh>
    {config.walls.filter(wall => wall.id === 'north' || wall.id === 'west').map(wall =>
      <group key={wall.id} position={wall.position} rotation={[0, wall.rotation, 0]}>
        <mesh name={`generating-${wall.id}`} position={[0, height / 2, wallThickness / 2 + 0.006]}>
          <planeGeometry args={[wall.width - wallThickness, height]}/>
          <meshBasicMaterial map={texture} toneMapped={false}/>
        </mesh>
      </group>)}
  </group>;
}
