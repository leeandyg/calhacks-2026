import { Matrix3, Vector3 } from 'three';
import { smoothstep } from '../../utils/easing';
import type { Matrix4 } from 'three';
import type { WallConfig } from '../../types/room';

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
