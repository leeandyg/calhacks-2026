import { createContext, useContext, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, Group } from 'three';
import { useSceneStore } from '../../store/useSceneStore';
import type { RoomPreset } from '../../shared/scene';
import { playSwoosh } from '../../utils/swoosh';

// Objects do not just appear: a pixel portal opens at each one's spot and the sound pops out of it
// with a swoosh. On load the existing objects spawn one by one; new objects spawn the same way.
// It is a transient spawn effect for sources, drawn inside the sound-objects group so the shared
// pixel grid and palette cover it; its colors are taken from the environment, never a fixed hue.

// Spawn choreography, in seconds.
export const SPAWN_STAGGER = 0.16; // gap between objects on the initial reveal
export const SPAWN_EMERGE_DELAY = 0.18; // when the object starts scaling up (and the swoosh fires)
export const SPAWN_EMERGE_SPAN = 0.34; // how long the object takes to fully emerge
const PORTAL_OPEN = 0.22;
const PORTAL_CLOSE_START = 0.46;
const PORTAL_CLOSE_SPAN = 0.3;
export const SPAWN_TOTAL = PORTAL_CLOSE_START + PORTAL_CLOSE_SPAN; // per-object lifetime

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};

// Portal colors are pulled from the pxl palette per environment, so the rift reads as part of the
// room instead of a foreign purple. The core is always the palette's darkest value (the "void").
const CORE = '#11171e';
const PALETTES: Record<RoomPreset, { rim: string; mid: string }> = {
  forest: { rim: '#b1b79c', mid: '#7d8f75' },
  cabin: { rim: '#c2b186', mid: '#a97e42' },
  cafe: { rim: '#9cb1aa', mid: '#677367' },
  bedroom: { rim: '#bdbab1', mid: '#858886' },
  library: { rim: '#a6bbb5', mid: '#809e95' },
};
export const portalColors = (preset: RoomPreset) => ({ ...PALETTES[preset], core: CORE });

export type Schedule = Map<string, number>; // object id -> spawn start time (elapsed seconds)
const SpawnContext = createContext<{ current: Schedule } | null>(null);

export function SpawnProvider({ children }: { children: ReactNode }) {
  const schedule = useRef<Schedule>(new Map());
  return <SpawnContext.Provider value={schedule}>{children}</SpawnContext.Provider>;
}

/** The shared id -> start-time map. Read `.current.get(id)` inside a useFrame. */
export function useSpawnSchedule(): { current: Schedule } {
  return useContext(SpawnContext)!;
}

// Hands each object a spawn start time (staggered on the first reveal, immediate afterwards),
// and fires the swoosh the moment it starts rising out of its portal. Lives inside the Canvas.
export function SpawnController() {
  const schedule = useSpawnSchedule();
  const swooshed = useRef<Set<string>>(new Set());
  const lastStart = useRef(0);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const objects = useSceneStore.getState().scene.objects;
    const ids = new Set(objects.map(o => o.id));
    for (const id of [...schedule.current.keys()]) {
      if (!ids.has(id)) { schedule.current.delete(id); swooshed.current.delete(id); }
    }
    for (const o of objects) {
      if (!schedule.current.has(o.id)) {
        const start = Math.max(t, lastStart.current + SPAWN_STAGGER);
        schedule.current.set(o.id, start);
        lastStart.current = start;
      }
    }
    for (const [id, start] of schedule.current) {
      if (!swooshed.current.has(id) && t >= start + SPAWN_EMERGE_DELAY) {
        swooshed.current.add(id);
        playSwoosh();
      }
    }
    // Dev/e2e: true while any object is still portaling in, so scripts can wait before interacting.
    if (import.meta.env.DEV) {
      const busy = objects.some(o => {
        const s = schedule.current.get(o.id);
        return s === undefined || t < s + SPAWN_TOTAL;
      });
      (window as typeof window & { __spawnBusy?: boolean }).__spawnBusy = busy;
    }
  });
  return null;
}

// A pixel portal (concentric rings + dark core), billboarded to the camera, opening then closing.
// Rendered among the sources so the whole-room pixel pass and palette map it like everything else.
export function SpawnPortal({ id, position, scale, preset }: {
  id: string;
  position: [number, number, number];
  scale: number;
  preset: RoomPreset;
}) {
  const group = useRef<Group>(null);
  const schedule = useSpawnSchedule();
  const colors = portalColors(preset);
  useFrame(({ clock, camera }) => {
    const g = group.current;
    if (!g) return;
    const start = schedule.current.get(id);
    const t = start === undefined ? undefined : clock.elapsedTime - start;
    if (t === undefined || t > SPAWN_TOTAL) { g.visible = false; return; }
    g.visible = true;
    g.quaternion.copy(camera.quaternion); // billboard toward the iso camera
    const open = easeOutBack(clamp01(t / PORTAL_OPEN));
    const closing = clamp01((t - PORTAL_CLOSE_START) / PORTAL_CLOSE_SPAN);
    const s = open * (1 + closing * 0.35);
    g.scale.set(s * scale, s * 1.25 * scale, s * scale);
    const opacity = clamp01(t / 0.14) * (1 - closing);
    g.traverse(child => {
      const mat = (child as { material?: { opacity: number } }).material;
      if (mat) mat.opacity = opacity;
    });
  });
  return (
    <group ref={group} name={`portal-${id}`} position={position} visible={false}>
      <mesh position={[0, 0, 0]}>
        <circleGeometry args={[0.46, 28]} />
        <meshBasicMaterial color={colors.core} transparent opacity={0} side={DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0, 0.01]}>
        <ringGeometry args={[0.34, 0.52, 36]} />
        <meshBasicMaterial color={colors.mid} transparent opacity={0} side={DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0, 0.02]}>
        <ringGeometry args={[0.5, 0.66, 36]} />
        <meshBasicMaterial color={colors.rim} transparent opacity={0} side={DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}
