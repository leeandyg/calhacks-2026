import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferGeometry, Float32BufferAttribute, NearestFilter, SRGBColorSpace, Texture } from 'three';
import { loadPaintImage, paintImage } from '../art/images.js';

// All painting stays inside the live room's shared pixel pass. UV rectangles let floor cells
// rise independently and wall panels leave real openings without repainting the PNG.
export function usePaintTexture(png: string | undefined, animation?: { frames: number; fps: number }, enabled: () => boolean = () => true, resetWhenPaused = false) {
  const elapsed = useRef(0);
  const frames = animation?.frames ?? 1;
  const texture = useMemo(() => {
    if (!png) return undefined;
    const image = paintImage(png);
    const value = new Texture(image);
    if (image) value.needsUpdate = true;
    value.magFilter = value.minFilter = NearestFilter;
    value.generateMipmaps = false;
    value.colorSpace = SRGBColorSpace;
    value.repeat.x = 1 / frames;
    return value;
  }, [png, frames]);
  useEffect(() => {
    if (!png || !texture || texture.image) return;
    let cancelled = false;
    void loadPaintImage(png).then(image => {
      if (!cancelled) { texture.image = image; texture.needsUpdate = true; }
    }).catch(() => console.warn('Generated artwork could not be loaded.'));
    return () => { cancelled = true; };
  }, [png, texture]);
  useFrame((_, delta) => {
    if (!texture || frames <= 1) return;
    if (enabled()) elapsed.current += delta;
    else if (resetWhenPaused) elapsed.current = 0;
    texture.offset.x = Math.floor(elapsed.current * (animation?.fps ?? 10)) % frames / frames;
  });
  useEffect(() => () => texture?.dispose(), [texture]);
  return texture;
}

export function PaintedSurface({ png, cells, width, height, depth, animation }: {
  png: string; animation?: { frames: number; fps: number }; cells: { column: number; level: number }[]; width: number; height: number; depth: number;
}) {
  const texture = usePaintTexture(png, animation);
  const geometry = useMemo(() => {
    const positions: number[] = [], uvs: number[] = [];
    for (const { column: x, level: y } of cells) {
      const left = x - width / 2, right = left + 1;
      positions.push(left, y, depth, right, y, depth, right, y + 1, depth,
        left, y, depth, right, y + 1, depth, left, y + 1, depth);
      uvs.push(x / width, y / height, (x + 1) / width, y / height, (x + 1) / width, (y + 1) / height,
        x / width, y / height, (x + 1) / width, (y + 1) / height, x / width, (y + 1) / height);
    }
    const result = new BufferGeometry();
    result.setAttribute('position', new Float32BufferAttribute(positions, 3));
    result.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    result.computeVertexNormals();
    return result;
  }, [cells, width, height, depth]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh name="painted-wall" geometry={geometry}>
    <meshStandardMaterial map={texture} transparent alphaTest={0.15} roughness={1} flatShading/>
  </mesh>;
}
