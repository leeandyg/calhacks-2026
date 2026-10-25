import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(`${process.env.TEST_URL ?? 'http://localhost:5173'}/?demo`);

  // The sidebar is hidden before a room; templates sit above the centered prompt.
  assert.equal(await page.locator('.places-dock').isVisible(), false);
  const preloaded = await page.getByRole('group', { name: 'Preloaded demo rooms' }).boundingBox();
  const prompt = await page.locator('.prompt-bar').boundingBox();
  assert.ok(preloaded.y + preloaded.height < prompt.y);
  const sidebar = page.getByRole('region', { name: 'Visited places' });

  // The center no longer has the Save/Load room bar.
  assert.equal(await page.getByRole('button', { name: 'Save room' }).count(), 0, 'no Save room button');
  assert.equal(await page.getByRole('button', { name: 'Load room' }).count(), 0, 'no Load room button');
  assert.equal(await page.getByPlaceholder('Room name').count(), 0, 'no Room name input');

  // Enter a room, then New Place returns to the empty centered-prompt start.
  await page.getByRole('button', { name: 'Rainy Café', exact: true }).click();
  await page.waitForFunction(() => window.__pixelRoom?.().objects?.length > 0);
  assert.equal(await page.locator('canvas').count(), 1, 'a room is shown');

  await sidebar.getByRole('button', { name: 'New Place', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('canvas') === null);
  assert.deepEqual(await page.evaluate(() => window.sceneStore.getState().scene.objects), [], 'New Place clears to an empty scene');
  for (const choice of ['Rainy Café', 'Beach', 'Cyberpunk City', 'Zen Garden'])
    await page.getByRole('button', { name: choice, exact: true }).waitFor();

  assert.deepEqual(errors, []);
  console.log('PASS: sidebar hidden initially, preloaded choices above prompt, Save/Load bar gone, New Place clears to the empty start');
} finally { await browser.close(); }
