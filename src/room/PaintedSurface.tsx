import { useEffect, useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute, NearestFilter, SRGBColorSpace, TextureLoader } from 'three';

// All painting stays inside the live room's shared pixel pass. UV rectangles let floor cells
// rise independently and wall panels leave real openings without repainting the PNG.
export function usePaintTexture(png: string | undefined) {
  const texture = useMemo(() => {
    if (!png) return undefined;
    const value = new TextureLoader().load(png);
    value.magFilter = value.minFilter = NearestFilter;
    value.generateMipmaps = false;
    value.colorSpace = SRGBColorSpace;
    return value;
  }, [png]);
  useEffect(() => () => texture?.dispose(), [texture]);
  return texture;
}

export function PaintedSurface({ png, cells, width, height, depth }: {
  png: string; cells: { column: number; level: number }[]; width: number; height: number; depth: number;
}) {
  const texture = usePaintTexture(png);
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
    <meshStandardMaterial map={texture} roughness={1} flatShading/>
  </mesh>;
}
