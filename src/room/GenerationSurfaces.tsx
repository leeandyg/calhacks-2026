import { useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three';
import type { RoomConfig } from './types.js';

const SHADES = ['#777b83', '#868b94', '#969aa3', '#a3a7af'];

/** A small CPU-painted mosaic; the room remains the only WebGL renderer. */
export function GenerationSurfaces({ config }: { config: RoomConfig }) {
  const [texture, setTexture] = useState<CanvasTexture>();
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return; // The plain shell is still usable without the decoration.
    context.fillStyle = '#969aa3';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const map = new CanvasTexture(canvas);
    map.minFilter = map.magFilter = NearestFilter;
    map.generateMipmaps = false;
    map.colorSpace = SRGBColorSpace;
    setTexture(map);
    return () => map.dispose();
  }, []);
  // No second GPU canvas or GPU-to-CPU readback while an AI request is pending.
  useFrame(({ clock }) => {
    if (!texture) return;
    const tick = Math.floor(clock.elapsedTime * 4);
    if (texture.userData.tick !== tick) {
      const canvas = texture.image as HTMLCanvasElement;
      const context = canvas.getContext('2d')!;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const seed = Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663);
        const phase = (seed >>> 0) % 12;
        context.fillStyle = SHADES[Math.floor((tick + phase) / 3) % SHADES.length];
        context.fillRect(x * 4, y * 4, 4, 4);
      }
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
