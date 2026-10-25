import { describe, it, expect } from 'vitest';
import { ManagedAgent, AgentError, readSse } from './managedAgent.js';
import { starter } from '../src/scene/fixtures.js';
import type { Scene } from '../src/scene/scene.js';

const settings = { apiKey: 'test-private-key', agentId: 'agent_test', environmentId: 'env_test' };
const turn = 'r_0123456789abcdef', session = 'sesn_test';
const json = (value: unknown) => Response.json(value);
const run = (agent: ManagedAgent, context = 'null') => {
  // Tests use the same normalized Scene serialization as the server.
  return import('node:crypto').then(({ createHash }) => agent.sign({ session, turn, context: createHash('sha256').update(context).digest('hex'), expires: Date.now() + 60_000 }));
};
const world = () => ({ version: 1, turn, response: { kind: 'create', scene: { ...starter, objects: [starter.objects[1]] } },
  environment: { concept: 'An open forest', shell: '#324d35', colors: ['#324d35', '#91a56c'], openAir: true, textures: { floor: { file: `${turn}_floor.png`, w: 160, h: 160 } } },
  sprites: [{ objectId: 'fan-1', file: `${turn}_tree.png`, w: 24, h: 40, frames: 4, fps: 10 }],
  sounds: [{ objectId: 'fan-1', file: `${turn}_wind.wav` }],
});
const files = () => ['scene.json', 'floor.png', 'tree.png', 'wind.wav'].map((name, i) => ({ id: `file_${i}`, filename: `${turn}_${name}`, size_bytes: 100, downloadable: true, scope: { type: 'session', id: session } }));
function fixture(output: unknown = world(), catalog = files()) {
  return new ManagedAgent(settings, (async input => {
    const url = new URL(String(input));
    if (url.pathname === '/v1/files') return json({ data: catalog });
    if (url.pathname === '/v1/files/file_0/content') return json(output);
    throw new Error(`Unexpected endpoint ${url.pathname}`);
  }) as typeof fetch);
}
describe('managed world integration', () => {
  it('authenticates signed sessions and rejects tampering or expiry', async () => {
    const agent = fixture(), token = await run(agent);
    expect(agent.verify(token).session).toBe(session);
    expect(() => agent.verify(token + 'x')).toThrow(AgentError);
    const expired = agent.sign({ ...agent.verify(token), expires: 0 });
    expect(() => agent.verify(expired)).toThrow(/expired/);
  });
  it('uses the supplied agent configuration and only returns a capability token', async () => {
    let sent: Record<string, unknown> | undefined;
    const agent = new ManagedAgent(settings, (async (_input, init) => { sent = JSON.parse(init!.body as string); return json({ id: session }); }) as typeof fetch);
    const result = await agent.start({ prompt: 'A forest', scene: null }, undefined, { preferences: ['Quiet rain'] });
    expect(result.kind).toBe('managed');
    expect(JSON.stringify(sent)).toContain('Quiet rain');
    expect(JSON.stringify(sent)).toContain('The current prompt wins');
    expect(JSON.stringify(sent)).toContain('Start from an EMPTY fixed shell');
    expect(JSON.stringify(sent)).toContain('exactly 0.42 blocks');
    expect(JSON.stringify(sent)).toContain('never replace them with flat cutouts');
    expect(JSON.stringify(result)).not.toContain(settings.apiKey);
    expect(sent).toMatchObject({ agent: { type: 'agent_with_overrides', id: settings.agentId, system: expect.stringContaining('AI Pixel World Director') }, environment_id: settings.environmentId });
  });
  it('validates output, strips model-owned sound IDs, and binds generated assets', async () => {
    const agent = fixture(), result = await agent.result(await run(agent), null);
    expect(result?.response.kind).toBe('create');
    if (result?.response.kind !== 'create') throw new Error('missing scene');
    expect(result.response.scene.objects[0].sound.assetId).toBeUndefined();
    expect(result.response.scene.room.art).toContain('agent-sesn_test');
    expect(result.assets.environment?.openAir).toBe(true);
    expect(result.assets.sprites[0]).toMatchObject({ frames: 4, fps: 10, url: expect.stringContaining('/api/world?') });
    expect(result.assets.sounds[0].fileId).toBe('file_3');
    expect(JSON.stringify(result)).not.toContain(settings.apiKey);
  });
  it('waits for both the manifest and delayed asset publication', async () => {
    const empty = fixture(world(), []);
    expect(await empty.result(await run(empty), null)).toBeUndefined();
    const delayed = fixture(world(), files().slice(0, 3));
    expect(await delayed.result(await run(delayed), null)).toBeUndefined();
  });
  it('rejects missing source mappings, external paths and stale output', async () => {
    const noSound = world(); noSound.sounds = [];
    const invalid = fixture(noSound);
    await expect(invalid.result(await run(invalid), null)).rejects.toThrow(/all artwork and sounds/);
    const external = world(); external.sprites[0].file = 'https://example.com/a.png';
    const malicious = fixture(external);
    await expect(malicious.result(await run(malicious), null)).rejects.toThrow(/validate/);
    const old = world(); old.turn = 'r_0000000000000000'; const stale = fixture(old);
    await expect(stale.result(await run(stale), null)).rejects.toThrow(/outdated/);
  });
  it('rejects mismatched original context and cross-session asset access', async () => {
    const agent = fixture(), token = await run(agent);
    await expect(agent.result(token, starter)).rejects.toThrow(/context/);
    const foreign = files(); foreign[1].scope.id = 'sesn_other'; const other = fixture(world(), foreign);
    await expect(other.asset(await run(other), 'file_1')).rejects.toThrow(/unavailable/);
  });
  it('applies follow-up edits without changing manual positions or mute', async () => {
    const context = structuredClone(starter) as Scene;
    context.room.art = 'agent-existing'; context.objects[1].muted = true; context.objects[1].position = [2, 1.5, -2];
    const output = { version: 1, turn, response: { kind: 'edit', ops: [{ op: 'set_volume', id: 'fan-1', volume: 0.1 }] } };
    const agent = fixture(output);
    const result = await agent.result(await run(agent, JSON.stringify(context)), context);
    expect(result?.response).toEqual(output.response);
    expect(context.objects[1]).toMatchObject({ muted: true, position: [2, 1.5, -2] });
  });
  it('replays missed events, skips older turns and duplicate live events', async () => {
    const events = [
      { id: 'old', type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
      { id: 'user', type: 'user.message', content: [{ type: 'text', text: `Turn: ${turn}\nA forest` }] },
      { id: 'paint', type: 'agent.tool_use', name: 'bash' },
      { id: 'done', type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
    ];
    const agent = new ManagedAgent(settings, (async input => String(input).includes('/stream') ? new Response('data: '+JSON.stringify(events[2])+'\n\n') : json({ data: events })) as typeof fetch);
    const text = await agent.stream(await run(agent)).text();
    expect(text.match(/"type":"complete"/g)).toHaveLength(1);
    expect(text.match(/"id":"paint"/g)).toHaveLength(1);
    expect(text).not.toContain('"id":"old"');
  });
  it('parses fragmented CRLF SSE and UTF-8 safely', async () => {
    const bytes = new TextEncoder().encode('data: {"message":"moss 🌳"}\r\n\r\ndata: {"done":true}\r\n\r\n');
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (const value of bytes) controller.enqueue(new Uint8Array([value])); controller.close(); } });
    const values = []; for await (const value of readSse(body)) values.push(JSON.parse(value));
    expect(values).toEqual([{ message: 'moss 🌳' }, { done: true }]);
  });
  it('does not leak provider errors or credentials', async () => {
    const agent = new ManagedAgent(settings, (async () => new Response(settings.apiKey, { status: 401 })) as typeof fetch);
    await expect(agent.api('/sessions')).rejects.toThrow('Claude rejected');
  });
});

describe('validated first-ready branches', () => {
  it.each(['environment', 'objects'] as const)('loads only the %s branch with a stable final world id', async part => {
    const output = world();
    const catalog = files();
    catalog[0].filename = `${turn}_${part}.json`;
    if (part === 'environment') {
      output.response.scene.objects = [];
      output.sprites = []; output.sounds = [];
      output.environment.textures.floor.file = `${turn}_environment_floor.png`;
      catalog[1].filename = `${turn}_environment_floor.png`;
    } else {
      const sources = { ...output, environment: undefined };
      sources.sprites[0].file = `${turn}_objects_tree.png`;
      sources.sounds[0].file = `${turn}_objects_wind.wav`;
      catalog[2].filename = `${turn}_objects_tree.png`; catalog[3].filename = `${turn}_objects_wind.wav`;
      const agent = fixture(sources, catalog);
      const result = await agent.result(await run(agent), null, part);
      expect(result?.assets.envId).toBe(`agent-${session}-${turn}`);
      expect(result?.assets.sprites).toHaveLength(1);
      expect(result?.assets.environment).toBeUndefined();
      return;
    }
    const agent = fixture(output, catalog);
    const result = await agent.result(await run(agent), null, part);
    expect(result?.assets.envId).toBe(`agent-${session}-${turn}`);
    expect(result?.response.kind === 'create' && result.response.scene.objects).toEqual([]);
    expect(result?.assets.environment).toBeDefined();
  });
  it('rejects a mixed environment branch rather than exposing its source list', async () => {
    const catalog = files(); catalog[0].filename = `${turn}_environment.json`;
    const agent = fixture(world(), catalog);
    await expect(agent.result(await run(agent), null, 'environment')).rejects.toThrow(/environment branch/);
  });
});
