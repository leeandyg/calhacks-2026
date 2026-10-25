import { api } from '../../convex/_generated/api.js';
import { asksOnlyFor } from '../ai/preferences.js';
import { capturedDemos, loadCapturedDemo } from './capturedDemos.js';
import { convex } from './convex.js';
import { Scene } from './scene.js';

export type SavedPlace = { label: string; load: () => Promise<Scene> };
const LIST_TIMEOUT_MS = 1500;

/**
 * A room the user saved, or a captured demo room, that the prompt names and nothing else ("cyberpunk city").
 * It opens as saved instead of being generated again. The user's own saves win over a demo of the same name.
 */
export async function findSavedPlace(prompt: string): Promise<SavedPlace | undefined> {
  const client = convex;
  if (client) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rooms = await Promise.race([client.query(api.savedScenes.list, {}),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), LIST_TIMEOUT_MS); })])
      .catch(() => []).finally(() => clearTimeout(timer));
    const room = rooms.find(room => asksOnlyFor(prompt, room.name));
    if (room) return { label: room.name, load: async () => Scene.parse((await client.query(api.savedScenes.load, { id: room._id })).scene) };
  }
  const demo = capturedDemos.find(demo => asksOnlyFor(prompt, demo.label));
  return demo && { label: demo.label, load: () => loadCapturedDemo(demo.id) };
}
