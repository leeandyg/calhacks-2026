import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { createFixtureRoom } from './create-fixture-room.mjs';
const { decodePng } = await import(new URL('node/png.js', import.meta.resolve('pxl-pixelart')).href);

// Exercise real pointer hit testing and the GPU outline without calling providers.
process.env.VITE_CONVEX_URL = '';
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const inspect = () => page.evaluate(() => window.__pixelRoom());
const leave = async () => {
  await page.mouse.move(4, 4);
  await page.waitForFunction(() => window.__pixelRoom().hovered === null);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
};
async function hover(id) {
  const state = await inspect(), object = state.objects.find(object => object.id === id);
  // Painted floor sprites rise from their canonical floor anchor; stock geometry
  // and wall sprites are centered on it. Find a real hit, never set hover state.
  const points = [object.screen, ...await page.evaluate(position => [0.4, 0.8, 1.2, 1.6].map(y => window.__pixelRoomProject([position[0], y, position[2]])), object.position)];
  for (const point of points) {
    await page.mouse.move(...point);
    if ((await inspect()).hovered === id) {
      await expect(page.getByRole('tooltip')).toHaveText(state.scene.objects.find(object => object.id === id).label);
      const label = await page.getByRole('tooltip').boundingBox();
      assert.ok(label.y + label.height < point[1], 'sound name sits above the item');
      return point;
    }
  }
  assert.fail(`No pointer hit for ${id}`);
}
async function outline(id, name) {
  await leave();
  const before = await inspect();
  const baseline = decodePng(await page.locator('canvas').screenshot());
  const point = await hover(id);
  const highlighted = decodePng(await page.locator('canvas').screenshot());
  let outlinePixels = 0;
  for (let i = 0; i < baseline.rgba.length; i += 4) {
    if (highlighted.rgba[i] === 225 && highlighted.rgba[i + 1] === 217 && highlighted.rgba[i + 2] === 193 &&
        (baseline.rgba[i] !== 225 || baseline.rgba[i + 1] !== 217 || baseline.rgba[i + 2] !== 193)) outlinePixels++;
  }
  assert.ok(outlinePixels > 15, `visible pixel outline for ${id}: ${outlinePixels}`);
  assert.deepEqual((await inspect()).scene, before.scene, 'hover never changes the scene or audio');
  await page.screenshot({ path: `test-results/hover-${name}.png` });
  return point;
}
try {
  await mkdir('test-results', { recursive: true });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await createFixtureRoom(page);
  await page.waitForFunction(() => !window.__spawnBusy && window.__pixelRoom?.().objects.every(object => object.opacity));
  // Freeze animation so screenshot changes measure hover, including muted props.
  await page.evaluate(() => window.sceneStore.getState().applyOps(window.sceneStore.getState().scene.objects.map(object => ({ op: 'set_muted', id: object.id, muted: true }))));
  for (const id of ['rain-1', 'fan-1', 'birds-1']) await outline(id, id);
  let point = await hover('fan-1');
  await page.mouse.click(...point);
  assert.equal((await inspect()).scene.objects.find(object => object.id === 'fan-1').muted, false);
  await expect(page.getByRole('tooltip')).toHaveText('Gentle fan');
  await page.mouse.move(...point); await page.mouse.down();
  await page.mouse.move(point[0] + 55, point[1] + 20, { steps: 8 });
  assert.equal((await inspect()).dragging, 'fan-1');
  await expect(page.getByRole('tooltip')).toHaveText('Gentle fan');
  await page.mouse.up();
  assert.equal((await inspect()).dragging, null);
  assert.equal((await inspect()).scene.objects.find(object => object.id === 'fan-1').muted, false, 'drag does not toggle mute');
  await hover('birds-1');
  await page.evaluate(() => window.sceneStore.getState().applyOps([{ op: 'remove', id: 'birds-1' }]));
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await hover('rain-1');
  await page.getByRole('button', { name: 'Rotate Right', exact: true }).click();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.waitForFunction(() => !window.__pixelRoom().rotating);
  console.log('PASS stock outlines, labels, leave, click mute, drag, removal and rotation');

  await page.getByRole('button', { name: 'Rainy café', exact: true }).click();
  await page.waitForFunction(() => window.sceneStore.getState().scene.room.art === 'demo-cafe' && !window.__spawnBusy && window.__pixelRoom().objects.every(object => object.artFrame >= 0));
  await page.evaluate(() => window.sceneStore.getState().applyOps(window.sceneStore.getState().scene.objects.map(object => ({ op: 'set_muted', id: object.id, muted: true }))));
  for (const object of (await inspect()).objects) await outline(object.id, object.id);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await hover((await inspect()).objects[0].id);
  await page.getByRole('button', { name: 'Beach', exact: true }).click();
  await page.waitForFunction(() => window.sceneStore.getState().scene.room.art === 'demo-beach' && !window.__spawnBusy);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await leave();
  const object = (await inspect()).objects[0];
  point = await hover(object.id);
  await page.screenshot({ path: 'test-results/hover-mobile.png' });
  await leave();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point[0], y: point[1], id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  assert.equal((await inspect()).hovered, null, 'touch does not leave a sticky hover');
  assert.deepEqual(errors, []);
  console.log('PASS painted sprite silhouettes, room replacement, blur, mobile framing and touch cleanup; no browser errors');
} finally { await browser.close(); await server.close(); }
