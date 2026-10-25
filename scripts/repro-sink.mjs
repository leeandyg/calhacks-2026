import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { renderPxl } from '../server/pxl.ts';
import { mkdir } from 'node:fs/promises';

// A tall asymmetric prop so sinking into the wall is obvious.
const pixels = await renderPxl(`sprite('floor',{w:64,h:64},rect(0,0,64,64,'#324d35')); sprite('wall',{w:64,h:64},rect(0,0,64,64,'#5a6b8c')); sprite('prop',{w:24,h:32},rect(4,0,16,32,'#d94f4f'),rect(8,4,8,8,'#ffd24f'));`, ['floor','wall','prop']);
assert.ok(pixels.ok, pixels.error);
const wav = Buffer.alloc(44 + 100 * 2); wav.write('RIFF',0); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(22050,24); wav.writeUInt32LE(44100,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const grid = { mode: 'Square', columns: 6, rows: 6, wallHeight: 5 };
const terrain = Array.from({ length: 6 }, () => [0,0,0,0,0,0]);
const scene = { room: { preset: 'cafe', grid, openings: [], reverb: 'small-room', art: 'agent-test', terrain }, listener: { position: [0,1.6,0], yaw: 0 }, objects: [
  { id: 'lamp', label: 'Lamp', kind: 'bed', sound: { query: 'hum' }, position: [0,1.5,0], volume: .3, model: 'speaker', wall: null, scale: 1.4, muted: false },
] };
const url = file => `/api/world?action=asset&token=test-run-1&file=${file}`;
const result = { response: { kind: 'create', scene }, assets: { envId: 'agent-test', environment: { concept: 'x', shell: '#5a6b8c', colors: ['#5a6b8c','#324d35','#d94f4f','#ffd24f'], openAir: false, terrain, textures: { floor: { url: url('floor'), w:64,h:64,frames:1,fps:10 }, north: { url: url('wall'), w:64,h:64,frames:1,fps:10 }, east: { url: url('wall'), w:64,h:64,frames:1,fps:10 }, south: { url: url('wall'), w:64,h:64,frames:1,fps:10 }, west: { url: url('wall'), w:64,h:64,frames:1,fps:10 } } }, sprites: scene.objects.map(o => ({ objectId: o.id, label: o.label, query: o.sound.query, wall: o.wall, url: url('prop'), w:24, h:32, frames:1, fps:10 })), sounds: scene.objects.map(o => ({ objectId: o.id, query: o.sound.query, kind: o.kind, fileId: `file_${o.id}`, url: url(o.id) })) } };
await page.route('**/api/scene', route => route.fulfill({ status: 202, json: { kind: 'managed', token: 'test-run-1' } }));
await page.route('**/api/world*', async route => {
  const request = route.request(), query = new URL(request.url()).searchParams;
  if (request.method() === 'POST') return route.fulfill({ json: result });
  if (query.get('action') === 'stream') return route.fulfill({ contentType: 'text/event-stream', body: 'data: ' + JSON.stringify({ type: 'complete' }) + '\r\n\r\n' });
  const file = query.get('file');
  if (['floor','wall','prop'].includes(file)) return route.fulfill({ contentType: 'image/png', body: Buffer.from(pixels.assets[file].png, 'base64') });
  return route.fulfill({ contentType: 'audio/wav', body: wav });
});
const inspect = () => page.evaluate(() => window.__pixelRoom());
const project = p => page.evaluate(p => window.__pixelRoomProject(p), p);
const obj = async id => (await inspect()).objects.find(o => o.id === id);
async function dragTo(id, position) {
  const o = await obj(id); const center = await project(o.position); const target = await project(position);
  await page.mouse.move(...o.screen); await page.mouse.down();
  await page.mouse.move(target[0] + o.screen[0] - center[0], target[1] + o.screen[1] - center[1], { steps: 12 });
  await page.mouse.up(); await page.evaluate(() => new Promise(requestAnimationFrame));
}
try {
  await mkdir('test-results', { recursive: true });
  await page.goto(process.env.TEST_URL ?? 'http://localhost:5173');
  await page.getByLabel('Prompt', { exact: true }).fill('A cafe'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => window.__pixelRoom?.().objects.find(o => o.id === 'lamp')?.artFrame !== undefined);
  await page.waitForFunction(() => !window.__spawnBusy);
  // Walk toward the north (far, visible) wall in interior steps, then the far corner.
  for (const [tag, pos] of [['center', [0,1.5,0]], ['near-north', [0,1.5,-2]], ['at-north', [0,1.5,-2.9]], ['far-corner', [-2.9,1.5,-2.9]]]) {
    await dragTo('lamp', pos);
    const l = await obj('lamp');
    console.log(`${tag}: wall=${l.wall ?? '-'} position=${JSON.stringify(l.position)} opacity=${(l.opacity ?? 0).toFixed(2)} screen=${l.screen ? l.screen.map(Math.round) : null}`);
    await page.screenshot({ path: `test-results/sink-${tag}.png` });
  }
} finally { await browser.close(); }
