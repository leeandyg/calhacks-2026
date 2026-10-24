import { create } from 'zustand';
import { soundscapes } from '../config/soundscapes';
import { applySceneOperations } from '../shared/operations';
import { ZodError } from 'zod';
import { EditSceneSchema, ListenerSchema, SceneSchema, clampScene, type MutationResult, type Scene } from '../shared/scene';

const prepare = (input: unknown) => {
  return clampScene(SceneSchema.parse(input));
};
const failure = (error: unknown): MutationResult => ({ ok: false, error: error instanceof ZodError ? error.issues[0]?.message ?? 'Invalid scene data.' : error instanceof Error ? error.message : 'The scene could not be updated.' });
interface SceneStore {
  scene: Scene;
  createScene: (input: unknown) => MutationResult;
  editScene: (input: unknown) => MutationResult;
  setListener: (input: unknown) => MutationResult;
}
export const useSceneStore = create<SceneStore>((set, get) => ({
  scene: prepare(soundscapes.rainy.scene),
  createScene: input => { try { set({ scene: prepare(input) }); return { ok: true }; } catch (error) { return failure(error); } },
  editScene: input => {
    try { set({ scene: applySceneOperations(get().scene, EditSceneSchema.parse(input)) }); return { ok: true }; }
    catch (error) { return failure(error); }
  },
  setListener: input => {
    try { const listener = ListenerSchema.parse(input); set({ scene: clampScene({ ...get().scene, listener }) }); return { ok: true }; }
    catch (error) { return failure(error); }
  },
}));
