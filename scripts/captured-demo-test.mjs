import assert from 'node:assert/strict';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
const { decodePng } = await import(new URL('node/png.js', import.meta.resolve('pxl-pixelart')).href);
function pixels(bytes) {
  const { w, h, rgba } = decodePng(bytes), data = new Uint32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = ((rgba[i * 4] << 24) | (rgba[i * 4 + 1] << 16) | (rgba[i * 4 + 2] << 8) | rgba[i * 4 + 3]) >>> 0;
  return { w, h, data };
}

// Real bundled media and real Web Audio; no AI or cloud requests.
process.env.VITE_CONVEX_URL = '';
const library = new Map(JSON.parse(await readFile('public/sounds/manifest.json', 'utf8')).map(entry => [entry.id, entry]));
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
  const rooms = [['cafe', 'Rainy café'], ['beach', 'Beach'], ['cyberpunk', 'Cyberpunk city'], ['zen', 'Zen garden']];
  for (const [id] of rooms) {
    const root = `public/demo/${id}`;
    const scene = JSON.parse(await readFile(`${root}/scene.json`, 'utf8'));
    const assets = JSON.parse(await readFile(`${root}/assets.json`, 'utf8'));
    const capture = JSON.parse(await readFile(`${root}/capture.json`, 'utf8'));
    if (capture.preserved) {
      const hash = value => createHash('sha256').update(value).digest('hex');
      assert.equal(hash(await readFile(`${root}/scene.json`)), capture.preserved.sceneSha256, 'background repaint preserves the exact scene');
      assert.equal(hash(JSON.stringify(assets.sprites)), capture.preserved.spritesSha256, 'source icon metadata stays unchanged');
      assert.equal(hash(JSON.stringify(assets.sounds)), capture.preserved.soundsSha256, 'sound bindings stay unchanged');
      for (const [file, digest] of Object.entries(capture.preserved.files))
        assert.equal(hash(await readFile(`${root}/assets/${file}`)), digest, `background repaint preserves ${file}`);
    }
    if (capture.panorama) {
      const panorama = pixels(await readFile(`public${capture.panorama.file}`));
      const order = capture.panorama.wallOrder;
      const panels = await Promise.all(order.map(wall => readFile(`public${assets.environment.textures[wall].url}`).then(pixels)));
      const floor = pixels(await readFile(`public${assets.environment.textures.floor.url}`));
      assert.equal(panorama.w, 640); assert.equal(panorama.h, 112);
      for (const [index, panel] of panels.entries()) for (let y = 0; y < panel.h; y++) {
        const next = panels[(index + 1) % panels.length];
        assert.equal(panel.data[y * panel.w + panel.w - 1], next.data[y * panel.w], 'every wall corner has matching colors at the same height');
        for (let x = 0; x < panel.w; x++)
          assert.equal(panel.data[y * panel.w + x], panorama.data[y * panorama.w + index * panel.w + x], 'walls are consecutive slices of one panorama');
      }
      const sand = panels[0].data[(panels[0].h - 1) * panels[0].w];
      for (const panel of panels) assert.ok(panel.data.slice(-panel.w * 2).every(color => color === sand));
      for (let i = 0; i < floor.w; i++) {
        assert.equal(floor.data[i], sand); assert.equal(floor.data[(floor.h - 1) * floor.w + i], sand);
        assert.equal(floor.data[i * floor.w], sand); assert.equal(floor.data[i * floor.w + floor.w - 1], sand);
      }
      console.log('PASS Beach panorama: all four corner seams, cyclic wrap, shared composition and floor joins');
    }
    assert.equal(scene.objects.length, 3);
    assert.equal(scene.objects.filter(object => object.kind === 'bed').length, 2);
    assert.equal(scene.objects.filter(object => object.kind === 'event').length, 1);
    assert.equal(assets.sprites.length, 3);
    // Each source plays a library sound straight from /sounds/ or its own bundled recording (#141).
    const fromLibrary = scene.objects.filter(object => library.get(object.sound.assetId)?.kind === object.kind);
    assert.equal(fromLibrary.length + assets.sounds.length, 3, 'every source has exactly one sound');
    for (const object of fromLibrary) {
      assert.ok(!assets.sounds.some(sound => sound.objectId === object.id), `${object.id} plays the library, not a copy`);
      assert.ok(capture.sounds.some(sound => sound.objectId === object.id && sound.libraryId === object.sound.assetId), `${object.id} credits its library sound`);
    }
    for (const object of scene.objects.filter(object => !fromLibrary.includes(object)))
      assert.ok(assets.sounds.some(sound => sound.objectId === object.id && object.sound.assetId === `managed:${sound.fileId}:${sound.kind}:${sound.query.replace(/\s+/g, ' ').trim()}`), `${object.id} has its bundled recording`);
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
  await expect(page.getByRole('group', { name: 'Preloaded demo rooms' }).getByRole('button')).toHaveCount(4);
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
    if (id === 'beach') for (let orientation = 0; orientation < 4; orientation++) {
      await page.screenshot({ path: `test-results/beach-cohesion-${orientation}.png` });
      await page.getByRole('button', { name: 'Rotate Right', exact: true }).click();
      await page.waitForFunction(() => !window.__pixelRoom().rotating);
    }
    const scene = JSON.parse(await readFile(`public/demo/${id}/scene.json`, 'utf8'));
    const assets = JSON.parse(await readFile(`public/demo/${id}/assets.json`, 'utf8'));
    const urls = [...assets.sounds.map(sound => sound.url),
      ...scene.objects.filter(object => library.has(object.sound.assetId)).map(object => `/sounds/${library.get(object.sound.assetId).file}`)];
    assert.equal(urls.length, 3);
    const levels = await page.evaluate(async urls => {
      const context = new OfflineAudioContext(1, 1, 44100);
      return Promise.all(urls.map(async url => {
        const decoded = await context.decodeAudioData(await fetch(url).then(response => response.arrayBuffer()));
        const data = decoded.getChannelData(0);
        let peak = 0, energy = 0;
        for (const sample of data) { peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; }
        return { duration: decoded.duration, peak, rms: Math.sqrt(energy / data.length) };
      }));
    }, urls);
    assert.ok(levels.every(sound => sound.duration > 0.2 && sound.peak > 0.001 && Number.isFinite(sound.rms)));
    console.log(`PASS ${label}: 3 sounds (${urls.length - assets.sounds.length} from the library), all artwork, previous audio stopped (${elapsed} ms including reveal); ${JSON.stringify(levels)}`);
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
    const rect = await page.getByRole('region', { name: 'Templates', exact: true }).boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 391 && rect.y + rect.height <= 844);
  }
  await page.reload();
  assert.equal(await page.locator('canvas').count(), 0, 'preloading never creates a room');
  await page.getByRole('button', { name: 'Rainy café', exact: true }).click();
  await page.waitForFunction(() => window.sceneStore.getState().scene.room.art === 'demo-cafe');
  assert.deepEqual(apiCalls, []); assert.deepEqual(errors, []);
  console.log('PASS reload, mobile controls, manual edits and zero generation/cloud dependencies');
} finally { await browser.close(); await server.close(); }
