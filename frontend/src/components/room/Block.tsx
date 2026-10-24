import type { Vec3 } from '../../types/room';
export function Block({ position = [0, 0, 0], size, color, rotation, emissive }: { position?: Vec3; size: Vec3; color: string; rotation?: Vec3; emissive?: string }) {
  return <mesh position={position} rotation={rotation}><boxGeometry args={size}/><meshStandardMaterial color={color} roughness={0.92} flatShading emissive={emissive} emissiveIntensity={emissive ? 0.3 : 0}/></mesh>;
}
