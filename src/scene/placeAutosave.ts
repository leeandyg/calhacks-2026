import { Scene } from './scene.js';
import { placeTitle } from './placeTitle.js';

type Snapshot = { name: string; scene: Scene };
type Place<Id> = { art?: string; id: Id | null; pending?: Snapshot; saving: boolean };

/** Keep each visit's snapshot until saved, even if the user switches rooms during a request. */
export function createPlaceAutosave<Id>(backend: {
  create: (snapshot: Snapshot) => Promise<Id>;
  update: (snapshot: Snapshot & { id: Id }) => Promise<unknown>;
  onActive: (id: Id | null) => void;
  onError: (failed: boolean) => void;
}) {
  let current: Place<Id> | undefined;
  const pending = new Set<Place<Id>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ready = true;

  const schedule = () => {
    clearTimeout(timer);
    if (ready) timer = setTimeout(flush, 1000);
  };
  const save = async (place: Place<Id>) => {
    if (!ready || place.saving || !place.pending) return;
    const snapshot = place.pending;
    place.pending = undefined;
    place.saving = true;
    try {
      if (place.id === null) place.id = await backend.create(snapshot);
      else await backend.update({ ...snapshot, id: place.id });
      if (current === place) backend.onActive(place.id);
      backend.onError(false);
    } catch {
      // Preserve newer edits on failure and retry when the connection or scene changes.
      place.pending ??= snapshot;
      backend.onError(true);
      return;
    } finally {
      place.saving = false;
    }
    if (place.pending) schedule();
    else pending.delete(place);
  };
  function flush() {
    for (const place of pending) void save(place);
  }
  return {
    observe(scene: Scene, concept?: string, title?: string) {
      if (scene.room.art?.startsWith("demo-")) {
        current = undefined;
        backend.onActive(null);
        return;
      }
      if (!scene.room.art && !scene.objects.length) return;
      if (concept === 'Environment is being painted') return;
      if (!current || current.art !== scene.room.art) {
        current = { art: scene.room.art, id: null, saving: false };
        backend.onActive(null);
      }
      current.pending = { name: title?.trim() || placeTitle(concept, scene.objects), scene: Scene.parse(scene) };
      pending.add(current);
      schedule();
    },
    select(id: Id | null, art?: string) {
      current = id === null ? undefined : { id, art, saving: false };
      backend.onActive(id);
    },
    setReady(value: boolean) { ready = value; schedule(); },
    pause() { ready = false; clearTimeout(timer); },
  };
}

/** The deployed save mutation upserts by name. Reserve a distinct name per visit, then
 * keep that name for edits so repeated environment descriptions never overwrite another place. */
export function savedPlaceBackend<Id>(
  save: (snapshot: Snapshot) => Promise<Id>,
  rooms: () => { _id: Id; name: string }[],
) {
  const names = new Map<Id, string>();
  const reserved = new Set<string>();
  return {
    async create(snapshot: Snapshot) {
      const used = new Set([...rooms().map(room => room.name), ...reserved]);
      const base = snapshot.name.slice(0, 65);
      let name = base;
      for (let count = 2; used.has(name); count++) name = `${base} (${count})`;
      reserved.add(name);
      try {
        const id = await save({ ...snapshot, name });
        names.set(id, name);
        return id;
      } catch (error) {
        reserved.delete(name);
        throw error;
      }
    },
    async update({ id, scene }: Snapshot & { id: Id }) {
      const name = names.get(id) ?? rooms().find(room => room._id === id)?.name;
      if (!name) throw new Error('That saved place is unavailable.');
      await save({ name, scene });
    },
  };
}
