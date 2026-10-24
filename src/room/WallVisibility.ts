import { Matrix3, Vector3 } from 'three';
import { smoothstep } from './easing.js';
import type { Material, Matrix4 } from 'three';
import type { WallConfig } from './types.js';

// Scratch vectors are reused: this runs four times per rendered frame.
const center = new Vector3();
const position = new Vector3();
const normal = new Vector3();
const toCamera = new Vector3();
const normalMatrix = new Matrix3();
export function getWallOpacity(wall: WallConfig, roomMatrix: Matrix4, cameraPosition: Vector3): number {
  center.set(0, 0, 0).applyMatrix4(roomMatrix);
  position.fromArray(wall.position).applyMatrix4(roomMatrix);
  normalMatrix.getNormalMatrix(roomMatrix);
  normal.fromArray(wall.outwardNormal).applyMatrix3(normalMatrix).setY(0).normalize();
  // Orthographic rays are parallel, so the center-to-camera direction is shared
  // by every wall. The transformed position also classifies the near half-space.
  toCamera.copy(cameraPosition).sub(center).setY(0).normalize();
  const facing = normal.dot(toCamera);
  const halfSpace = position.sub(center).dot(toCamera) / Math.max(position.length(), 0.001);
  const near = (facing + halfSpace) / 2;
  return 1 - smoothstep(-0.38, 0.38, near);
}

/**
 * Fades a wall material with an ordered 4×4 Bayer screen-door instead of alpha blending: each
 * pixel of the shared pixel grid is either drawn solid or dropped, more of them as `opacity` falls.
 * Alpha-blended walls showed the side faces between their 1×1 panels in arbitrary order, and the
 * palette pass turned that into stripes mid-turn. The screen-door stays opaque and depth-correct,
 * keeps every drawn pixel in the palette, and lets props behind the wall show through the gaps.
 */
export function applyScreenDoorFade(material: Material) {
  material.transparent = false;
  material.depthWrite = true;
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        float screenDoorThreshold(vec2 pixel) {
          ivec2 cell = ivec2(mod(pixel, 4.0));
          int index = cell.x + cell.y * 4;
          float bayer[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
          return (bayer[index] + 0.5) / 16.0;
        }`)
      .replace('#include <opaque_fragment>', `if (opacity < 0.999 && opacity <= screenDoorThreshold(gl_FragCoord.xy)) discard;
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'screen-door-fade';
  material.needsUpdate = true;
}
