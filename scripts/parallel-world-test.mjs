import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { renderPxl } from '../server/pxl.ts';

const pixels = await renderPxl("sprite('floor',{w:64,h:64},rect(0,0,64,64,'#677367'));sprite('tree',{w:24,h:48},rect(10,20,4,28,'#916635'),rect(2,0,20,24,'#7d8f75'));", ['floor', 'tree']);
assert.ok(pixels.ok, pixels.error);
const wav = Buffer.alloc(44 + 22050 * 2); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
try {
  for (const [first, fail] of [['environment', false], ['objects', false], ['objects', true]]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    let release; const gate = new Promise(resolve => { release = resolve; });
    const errors = [], calls = []; let connections = 0, legacy = 0;
    page.on('pageerror', error => errors.push(error.message));
    const envId = 'agent-parallel-test';
    const grid = { mode: 'Square', columns: 6, rows: 6, wallHeight: 5 };
    const source = { id: 'oak', label: 'Oak', kind: 'bed', sound: { query: 'rustling oak leaves' }, position: [0, 1.5, 0], model: 'speaker', wall: null, volume: 0.3, muted: false, scale: 1 };
    const scene = { room: { preset: 'forest', grid, openings: [], reverb: 'outdoor', art: envId }, listener: { position: [0, 1.6, 0], yaw: 0 }, objects: [source] };
    const terrain = Array.from({ length: 6 }, () => Array(6).fill(0.5));
    const url = file => `/api/world?action=asset&token=parallel-run&file=${file}`;
    const sprites = [{ objectId: 'oak', label: source.label, query: source.sound.query, wall: null, url: url('tree'), w: 24, h: 48, frames: 1, fps: 10 }];
    const sounds = [{ objectId: 'oak', query: source.sound.query, kind: 'bed', fileId: 'sound', url: url('sound') }];
    const environment = { concept: 'A forest', shell: '#677367', colors: ['#11171e', '#677367', '#916635', '#7d8f75'], terrain, openAir: false, textures: { floor: { url: url('floor'), w: 64, h: 64, frames: 1, fps: 10 } } };
    const objectPart = { response: { kind: 'create', scene }, assets: { envId, sprites, sounds } };
    const envPart = { response: { kind: 'create', scene: { ...scene, room: { ...scene.room, terrain }, objects: [] } }, assets: { envId, environment, sprites: [], sounds: [] } };
    const final = { response: { kind: 'create', scene: { ...scene, room: { ...scene.room, terrain } } }, assets: { envId, environment, sprites, sounds } };
    await page.route('**/api/scene', route => route.fulfill({ status: 202, json: { kind: 'managed', token: 'parallel-run' } }));
    for (const endpoint of ['environment', 'sprite']) await page.route(`**/api/${endpoint}`, route => { legacy++; return route.fulfill({ status: 500, json: {} }); });
    await page.route('**/api/world*', async route => {
      const request = route.request(), query = new URL(request.url()).searchParams;
      if (request.method() === 'POST') { const body = request.postDataJSON(); calls.push(body.part ?? 'final'); return route.fulfill({ json: body.part === 'environment' ? envPart : body.part === 'objects' ? objectPart : final }); }
      if (query.get('action') === 'stream') {
        if (++connections > 1) await gate;
        const second = first === 'environment' ? 'objects' : 'environment';
        const events = connections === 1 ? [{ type: 'ready', part: first }, { type: 'reconnect' }] : fail ? [{ type: 'error', error: 'The environment branch failed.' }] : [{ type: 'ready', part: first }, { type: 'ready', part: second }, { type: 'complete' }];
        return route.fulfill({ contentType: 'text/event-stream', body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') });
      }
      const file = query.get('file');
      return file === 'sound' ? route.fulfill({ contentType: 'audio/wav', body: wav }) : route.fulfill({ contentType: 'image/png', body: Buffer.from(pixels.assets[file].png, 'base64') });
    });
    try {
      await page.goto(process.env.TEST_URL ?? 'http://localhost:5173');
      await page.getByLabel('Prompt', { exact: true }).fill('A forest'); await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.waitForFunction(() => window.__pixelRoom?.());
      assert.equal(await page.locator('canvas').count(), 1, 'first completed branch reveals the renderer while peer is blocked');
      assert.equal(await page.locator('.prompt-bar').getAttribute('aria-busy'), 'true');
      assert.deepEqual(calls, [first], 'no final result is requested while the other branch is blocked');
      if (first === 'objects') {
        await page.waitForFunction(() => window.__pixelRoom().objects.find(o => o.id === 'oak')?.artFrame !== undefined);
        await page.evaluate(() => window.__pixelRoomEdit([{ op: 'move', id: 'oak', position: [1, 2, 1] }, { op: 'set_volume', id: 'oak', volume: 0.15 }, { op: 'set_muted', id: 'oak', muted: true }]));
      } else assert.equal(await page.evaluate(() => window.__pixelRoom().scene.objects.length), 0);
      await mkdir('test-results', { recursive: true }); await page.screenshot({ path: `test-results/parallel-${first}-first${fail ? '-failure' : ''}.png` });
      release();
      if (fail) { await page.getByRole('alert').filter({ hasText: 'branch failed' }).waitFor(); assert.equal(await page.getByLabel('Prompt', { exact: true }).inputValue(), 'A forest'); }
      else await page.waitForFunction(() => document.querySelector('.prompt-bar').getAttribute('aria-busy') === 'false');
      const result = await page.evaluate(() => window.__pixelRoom().scene);
      assert.equal(result.objects.length, 1);
      if (first === 'objects') assert.deepEqual({ position: result.objects[0].position, volume: result.objects[0].volume, muted: result.objects[0].muted }, { position: [1, 2, 1], volume: 0.15, muted: true });
      if (!fail) { assert.equal(result.room.terrain[0][0], 0.5); assert.equal(calls.filter(value => value === first).length, 1, 'replayed ready events do not reapply a branch'); }
      assert.equal(legacy, 0); assert.deepEqual(errors, []);
      console.log(`PASS ${first}-first rendering while peer blocked; ${fail ? 'late failure preserves visible sources' : 'late arrival and final result preserve manual edits'}`);
    } finally { release(); await page.close(); }
  }
} finally { await browser.close(); }
