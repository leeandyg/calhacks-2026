import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { renderPxl } from '../server/pxl.ts';
import { mkdir } from 'node:fs/promises';

// 'prop' is a 4-frame horizontal strip (each frame 24x24) so the sidebar must show one frame, not all four.
const pixels = await renderPxl(`sprite('floor',{w:64,h:64},rect(0,0,64,64,'#324d35')); sprite('wall',{w:64,h:64},rect(0,0,64,64,'#5a6b8c')); sprite('prop',{w:96,h:24},rect(0,0,24,24,'#d94f4f'),rect(24,0,24,24,'#4fd98a'),rect(48,0,24,24,'#4f7fd9'),rect(72,0,24,24,'#d9c44f'));`, ['floor','wall','prop']);
assert.ok(pixels.ok, pixels.error);
const wav = Buffer.alloc(44 + 100 * 2); wav.write('RIFF',0); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(22050,24); wav.writeUInt32LE(44100,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const grid = { mode: 'Square', columns: 6, rows: 6, wallHeight: 5 };
const terrain = Array.from({ length: 6 }, () => [0,0,0,0,0,0]);
const scene = { room: { preset: 'cafe', grid, openings: [], reverb: 'small-room', art: 'agent-test', terrain }, listener: { position: [0,1.6,0], yaw: 0 }, objects: [
  { id: 'lamp', label: 'Desk lamp hum', kind: 'bed', sound: { query: 'hum' }, position: [1,1.5,1], volume: .3, model: 'speaker', wall: null, scale: 1.2, muted: false },
  { id: 'clock', label: 'Wall clock tick', kind: 'event', sound: { query: 'tick' }, position: [2.9,2,0], volume: .6, intervalSec: [2,4], model: 'speaker', wall: 'east', scale: 1, muted: false },
] };
const url = file => `/api/world?action=asset&token=test-run-1&file=${file}`;
const result = { response: { kind: 'create', scene }, assets: { envId: 'agent-test', environment: { concept: 'x', shell: '#5a6b8c', colors: ['#5a6b8c','#324d35','#d94f4f','#ffd24f'], openAir: false, terrain, textures: { floor: { url: url('floor'), w:64,h:64,frames:1,fps:10 }, north: { url: url('wall'), w:64,h:64,frames:1,fps:10 }, east: { url: url('wall'), w:64,h:64,frames:1,fps:10 }, south: { url: url('wall'), w:64,h:64,frames:1,fps:10 }, west: { url: url('wall'), w:64,h:64,frames:1,fps:10 } } }, sprites: scene.objects.map(o => ({ objectId: o.id, label: o.label, query: o.sound.query, wall: o.wall, url: url('prop'), w:24, h:24, frames:4, fps:10 })), sounds: scene.objects.map(o => ({ objectId: o.id, query: o.sound.query, kind: o.kind, fileId: `file_${o.id}`, url: url(o.id) })) } };
await page.route('**/api/scene', route => route.fulfill({ status: 202, json: { kind: 'managed', token: 'test-run-1' } }));
await page.route('**/api/world*', async route => {
  const request = route.request(), query = new URL(request.url()).searchParams;
  if (request.method() === 'POST') return route.fulfill({ json: result });
  if (query.get('action') === 'stream') return route.fulfill({ contentType: 'text/event-stream', body: 'data: ' + JSON.stringify({ type: 'complete' }) + '\r\n\r\n' });
  const file = query.get('file');
  if (['floor','wall','prop'].includes(file)) return route.fulfill({ contentType: 'image/png', body: Buffer.from(pixels.assets[file].png, 'base64') });
  return route.fulfill({ contentType: 'audio/wav', body: wav });
});
const scn = () => page.evaluate(() => window.__pixelRoom().scene.objects);
const find = async id => (await scn()).find(o => o.id === id);
try {
  await mkdir('test-results', { recursive: true });
  await page.goto(process.env.TEST_URL ?? 'http://localhost:5173');
  // Panel is hidden on the fresh page.
  assert.equal(await page.getByRole('region', { name: 'Assets' }).count(), 0, 'no Assets panel before a room exists');
  await page.getByLabel('Prompt', { exact: true }).fill('A cafe'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => window.__pixelRoom?.().objects.find(o => o.id === 'lamp')?.artFrame !== undefined);
  const panel = page.getByRole('region', { name: 'Assets' });
  await panel.waitFor();
  assert.ok(await panel.getByRole('heading', { name: 'Assets' }).count(), 'has an Assets title');
  assert.equal(await panel.getByRole('listitem').count(), 3, 'user row plus one row per sound object');
  assert.equal(await panel.locator('[data-avatar="user"]').getByText('You', { exact: true }).count(), 1);
  assert.equal(await panel.locator('[data-avatar="user"]').getByRole('button').count(), 0, 'the user cannot be deleted or hidden');
  assert.ok(await panel.getByText('Desk lamp hum').count(), 'shows label');
  const thumb = await panel.locator('.asset-row:not([data-avatar]) .asset-thumb').first().evaluate(el => { const s = getComputedStyle(el); return { image: s.backgroundImage, size: s.backgroundSize }; });
  assert.ok(thumb.image.startsWith('url('), 'thumbnail shows the sprite image');
  // 44px box, square 24x24 frames, 4 frames -> the strip is sized to 4× the box width, so the box frames exactly one.
  assert.equal(thumb.size, '176px 44px', 'thumbnail frames a single sprite frame, not the whole strip');
  await page.screenshot({ path: 'test-results/assets-panel.png' });

  // Volume: drag the lamp slider to the minimum.
  const beforeVol = (await find('lamp')).volume;
  const slider = panel.getByRole('slider', { name: 'Desk lamp hum volume' });
  await slider.focus(); await page.keyboard.press('Home');
  await page.waitForFunction(() => window.__pixelRoom().scene.objects.find(o => o.id === 'lamp').volume === 0);
  assert.equal((await find('lamp')).volume, 0, `volume changed from ${beforeVol} to 0`);

  // Hide the clock from the environment: it goes silent AND its 3D prop stops rendering, but the
  // row stays in the list so it can be restored.
  const rendered = id => page.evaluate(id => window.__pixelRoom().objects.find(o => o.id === id)?.model, id);
  assert.notEqual(await rendered('clock'), undefined, 'the clock prop renders before hiding');
  await panel.getByRole('button', { name: 'Hide Wall clock tick from the environment' }).click();
  await page.waitForFunction(() => window.__pixelRoom().scene.objects.find(o => o.id === 'clock').muted === true);
  assert.equal((await find('clock')).muted, true, 'hiding silences the source');
  await page.waitForFunction(() => window.__pixelRoom().objects.find(o => o.id === 'clock').model === undefined);
  assert.equal(await panel.getByRole('listitem').count(), 3, 'hidden source and user stay in the list');
  await page.screenshot({ path: 'test-results/assets-hidden.png' });
  // Show it again: restores the sound and the prop.
  await panel.getByRole('button', { name: 'Show Wall clock tick in the environment' }).click();
  await page.waitForFunction(() => window.__pixelRoom().scene.objects.find(o => o.id === 'clock').muted === false);
  await page.waitForFunction(() => window.__pixelRoom().objects.find(o => o.id === 'clock').model !== undefined);

  // Delete the lamp.
  await panel.getByRole('button', { name: 'Delete Desk lamp hum' }).click();
  await page.waitForFunction(() => !window.__pixelRoom().scene.objects.some(o => o.id === 'lamp'));
  assert.equal(await panel.getByRole('listitem').count(), 2, 'source row removed after delete; user stays');
  await page.screenshot({ path: 'test-results/assets-after-delete.png' });

  assert.deepEqual(errors, []);
  console.log('PASS: Assets panel lists sources with picture+label; volume, hide/show (prop removed + silenced) and delete all work');
} finally { await browser.close(); }
