import { create } from "zustand";
import type { SoundObject } from "../scene/scene.js";

// Painted art lives here, in the browser, keyed by id: the scene only names it (room.art), so
// /api/scene requests stay small. Environments come from api/environment.ts, props from api/sprite.ts.

export type Surface = "floor" | "north" | "east" | "south" | "west";
export type EnvArt = {
  id: string;
  concept: string;
  managed?: boolean;
  /** Legacy environment hint; never hides the fixed structural shell. */
  openAir?: boolean;
  animations?: Partial<Record<Surface, { frames: number; fps: number }>>;
  /** Wall tops and the floor's outer edge. */
  shell: string;
  /** The room's pixel pass quantizes to these (plus the prop palette), so paintings keep their colors. */
  colors: string[];
  terrain: number[][];
  /** PNG data URLs, filled in as each surface is painted. */
  textures: Partial<Record<Surface, string>>;
};
export type SpriteArt =
  | { status: "painting" }
  | { status: "ready"; png: string; w: number; h: number; frames?: number; fps?: number }
  | { status: "failed" };

type ArtState = {
  envs: Record<string, EnvArt>;
  sprites: Record<string, SpriteArt>;
};

export const useArtStore = create<ArtState>()(() => ({ envs: {}, sprites: {} }));

export function addEnvironment(env: EnvArt) {
  useArtStore.setState((s) => ({ envs: { ...s.envs, [env.id]: env } }));
}

export function addTexture(id: string, surface: Surface, png: string, colors: string[]) {
  useArtStore.setState((s) => {
    const env = s.envs[id];
    if (!env) return s;
    return { envs: { ...s.envs, [id]: { ...env, textures: { ...env.textures, [surface]: png }, colors: [...new Set([...env.colors, ...colors])] } } };
  });
}

export function setSprite(key: string, sprite: SpriteArt) {
  useArtStore.setState((s) => ({ sprites: { ...s.sprites, [key]: sprite } }));
}

/** One prop per object per environment; its label says what to paint. */
export function spriteKey(envId: string, object: Pick<SoundObject, "id" | "label" | "sound" | "wall">): string {
  // Managed art belongs to the canonical source, including after dragging onto/off a wall.
  if (useArtStore.getState().envs[envId]?.managed) return JSON.stringify([envId, object.id]);
  return JSON.stringify([envId, object.label, object.sound.query, object.wall ? 'wall' : 'floor']);
}

/** The prop art an object waits for before it comes out of its portal, if any. */
export function spriteFor(envId: string | undefined, object: Pick<SoundObject, "id" | "label" | "sound" | "wall">): SpriteArt | undefined {
  return envId ? useArtStore.getState().sprites[spriteKey(envId, object)] : undefined;
}
