import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
const model = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { interactions = model; } }));
import { runArtAgent } from './artAgent.js';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const options = { system: 'Paint a source', brief: 'A tree', args: z.object({}), assets: [{ name: 'tree', w: 8, h: 16, exact: true }], budgetMs: 60_000 };
const paint = (code: string) => ({ steps: [{ type: 'function_call', name: 'paint', arguments: { code } }] });
const valid = "sprite('tree',{w:8,h:16},rect(2,0,4,16,'#324d35'));";
describe('art generation latency', () => {
  it('returns the first compiled valid artwork without a model review request', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-only');
    model.create.mockResolvedValue(paint(valid));
    const result = await runArtAgent(options);
    expect(result.rounds).toBe(1);
    expect(result.assets.tree).toMatchObject({ w: 8, h: 16 });
    expect(model.create).toHaveBeenCalledTimes(1);
  });
  it('still repairs failed compilation before publishing', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-only');
    model.create.mockResolvedValueOnce(paint('invalid(')).mockResolvedValue(paint(valid));
    const result = await runArtAgent(options);
    expect(result.rounds).toBe(2);
    expect(result.assets.tree.png.length).toBeGreaterThan(0);
    expect(model.create).toHaveBeenCalledTimes(2);
  });
});
