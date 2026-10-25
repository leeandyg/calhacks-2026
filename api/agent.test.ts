import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cafe } from '../src/scene/fixtures.js';
import type { Preference } from '../src/ai/preferences.js';

const { authenticatedMemory, sceneResponse, retrieveMemory } = vi.hoisted(() => ({ authenticatedMemory: vi.fn(), sceneResponse: vi.fn(), retrieveMemory: vi.fn() }));
vi.mock('./_lib/auth.js', () => ({ authenticatedMemory, privateJson: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('./scene.js', () => ({ sceneResponse }));
vi.mock('./_lib/moss.js', () => ({ deadline: <T>(operation: Promise<T>) => operation, syncMemory: vi.fn(), retrieveMemory }));
import { POST } from './agent.js';

const beach = { ...cafe, room: { ...cafe.room, art: 'demo-beach' } };
const coding: Preference = { _id: 'p1', task: 'coding', timeBucket: 'night', timezone: 'America/Los_Angeles', summary: 'The beach', scene: beach, updatedAt: 1 };
const turn = (prompt: string) => POST(new Request('http://localhost/api/agent', { method: 'POST',
  body: JSON.stringify({ prompt, scene: cafe, timeBucket: 'morning', task: '' }) }));

beforeEach(() => {
  vi.clearAllMocks();
  authenticatedMemory.mockResolvedValue({ owner: 'user', preferences: [coding], client: { query: vi.fn().mockResolvedValue({ preferences: [coding] }) } });
  retrieveMemory.mockResolvedValue({ preferences: [], recentContext: [], notice: 'Moss memory ready.' });
  sceneResponse.mockResolvedValue(Response.json({ kind: 'managed', token: 'token' }, { status: 202 }));
});

describe('/api/agent saved rooms', () => {
  it('loads the saved room for a named task without Moss or the world agent', async () => {
    const response = await turn('coding');
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
});
