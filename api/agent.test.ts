import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cafe } from '../src/scene/fixtures.js';
import type { Preference } from '../src/ai/preferences.js';

const { authenticatedMemory, sceneResponse, retrieveMemory, syncMemory, mutation } = vi.hoisted(() => ({
  authenticatedMemory: vi.fn(), sceneResponse: vi.fn(), retrieveMemory: vi.fn(), syncMemory: vi.fn(), mutation: vi.fn() }));
vi.mock('./_lib/auth.js', () => ({ authenticatedMemory, privateJson: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('./scene.js', () => ({ sceneResponse }));
vi.mock('./_lib/moss.js', () => ({ deadline: <T>(operation: Promise<T>) => operation, mossConfigured: () => true, syncMemory, retrieveMemory }));
import { POST } from './agent.js';

const beach = { ...cafe, room: { ...cafe.room, art: 'demo-beach' } };
const coding: Preference = { _id: 'p1', task: 'coding', timeBucket: 'night', timezone: 'America/Los_Angeles', summary: 'The beach', scene: beach, updatedAt: 1 };
const send = (body: Record<string, unknown>) => POST(new Request('http://localhost/api/agent', { method: 'POST', body: JSON.stringify(body) }));
const turn = (prompt: string) => send({ prompt, scene: cafe, timeBucket: 'morning', task: '' });

beforeEach(() => {
  vi.clearAllMocks();
  const query = vi.fn().mockResolvedValue({ owner: 'user', preferences: [coding] });
  authenticatedMemory.mockResolvedValue({ owner: 'user', preferences: [coding], client: { query, mutation } });
  retrieveMemory.mockResolvedValue({ preferences: [], recentContext: [], notice: 'Moss memory ready.' });
  syncMemory.mockResolvedValue('Moss memory synced.');
  sceneResponse.mockResolvedValue(Response.json({ kind: 'managed', token: 'token' }, { status: 202 }));
});

describe('/api/agent saved rooms', () => {
  it.each(['coding', 'I am going to code'])('loads the saved room for a named task without Moss or the world agent: %s', async (prompt) => {
    const response = await turn(prompt);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ kind: 'create', restored: true, notice: 'Loaded your saved coding room.', recalled: ['coding (night)'] });
    expect(body.scene.room.art).toBe('demo-beach');
    expect(sceneResponse).not.toHaveBeenCalled();
    expect(retrieveMemory).not.toHaveBeenCalled();
  });
  it('lets Moss pick the closest saved room for a usual setup with an unknown task', async () => {
    retrieveMemory.mockResolvedValue({ preferences: [coding], recentContext: [], notice: 'Moss memory ready.' });
    const body = await (await turn('Set up my usual programming focus environment')).json();
    expect(body).toMatchObject({ kind: 'create', restored: true, recalled: ['coding (night)'] });
    expect(sceneResponse).not.toHaveBeenCalled();
  });
  it('refuses a usual setup nothing matches', async () => {
    expect((await turn('Set up my usual reading environment')).status).toBe(400);
    expect(sceneResponse).not.toHaveBeenCalled();
  });
  it('sends new places to the world agent with preferences as context', async () => {
    const response = await turn('rainy cafe for coding');
    expect(response.status).toBe(202);
    expect(sceneResponse).toHaveBeenCalledOnce();
  });
  it.each(['Make the rain quieter than my usual coding setup', 'Do not use my usual coding setup, make it rainier'])(
    'unrelated or declined recall does not replace the room: %s', async (prompt) => {
      sceneResponse.mockResolvedValue(Response.json({ kind: 'edit', ops: [] }));
      expect(await (await turn(prompt)).json()).toMatchObject({ kind: 'edit', ops: [] });
      expect(sceneResponse).toHaveBeenCalledOnce();
    });
  it('does not save the old scene before a task-place generation finishes', async () => {
    expect((await turn('I am going to code, bring me to the river')).status).toBe(202);
    expect(mutation).not.toHaveBeenCalled();
  });
  it('manual task and time fields take precedence over words in preference notes', async () => {
    const response = await send({ action: 'remember', task: 'code', timeBucket: 'any', prompt: 'Quiet enough for reading in the morning', scene: cafe });
    expect(response.status).toBe(200);
    expect(mutation.mock.calls[0][1].preference).toMatchObject({ task: 'coding', timeBucket: 'any' });
    expect(await response.json()).toMatchObject({ memory: { provider: 'moss', status: 'synced' } });
  });
});
