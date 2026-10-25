import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(`${process.env.TEST_URL ?? 'http://localhost:5173'}/?demo`);
  await page.getByLabel('Prompt', { exact: true }).fill('forest');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => window.__pixelRoom?.().avatarReady);
  await page.evaluate(() => {
    const store = window.sceneStore.getState();
    store.setScene({ ...store.scene, room: { ...store.scene.room, art: undefined, terrain: undefined }, objects: [0, 1, 2].map(i => ({ id: `speaker-${i}`, model: 'speaker', label: `Speaker ${i}`, kind: 'bed', sound: { query: 'brown noise', assetId: 'brown_noise' }, scale: 1, volume: 0.3, muted: false, wall: null, position: [i - 1, 1, 3] })) });
  });
  await page.waitForFunction(() => !window.__spawnBusy);
  async function drag(id, target, cancel = false) {
    const points = await page.evaluate(({ id, target }) => {
      const object = window.__pixelRoom().objects.find(o => o.id === id);
      const start = window.__pixelRoomProject(object.position);
      const end = window.__pixelRoomProject(target);
      return { start: object.screen, end: [object.screen[0] + end[0] - start[0], object.screen[1] + end[1] - start[1]] };
    }, { id, target });
    await page.mouse.move(...points.start); await page.mouse.down();
    await page.mouse.move(...points.end, { steps: 15 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up(); await page.waitForTimeout(100);
  }
  await drag('speaker-0', [0, 1, 0]);
  assert.equal(await page.evaluate(() => window.__pixelRoom().avatar[1].toFixed(3)), '1.725');
  await drag('speaker-1', [0, 1, 0]);
  assert.equal(await page.evaluate(() => window.__pixelRoom().avatar[1].toFixed(3)), '3.225');
  assert.deepEqual(await page.evaluate(() => window.sceneStore.getState().scene.objects.slice(0, 2).map(o => o.position)), [[0, 1, 0], [0, 2.5, 0]]);
  await page.screenshot({ path: 'test-results/speaker-stack.png' });
  await drag('speaker-2', [0, 1, 0]);
  assert.equal(await page.evaluate(() => window.sceneStore.getState().scene.objects.filter(o => o.position[0] === 0 && o.position[2] === 0).length), 2);
  await drag('speaker-1', [0, 2.5, 3], true);
  assert.deepEqual(await page.evaluate(() => window.sceneStore.getState().scene.objects.slice(0, 2).map(o => o.position)), [[0, 1, 0], [0, 2.5, 0]], 'Escape restores both stack heights');
  await page.evaluate(() => window.__pixelRoomEdit([{ op: 'remove', id: 'speaker-0' }]));
  await page.waitForFunction(() => Math.abs(window.__pixelRoom().avatar[1] - 1.725) < 0.001);
  // Freeze waiting portals to inspect their planes through manual room rotation.
  await page.evaluate(async () => {
    const { addEnvironment, setSprite, spriteKey } = await import('/src/art/store.ts');
    const store = window.sceneStore.getState();
    const env = 'portal-surface-test';
    addEnvironment({ id: env, concept: 'test', managed: true, shell: '#969aa3', colors: [], terrain: Array.from({ length: 10 }, () => Array(10).fill(0)), textures: {} });
    const sources = [
      { ...store.scene.objects[0], id: 'floor-portal', model: 'speaker', wall: null, position: [2, 1, 2] },
      { ...store.scene.objects[0], id: 'wall-portal', model: 'rain', wall: 'north', position: [-2, 2, -4] },
    ];
    for (const source of sources) setSprite(spriteKey(env, source), { status: 'painting' });
    store.setScene({ ...store.scene, room: { ...store.scene.room, art: env }, objects: sources });
  });
  await page.waitForTimeout(250);
  for (let turn = 0; turn < 2; turn++) {
    const portals = await page.evaluate(() => window.__pixelRoom().objects);
    assert.deepEqual(portals[0].portalRotation, [-Math.PI / 2, 0, 0]);
    assert.deepEqual(portals[0].portalPosition, [2, 0.025, 2]);
    assert.deepEqual(portals[1].portalRotation, [0, 0, 0]);
    assert.deepEqual(portals[1].portalPosition, [-2, 2.5, -4.765]);
    await page.screenshot({ path: `test-results/portal-surfaces-${turn}.png` });
    await page.getByRole('button', { name: 'Rotate Right', exact: true }).click();
    await page.waitForFunction(() => !window.__pixelRoom().rotating);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: real pointer drags stack two speakers, reject a third, restore on Escape, and settle after deletion; portals stay on floor/wall planes through rotation');
} finally { await browser.close(); }
