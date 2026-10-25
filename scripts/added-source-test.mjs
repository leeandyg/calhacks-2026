import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { renderPxl } from '../server/pxl.ts';

const painted = await renderPxl(`sprite('fan',{w:24,h:32},rect(9,12,6,17,'#41667c'),rect(3,26,18,5,'#c5d1bb'),rect(2,1,20,17,'#c5d1bb'),rect(5,4,14,11,'#41667c'));`, ['fan']);
assert.ok(painted.ok, painted.error);
process.env.VITE_CONVEX_URL = '';
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], sprites = [];
let failSprite = false, release;
const pending = new Promise(resolve => { release = resolve; });
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/scene', route => {
  const body = route.request().postDataJSON();
  if (body.engine !== 'gemini') return route.fulfill({ status: 503, json: { error: 'Agent unavailable' } });
  const id = failSprite ? 'new-speaker' : 'new-fan';
  return route.fulfill({ json: { kind: 'edit', ops: [{ op: 'add', object: {
    id, label: failSprite ? 'Speaker' : 'Fan', kind: 'bed', model: failSprite ? 'speaker' : 'fan',
    sound: { query: failSprite ? 'brown noise' : 'fan ventilation' },
    position: failSprite ? [2.5, 1.5, 2.5] : [-2.5, 1.5, 2.5], volume: 0.35,
  } }] } });
});
await page.route('**/api/sprite', async route => {
  sprites.push(route.request().postDataJSON());
  if (failSprite) return route.fulfill({ status: 503, json: { error: 'Painter unavailable' } });
  await pending;
  return route.fulfill({ json: { ...painted.assets.fan, png: `data:image/png;base64,${painted.assets.fan.png}` } });
});
const inspect = () => page.evaluate(() => window.__pixelRoom());
async function send(prompt) {
  await page.getByLabel('Prompt', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
try {
  await mkdir('test-results', { recursive: true });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.getByRole('button', { name: 'Rainy café', exact: true }).click();
  await page.waitForFunction(() => window.__pixelRoom?.().scene.room.art === 'demo-cafe' && !window.__spawnBusy);
  await page.evaluate(() => {
    const state = window.sceneStore.getState(), object = state.scene.objects[0];
    state.applyOps([{ op: 'set_muted', id: object.id, muted: true }, { op: 'set_volume', id: object.id, volume: 0.17 }]);
  });
  const before = await inspect();
  await send('Add a fan');
  await page.waitForFunction(() => window.sceneStore.getState().scene.objects.some(object => object.id === 'new-fan'));
  await expect.poll(() => sprites.length, { timeout: 5000, message: 'Fallback additions must request their missing artwork inside a captured room' }).toBe(1);
  await expect(page.locator('.sound-status[data-sound-id="new-fan"]')).toContainText('generating');
  assert.ok(sprites[0].concept.includes('cafe'));
  assert.equal(sprites[0].label, 'Fan');
  release();
  await page.waitForFunction(() => window.__pixelRoom().objects.find(object => object.id === 'new-fan')?.artFrame === 0 && !window.__spawnBusy);
  let current = await inspect();
  assert.ok(current.scene.objects.find(object => object.id === 'new-fan').sound.assetId, 'new audio is resolved independently of its artwork');
  assert.deepEqual(current.scene.objects.filter(object => object.id !== 'new-fan'), before.scene.objects);
  assert.deepEqual(current.scene.room, before.scene.room);
  assert.ok(current.objects.filter(object => object.id !== 'new-fan').every(object => typeof object.artFrame === 'number'), 'original animated sprites remain installed');
  await page.screenshot({ path: 'test-results/added-source-painted.png' });
  console.log('PASS fallback addition paints a visible prop, resolves audio, and preserves the existing scene and artwork');

  failSprite = true;
  await send('Add a brown noise speaker');
  await page.waitForFunction(() => window.__pixelRoom().objects.find(object => object.id === 'new-speaker')?.color && !window.__spawnBusy);
  current = await inspect();
  assert.equal(sprites.length, 2, 'only the two new sources are painted');
  assert.ok(current.objects.find(object => object.id === 'new-speaker').color, 'failed new artwork reveals usable stock geometry');
  assert.deepEqual(current.scene.objects.filter(object => !object.id.startsWith('new-')), before.scene.objects);
  await page.screenshot({ path: 'test-results/added-source-fallback.png' });
  await page.evaluate(() => window.sceneStore.getState().applyOps([{ op: 'add', object: {
    id: 'live-test', label: 'Spotify', kind: 'live', model: 'speaker',
    sound: { query: 'Spotify', stream: 'app:test' }, position: [0, 1.5, 2.5], volume: 0.3,
  } }]));
  await page.waitForFunction(() => window.__pixelRoom().objects.find(object => object.id === 'live-test')?.color && !window.__spawnBusy);
  assert.equal(sprites.length, 2, 'live app speakers remain visible without generated artwork');
  assert.deepEqual(errors, []);
  console.log('PASS failed added sprites and live app speakers remain visible without repainting managed originals; no runtime errors');
} finally { release(); await browser.close(); await server.close(); }
