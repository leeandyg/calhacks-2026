import { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, InstancedMesh, Matrix4 } from 'three';
import { buildSurfacePixels, type SurfaceOpening } from './surfaces.js';
import type { Vec3 } from './types.js';

export function SurfacePixels({ width, height, palette, seed, openings, position, rotation }: {
  width: number; height: number; palette: readonly string[]; seed: number; openings?: SurfaceOpening[]; position?: Vec3; rotation?: Vec3;
}) {
  const ref = useRef<InstancedMesh>(null);
  const pixels = useMemo(() => buildSurfacePixels(width, height, seed, palette, openings), [width, height, seed, palette, openings]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    const color = new Color();
    pixels.forEach((pixel, index) => {
      mesh.setMatrixAt(index, matrix.makeScale(pixel.size, pixel.size, 1).setPosition(pixel.x, pixel.y, 0));
      mesh.setColorAt(index, color.set(pixel.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [pixels]);
  if (!pixels.length) return null;
  return <instancedMesh ref={ref} name="surface-pixels" args={[undefined, undefined, pixels.length]} position={position} rotation={rotation} userData={{ pixels: pixels.length }}>
    <planeGeometry/>
    <meshStandardMaterial roughness={1} flatShading transparent polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1}/>
  </instancedMesh>;
}
