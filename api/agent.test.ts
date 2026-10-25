import { beforeEach, expect, it, vi } from 'vitest';
import { cafe } from '../src/scene/fixtures.js';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), retrieve: vi.fn(), sync: vi.fn(), scene: vi.fn(), mutation: vi.fn(), query: vi.fn() }));
vi.mock('./_lib/auth.js', () => ({ authenticatedMemory: mocks.auth, privateJson: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('./_lib/moss.js', () => ({ deadline: (value: Promise<unknown>) => value, mossConfigured: () => true, retrieveMemory: mocks.retrieve, syncMemory: mocks.sync }));
vi.mock('./scene.js', () => ({ sceneResponse: mocks.scene }));
import { POST } from './agent.js';
const saved = { task: 'coding', timeBucket: 'any', timezone: 'America/Vancouver', summary: 'Coding beside a river', scene: cafe, _id: 'test-preference', updatedAt: 1 };
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({ owner: 'test-owner', preferences: [saved], client: { mutation: mocks.mutation, query: mocks.query } });
  mocks.query.mockResolvedValue({ owner: 'test-owner', preferences: [saved] });
  mocks.retrieve.mockResolvedValue({ preferences: [saved], notice: 'Moss memory ready.', source: 'moss', recentContext: [] });
  mocks.sync.mockResolvedValue('Moss memory synced.');
});
const send = (body: Record<string, unknown>) => POST(new Request('http://localhost/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
it('uses Moss recall to restore the coding snapshot without another generation', async () => {
  const response = await send({ prompt: 'I am going to code', timeBucket: 'night' });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ kind: 'create', scene: cafe, notice: 'Moss memory ready.' });
  expect(mocks.retrieve.mock.calls[0][3]).toBe('coding');
  expect(mocks.scene).not.toHaveBeenCalled();
});
it('does not save the old scene before a task-place generation finishes', async () => {
  mocks.scene.mockResolvedValue(Response.json({ kind: 'managed', token: 'test-run' }, { status: 202 }));
  expect((await send({ prompt: 'I am going to code, bring me to the river', scene: cafe })).status).toBe(202);
  expect(mocks.mutation).not.toHaveBeenCalled();
});
it('manual task and time fields take precedence over words in preference notes', async () => {
  const response = await send({ action: 'remember', task: 'code', timeBucket: 'any', prompt: 'Quiet enough for reading in the morning', scene: cafe });
  expect(response.status).toBe(200);
  expect(mocks.mutation.mock.calls[0][1].preference).toMatchObject({ task: 'coding', timeBucket: 'any' });
  expect(await response.json()).toMatchObject({ memory: { provider: 'moss', status: 'synced' } });
});
it.each(['Make the rain quieter than my usual coding setup', 'Do not use my usual coding setup, make it rainier'])('unrelated or declined recall does not replace the room: %s', async prompt => {
  mocks.scene.mockResolvedValue(Response.json({ kind: 'edit', ops: [] }));
  const response = await send({ prompt, scene: cafe });
  expect(await response.json()).toMatchObject({ kind: 'edit', ops: [] });
  expect(mocks.scene).toHaveBeenCalledTimes(1);
});
