import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(`${process.env.TEST_URL ?? 'http://localhost:5173'}/?demo`);
  assert.equal(await page.locator('canvas').count(), 0, 'avatar does not reveal the room before submission');
  await page.getByLabel('Prompt', { exact: true }).fill('forest');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => window.__pixelRoom?.().avatarReady);
  const user = page.getByRole('region', { name: 'Assets' }).locator('[data-avatar="user"]');
  await user.getByText('You', { exact: true }).waitFor();
  assert.deepEqual((await page.evaluate(() => window.__pixelRoom().avatar)).filter((_, i) => i !== 1), [0, 0]);
  await mkdir('test-results', { recursive: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/bear-avatar-forest.png' });
  // Entirely replace the world, including all sound sources. The view-only avatar survives.
  const replace = async preset => page.evaluate(preset => {
    const store = window.sceneStore.getState();
    const terrain = Array.from({ length: 10 }, () => Array(10).fill(0));
    terrain[4][4] = 1.25;
    return store.setScene({ ...store.scene, room: { preset, grid: store.scene.room.grid, openings: [], reverb: 'none', terrain }, objects: [] });
  }, preset);
  for (const preset of ['bedroom', 'cafe', 'cabin', 'library', 'forest']) {
    assert.equal((await replace(preset)).ok, true);
    await page.waitForFunction(() => window.__pixelRoom().avatar?.[1] === 1.275);
    assert.deepEqual(await page.evaluate(() => window.__pixelRoom().avatar), [0, 1.275, 0]);
    assert.deepEqual(await page.evaluate(() => window.sceneStore.getState().scene.objects), [], 'bear is never an audible/generated source');
  }
  const views = ['front-right', 'front-left', 'back-left', 'back-right'];
  for (let turn = 0; turn < 4; turn++) {
    await page.getByRole('button', { name: 'Rotate Right', exact: true }).click();
    await page.waitForFunction(() => !window.__pixelRoom().rotating);
    assert.deepEqual(await page.evaluate(() => window.__pixelRoom().avatar), [0, 1.275, 0]);
    assert.equal(await page.evaluate(() => window.__pixelRoom().avatarDirection), views[turn]);
    const sprite = await user.locator('img').getAttribute('src');
    assert.ok(sprite.endsWith(views[turn] === 'front-left' ? '/berkeley-bear.png' : `/berkeley-bear-${views[turn]}.png`));
    assert.equal(await user.getByRole('button').count(), 0, 'user is permanent even when every sound has been removed');
    await page.waitForFunction(() => window.__pixelRoom().avatarReady);
    await page.screenshot({ path: `test-results/bear-${views[turn]}.png` });
  }
  await page.evaluate(() => {
    const store = window.sceneStore.getState();
    return store.setScene({ ...store.scene, room: { ...store.scene.room, terrain: undefined } });
  });
  await page.waitForFunction(() => window.__pixelRoom().avatar?.[1] === 0.025);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/bear-avatar-center.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/bear-avatar-mobile.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: centered bear survives all presets, empty worlds, raised terrain, four rotations and mobile rendering without browser errors');
} finally { await browser.close(); }
