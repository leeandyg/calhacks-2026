import assert from 'node:assert/strict';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

// Real bundled media and real Web Audio; no AI or cloud requests.
process.env.VITE_CONVEX_URL = '';
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], apiCalls = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/**', route => { apiCalls.push(route.request().url()); return route.abort(); });
await page.addInitScript(() => {
  window.demoSources = [];
  const Native = window.AudioBufferSourceNode;
  window.AudioBufferSourceNode = new Proxy(Native, { construct(target, args) {
    const source = Reflect.construct(target, args);
    if (args[0] instanceof OfflineAudioContext) return source;
    const record = { room: window.sceneStore?.getState().scene.room.art, started: false, stopped: false, loop: source.loop };
    const start = source.start.bind(source), stop = source.stop.bind(source);
    source.start = (...args) => { record.started = true; return start(...args); };
    source.stop = (...args) => { record.stopped = true; return stop(...args); };
    source.addEventListener('ended', () => { record.stopped = true; });
    window.demoSources.push(record);
    return source;
  } });
});
try {
  await mkdir('test-results', { recursive: true });
  const rooms = [['cafe', 'Rainy café'], ['beach', 'Beach'], ['cyberpunk', 'Cyberpunk city']];
  for (const [id] of rooms) {
    const root = `public/demo/${id}`;
    const scene = JSON.parse(await readFile(`${root}/scene.json`, 'utf8'));
    const assets = JSON.parse(await readFile(`${root}/assets.json`, 'utf8'));
    assert.equal(scene.objects.length, 3);
    assert.equal(scene.objects.filter(object => object.kind === 'bed').length, 2);
    assert.equal(scene.objects.filter(object => object.kind === 'event').length, 1);
    assert.equal(assets.sprites.length, 3); assert.equal(assets.sounds.length, 3);
    assert.equal(Object.keys(assets.environment.textures).length, 5);
    assert.ok(!JSON.stringify({ scene, assets }).includes('/api/'));
    for (const image of [...Object.values(assets.environment.textures), ...assets.sprites]) {
      const png = await readFile(`public${image.url}`);
      assert.equal(png.readUInt32BE(16), image.w * image.frames);
      assert.equal(png.readUInt32BE(20), image.h);
    }
    for (const sound of assets.sounds) assert.ok((await stat(`public${sound.url}`)).size > 100);
  }
  await page.goto(origin);
  assert.equal(await page.locator('canvas').count(), 0);
  await expect(page.getByRole('group', { name: 'Preloaded demo rooms' }).getByRole('button')).toHaveCount(3);
  for (const [id, label] of rooms) {
    const start = Date.now();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(id => window.sceneStore?.getState().scene.room.art === `demo-${id}`, id);
    await page.waitForFunction(id => window.demoSources.filter(source => source.room === `demo-${id}` && source.loop && source.started && !source.stopped).length === 2, id);
    await page.waitForFunction(() => !window.__spawnBusy && window.__pixelRoom?.().objects.every(object => object.artFrame >= 0));
    const elapsed = Date.now() - start;
    await expect.poll(() => page.evaluate(id => window.demoSources.filter(source => source.started && !source.stopped && source.room !== `demo-${id}`).length, id)).toBe(0);
    await page.waitForFunction(id => window.demoSources.some(source => source.room === `demo-${id}` && !source.loop && source.started), id);
    await page.screenshot({ path: `test-results/captured-${id}-desktop.png` });
    const levels = await page.evaluate(async id => {
      const assets = await fetch(`/demo/${id}/assets.json`).then(response => response.json());
      const context = new OfflineAudioContext(1, 1, 44100);
      return Promise.all(assets.sounds.map(async sound => {
        const decoded = await context.decodeAudioData(await fetch(sound.url).then(response => response.arrayBuffer()));
        const data = decoded.getChannelData(0);
        let peak = 0, energy = 0;
        for (const sample of data) { peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; }
        return { duration: decoded.duration, peak, rms: Math.sqrt(energy / data.length) };
      }));
    }, id);
    assert.ok(levels.every(sound => sound.duration > 0.2 && sound.peak > 0.001 && Number.isFinite(sound.rms)));
    console.log(`PASS ${label}: 3 local sounds, all artwork, previous audio stopped (${elapsed} ms including reveal); ${JSON.stringify(levels)}`);
  }
  // Movement and mute remain canonical, and another selection restores that bundle's snapshot.
  const changed = await page.evaluate(() => {
    const store = window.sceneStore.getState(), object = store.scene.objects[0];
    return store.applyOps([{ op: 'move', id: object.id, position: [1.5, 1, 1.5] }, { op: 'set_muted', id: object.id, muted: true }]);
  });
  assert.equal(changed.ok, true);
  for (const [id, label] of rooms) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(id => window.sceneStore.getState().scene.room.art === `demo-${id}` && !window.__spawnBusy, id);
    await page.screenshot({ path: `test-results/captured-${id}-mobile.png` });
    const rect = await page.getByRole('group', { name: 'Preloaded demo rooms' }).boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 391 && rect.y + rect.height <= 844);
  }
  await page.reload();
  assert.equal(await page.locator('canvas').count(), 0, 'preloading never creates a room');
  await page.getByRole('button', { name: 'Rainy café', exact: true }).click();
  await page.waitForFunction(() => window.sceneStore.getState().scene.room.art === 'demo-cafe');
  assert.deepEqual(apiCalls, []); assert.deepEqual(errors, []);
  console.log('PASS reload, mobile controls, manual edits and zero generation/cloud dependencies');
} finally { await browser.close(); await server.close(); }
