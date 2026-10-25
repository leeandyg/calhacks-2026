import { afterEach, expect, it, vi } from 'vitest';
import { learnPreference } from './learnPreference.js';
import { cafe } from '../scene/fixtures.js';

afterEach(() => vi.unstubAllGlobals());
const context = { token: 'test-user', task: '', timeBucket: 'auto' as const, turns: [] };
it('saves the applied scene under coding at any time and returns actual Moss status', async () => {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ message: 'Remembered coding.', notice: 'Moss semantic memory is active.', memory: { provider: 'moss', status: 'pending' } }));
  vi.stubGlobal('fetch', fetchMock);
  const applied = { ...cafe, room: { ...cafe.room, art: 'river-generated' } };
  const result = await learnPreference('I am going to code, bring me to the river', context, applied);
  const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
  expect(body).toMatchObject({ action: 'remember', task: 'coding', timeBucket: 'any', scene: applied });
  expect(result).toMatchObject({ task: 'coding', memory: { provider: 'moss', status: 'pending' } });
});
it('does not write memory for an ordinary edit or without an authenticated session', async () => {
  vi.stubGlobal('fetch', vi.fn());
  expect(await learnPreference('Make it rainier', context, cafe)).toBeUndefined();
  await expect(learnPreference('I am going to code, bring me to the river', undefined, cafe)).rejects.toThrow(/Connect/);
  expect(fetch).not.toHaveBeenCalled();
});
