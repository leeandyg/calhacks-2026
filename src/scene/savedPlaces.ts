import type { Watch } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../convex/_generated/api.js';
import { asksOnlyFor } from '../ai/preferences.js';
import { capturedDemos, loadCapturedDemo } from './capturedDemos.js';
import { convex } from './convex.js';
import { Scene } from './scene.js';

export type SavedPlace = { label: string; load: () => Promise<Scene> };

// The user's saved places stay current through a live Convex query, so matching a prompt never waits
// on the network. Before the private session signs in (or without Convex) there are none; demos still match.
let watch: Watch<FunctionReturnType<typeof api.savedScenes.list>> | undefined;
/** Starts the live list early (page load) so the first prompt already sees it. */
export function savedRooms() {
  if (!convex) return [];
  if (!watch) { watch = convex.watchQuery(api.savedScenes.list, {}); watch.onUpdate(() => {}); }
  try { return watch.localQueryResult() ?? []; } catch { return []; }
}

/**
 * A room the user saved, or a captured demo room, that the prompt names and nothing else ("cyberpunk city").
 * It opens as saved instead of being generated again. The user's own saves win over a demo of the same name.
 */
export async function findSavedPlace(prompt: string): Promise<SavedPlace | undefined> {
  const client = convex;
  const room = savedRooms().find(room => asksOnlyFor(prompt, room.name));
  if (client && room) return { label: room.name, load: async () => Scene.parse((await client.query(api.savedScenes.load, { id: room._id })).scene) };
  const demo = capturedDemos.find(demo => asksOnlyFor(prompt, demo.label));
  return demo && { label: demo.label, load: () => loadCapturedDemo(demo.id) };
}
