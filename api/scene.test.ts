import { afterEach, describe, expect, it, vi } from 'vitest';
import { starter } from '../src/scene/fixtures.js';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { interactions = { create }; } }));
import { POST } from './scene.js';

afterEach(() => { vi.unstubAllEnvs(); create.mockReset(); });
describe('Gemini agent scaling and user clearance', () => {
  it('exposes scale to the model and preserves 4x while correcting a center placement', async () => {
    vi.stubEnv('WORLD_AGENT_URL', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', 'test-only');
    const source = { ...starter.objects[1], model: 'speaker', wall: null, position: [0, 1, 0], scale: 4, sound: { query: 'gentle wind in an oak tree' } };
    create.mockResolvedValue({ steps: [{ type: 'function_call', name: 'create_scene', arguments: { scene: {
      listener: starter.listener, room: { preset: 'forest', reverb: 'outdoor' }, objects: [source],
    } } }] });
    const response = await POST(new Request('http://localhost/api/scene', { method: 'POST', body: JSON.stringify({ prompt: 'A forest', scene: null }) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.scene.objects[0].scale).toBe(4);
    expect(Math.hypot(result.scene.objects[0].position[0], result.scene.objects[0].position[2])).toBeGreaterThanOrEqual(3.5);
    const request = create.mock.calls[0][0];
    expect(request.system_instruction).toContain('NEVER place a source at the middle');
    const schema = request.tools[0].parameters.properties.scene.properties.objects.items;
    const variants = schema.oneOf ?? schema.anyOf;
    for (const variant of variants) expect(variant.properties.scale).toMatchObject({ minimum: 1, maximum: 4 });
  });
});
