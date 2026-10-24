import type { RoomConfig } from './types.js';
import { Block } from './Block.js';
import { ROOM_FRAME } from '../scene/layout.js';
import { SurfacePixels } from './SurfacePixels.js';

export function Floor({ config }: { config: RoomConfig }) {
  const { width, depth } = config.dimensions;
  const { columns, rows } = config.grid;
  const thickness = ROOM_FRAME.floorDepth;
  const outerWidth = width + 2 * ROOM_FRAME.floorOverhang;
  const outerDepth = depth + 2 * ROOM_FRAME.floorOverhang;
  const { surface, detailPalette } = config.theme;
  return <group name="floor" userData={{ columns, rows, modules: columns * rows }}>
    <group name="floor-slab" userData={{ thickness, surface }}>
      {[-1, 1].map(side => <group key={side}>
        <Block position={[0, -thickness / 2, side * (depth / 2 + thickness / 4)]} size={[outerWidth, thickness, thickness / 2]} color={surface}/>
        <Block position={[side * (width / 2 + thickness / 4), -thickness / 2, 0]} size={[thickness / 2, thickness, depth]} color={surface}/>
      </group>)}
    </group>
    <group name="floor-modules">
      {Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) =>
        <group key={`${row}-${column}`} name={`floor-${column}-${row}`} position={[column + 0.5 - columns / 2, 0, row + 0.5 - rows / 2]}>
          <Block position={[0, -thickness / 2, 0]} size={[1, thickness, 1]} color={surface}/>
        </group>))}
    </group>
    <SurfacePixels width={width} height={depth} seed={11} palette={detailPalette} position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}/>
    {[0, 1, 2, 3].map(side => <group key={side} rotation={[0, side * Math.PI / 2, 0]}>
      <SurfacePixels width={side % 2 ? outerDepth : outerWidth} height={thickness} seed={30 + side} palette={detailPalette} position={[0, -thickness / 2, (side % 2 ? outerWidth : outerDepth) / 2 + 0.002]}/>
    </group>)}
  </group>;
}
