import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorker } from './server.mjs';
import { ManagedAgent } from '../server/managedAgent.ts';
import { starter } from '../src/scene/fixtures.ts';

const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup(run) {
  const root = await mkdtemp(join(tmpdir(), 'soundscape-worker-'));
  cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const server = await createWorker({ key: 'worker-private-key', root, run });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const agent = new ManagedAgent({ apiKey: 'worker-private-key', agentId: 'local', environmentId: 'local', baseUrl });
  return { root, baseUrl, agent, server };
}
async function result(agent, token, scene = null) {
  for (let i = 0; i < 100; i++) {
    const value = await agent.result(token, scene);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Worker did not publish output');
}
describe('self-hosted world worker', () => {
  it('keeps the signed session, manifest, compiled assets and follow-up protocol', async () => {
    let calls = 0;
    const { agent } = await setup(async function* ({ prompt, options }) {
      calls++;
      if (calls === 2) {
        expect(options.resume).toBe('sdk-session-one');
        expect(prompt).toContain('"muted":true');
        const turn = prompt.match(/Turn: (r_[a-f0-9]+)/)[1];
        await writeFile(join(options.cwd, 'outputs', `${turn}_scene.json`), JSON.stringify({ version: 1, turn, response: { kind: 'edit', ops: [{ op: 'set_volume', id: 'fan-1', volume: 0.1 }] } }));
        yield { type: 'result', subtype: 'success' };
        return;
      }
      expect(options.systemPrompt).toContain('AI Pixel World Director');
      const turn = prompt.match(/Turn: (r_[a-f0-9]+)/)[1];
      const outputs = join(options.cwd, 'outputs');
      expect(prompt).toContain(`${outputs}/`);
      yield { type: 'system', subtype: 'init', session_id: 'sdk-session-one' };
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } };
      const output = { version: 1, turn, response: { kind: 'create', scene: { ...starter, objects: [starter.objects[1]] } },
        environment: { concept: 'A forest', shell: '#324d35', colors: ['#324d35', '#91a56c'], textures: { floor: { file: `${turn}_floor.png`, w: 160, h: 160 } } },
        sprites: [{ objectId: 'fan-1', file: `${turn}_tree.png`, w: 24, h: 40 }], sounds: [{ objectId: 'fan-1', file: `${turn}_wind.wav` }] };
      // Real files cross the worker's HTTP boundary; only paid model inference is replaced.
      const png = Buffer.alloc(24); png.writeUInt32BE(0x89504e47); png.writeUInt32BE(0x0d0a1a0a, 4); png.writeUInt32BE(160, 16); png.writeUInt32BE(160, 20);
      await writeFile(join(outputs, `${turn}_floor.png`), png);
      await writeFile(join(outputs, `${turn}_tree.png`), png);
      await writeFile(join(outputs, `${turn}_wind.wav`), 'RIFFtest-audio');
      await writeFile(join(outputs, `${turn}_scene.json`), JSON.stringify(output));
      yield { type: 'result', subtype: 'success' };
    });
    const started = await agent.start({ prompt: 'A quiet forest', scene: null });
    expect(started.kind).toBe('managed');
    const complete = await result(agent, started.token);
    expect(complete.response.scene.objects[0].sound.assetId).toBeUndefined();
    const file = complete.assets.sounds[0].fileId;
    expect(await (await agent.asset(started.token, file)).text()).toBe('RIFFtest-audio');
    const progress = await agent.stream(started.token).text();
    expect(progress).toContain('"type":"complete"');
    expect(progress).not.toContain('sdk-session-one');
    const scene = structuredClone(complete.response.scene); scene.objects[0].muted = true;
    const edited = await agent.start({ prompt: 'Quieter', scene }, started.token);
    const updated = await result(agent, edited.token, scene);
    expect(updated.response).toEqual({ kind: 'edit', ops: [{ op: 'set_volume', id: 'fan-1', volume: 0.1 }] });
    expect(scene.objects[0].muted).toBe(true);
  });
  it('rejects unauthenticated requests and cross-session or symlink files', async () => {
    const { agent, root, baseUrl } = await setup(async function* ({ prompt, options }) {
      const turn = prompt.match(/Turn: (r_[a-f0-9]+)/)[1];
      await writeFile(join(options.cwd, 'outputs', `${turn}_safe.wav`), 'safe');
      await symlink(join(options.cwd, 'missing.wav'), join(options.cwd, 'outputs', 'escape.wav'));
      yield { type: 'result', subtype: 'success' };
    });
    expect((await fetch(`${baseUrl}/files`)).status).toBe(401);
    const a = await agent.start({ prompt: 'A', scene: null });
    for (let i = 0; i < 100 && (await (await agent.api(`/sessions/${agent.verify(a.token).session}`)).json()).status !== 'idle'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const b = await agent.start({ prompt: 'B', scene: null });
    const session = agent.verify(a.token).session;
    const outputs = join(root, session, 'work', 'outputs');
    await mkdir(outputs, { recursive: true });
    await writeFile(join(outputs, 'safe.wav'), 'safe');
    await writeFile(join(root, 'secret.wav'), 'private');
    await rm(join(outputs, 'escape.wav'));
    await symlink(join(root, 'secret.wav'), join(outputs, 'escape.wav'));
    const files = await agent.files(session);
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe(`${agent.verify(a.token).turn}_safe.wav`);
    await expect(agent.asset(b.token, files[0].id)).rejects.toThrow(/unavailable/);
  });
  it('preserves published assets and SDK resumption after failure and restart', async () => {
    let calls = 0;
    const run = async function* ({ prompt, options }) {
      const turn = prompt.match(/Turn: (r_[a-f0-9]+)/)[1];
      if (++calls === 1) {
        yield { type: 'system', subtype: 'init', session_id: 'persisted-sdk-session' };
        await writeFile(join(options.cwd, 'outputs', `${turn}_sound.wav`), 'published audio');
        yield { type: 'result', subtype: 'success' };
      } else {
        expect(options.resume).toBe('persisted-sdk-session');
        await writeFile(join(options.cwd, 'outputs', `${turn}_partial.wav`), 'unpublished');
        throw new Error('build failed');
      }
    };
    const { agent, root, server } = await setup(run);
    const first = await agent.start({ prompt: 'Forest', scene: null });
    const waitIdle = async token => {
      for (let i = 0; i < 100; i++) {
        if ((await (await agent.api(`/sessions/${agent.verify(token).session}`)).json()).status === 'idle') return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('Worker stayed busy');
    };
    await waitIdle(first.token);
    const [file] = await agent.files(agent.verify(first.token).session);
    const second = await agent.start({ prompt: 'Add birds', scene: starter }, first.token);
    await waitIdle(second.token);
    expect(await agent.files(agent.verify(first.token).session)).toHaveLength(1);
    expect(await (await agent.asset(first.token, file.id)).text()).toBe('published audio');
    await new Promise(resolve => server.close(resolve));
    // A process killed during a later build must fail that turn after restart.
    const statePath = join(root, agent.verify(first.token).session, 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8')); state.status = 'running';
    await writeFile(statePath, JSON.stringify(state));
    const restarted = await createWorker({ key: 'worker-private-key', root, run });
    await new Promise(resolve => restarted.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise(resolve => restarted.close(resolve)));
    const resumed = new ManagedAgent({ ...agent.settings, baseUrl: `http://127.0.0.1:${restarted.address().port}/v1` });
    expect(await (await resumed.asset(first.token, file.id)).text()).toBe('published audio');
    expect(await resumed.stream(second.token).text()).toContain('"type":"error"');
    await resumed.start({ prompt: 'Try again', scene: starter }, second.token);
  });
  it('surfaces tool failures without publishing transcripts or incomplete output', async () => {
    const { agent } = await setup(async function* () { throw new Error('provider-private-secret'); });
    const started = await agent.start({ prompt: 'Forest', scene: null });
    await new Promise(resolve => setTimeout(resolve, 30));
    const progress = await agent.stream(started.token).text();
    expect(progress).toContain('"type":"error"');
    expect(progress).not.toContain('provider-private-secret');
    expect(await agent.result(started.token, null)).toBeUndefined();
  });
});
