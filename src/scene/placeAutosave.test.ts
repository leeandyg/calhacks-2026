import { afterEach, expect, it, vi } from 'vitest';
import { createPlaceAutosave } from './placeAutosave.js';
import { cafe } from './fixtures.js';

const scene = (art: string) => ({ ...cafe, room: { ...cafe.room, art } });
afterEach(() => vi.useRealTimers());

it('saves every visited environment even when another arrives before the debounce', async () => {
  vi.useFakeTimers();
  const create = vi.fn(async (_snapshot: { name: string }) => `place-${create.mock.calls.length}`);
  const saver = createPlaceAutosave({ create, update: vi.fn(), onActive: vi.fn(), onError: vi.fn() });
  saver.observe(scene('first'), 'A rainy café at night');
  saver.observe(scene('second'), 'A peaceful zen garden');
  await vi.runAllTimersAsync();
  expect(create.mock.calls.map(([value]) => value.name)).toEqual(['Rainy Café', 'Peaceful Zen Garden']);
});

it('waits for the environment description before assigning a permanent saved name', async () => {
  vi.useFakeTimers();
  const create = vi.fn(async () => 'saved');
  const update = vi.fn(async () => {});
  const saver = createPlaceAutosave({ create, update, onActive: vi.fn(), onError: vi.fn() });
  saver.observe(scene('first'), 'Environment is being painted');
  await vi.runAllTimersAsync();
  expect(create).not.toHaveBeenCalled();
  saver.observe(scene('first'), 'A rainy café at night');
  await vi.runAllTimersAsync();
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Rainy Café' }));
  expect(create).toHaveBeenCalledTimes(1);
});

it('does not attach a completed save to a new place and keeps the latest edits', async () => {
  vi.useFakeTimers();
  let finish!: (id: string) => void;
  const create = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const update = vi.fn(async () => {});
  const onActive = vi.fn();
  const saver = createPlaceAutosave({ create, update, onActive, onError: vi.fn() });
  saver.observe(scene('first'), 'Rainy café');
  await vi.advanceTimersByTimeAsync(1000);
  const edited = scene('first');
  edited.objects = edited.objects.map(o => ({ ...o, volume: 0.2 }));
  saver.observe(edited, 'Rainy café');
  saver.select(null);
  finish('first-id');
  await vi.runAllTimersAsync();
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 'first-id', scene: edited }));
  expect(onActive).not.toHaveBeenCalledWith('first-id');
});

it('updates a loaded place instead of creating a duplicate', async () => {
  vi.useFakeTimers();
  const create = vi.fn(async () => 'duplicate');
  const update = vi.fn(async () => {});
  const saver = createPlaceAutosave({ create, update, onActive: vi.fn(), onError: vi.fn() });
  saver.select('existing', 'first');
  saver.observe(scene('first'), 'Rainy café');
  await vi.runAllTimersAsync();
  expect(create).not.toHaveBeenCalled();
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 'existing' }));
});

it('uses the deployed save endpoint without overwriting places with the same label', async () => {
  const { savedPlaceBackend } = await import('./placeAutosave.js');
  const records: { _id: string; name: string }[] = [{ _id: 'old', name: 'Rainy Café' }];
  const save = vi.fn(async ({ name }: { name: string; scene: typeof cafe }) => {
    const id = records.find(r => r.name === name)?._id ?? `id-${records.length}`;
    if (!records.some(r => r._id === id)) records.push({ _id: id, name });
    return id;
  });
  const backend = savedPlaceBackend(save, () => records);
  const first = await backend.create({ name: 'Rainy Café', scene: scene('first') });
  const second = await backend.create({ name: 'Rainy Café', scene: scene('second') });
  expect(first).not.toBe(second);
  expect(records.map(r => r.name)).toEqual(['Rainy Café', 'Rainy Café (2)', 'Rainy Café (3)']);
  await backend.update({ id: first, name: 'New description', scene: scene('first') });
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Rainy Café (2)' }));
  await backend.update({ id: 'old', name: 'Other description', scene: scene('old') });
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Rainy Café' }));
  expect(records).toHaveLength(3);
});


it('saves the exact AI-authored title instead of extracting words from the description', async () => {
  vi.useFakeTimers();
  const create = vi.fn(async () => 'saved');
  const saver = createPlaceAutosave({ create, update: vi.fn(), onActive: vi.fn(), onError: vi.fn() });
  saver.observe(scene('first'), 'A green forest clearing with wind and birds', 'Whispers Beneath the Willow');
  await vi.runAllTimersAsync();
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Whispers Beneath the Willow' }));
});

it('never adds a captured template to Visited places', async () => {
  vi.useFakeTimers();
  const create = vi.fn(async () => 'saved');
  const update = vi.fn(async () => {});
  const saver = createPlaceAutosave({ create, update, onActive: vi.fn(), onError: vi.fn() });
  saver.observe(scene('demo-cafe'), 'Rainy cafe', 'Rainy Cafe');
  saver.observe(scene('demo-beach'), 'Ocean beach', 'Beach');
  await vi.runAllTimersAsync();
  expect(create).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});
