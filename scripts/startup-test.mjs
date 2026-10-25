import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/voice', route => route.fulfill({ json: route.request().method() === 'GET'
  ? { configured: true, spokenReplies: false } : { token: 'test-only', version: '2026-08-14' } }));
await page.routeWebSocket(/api\.cartesia\.ai\/stt\//, socket => { socket.onMessage(() => {}); });
try {
  await page.goto(process.env.TEST_URL ?? 'http://localhost:5173');
  const empty = async () => {
    await page.waitForFunction(() => window.__pixelRoom?.().objects.length === 0);
    const state = await page.evaluate(() => window.__pixelRoom());
    assert.deepEqual(state.scene.objects, []);
    assert.equal(state.scene.room.art, undefined);
    assert.equal(state.scene.room.terrain, undefined);
    assert.equal(state.scene.session, undefined);
    assert.equal(state.avatar, null, 'the initial shell contains no avatar');
    assert.equal(await page.locator('.prompt-intro, .initial-title, .room-controls-centered, .initial-places').count(), 0);
    assert.equal(await page.getByRole('region', { name: 'Visited places', exact: true }).count(), 0);
    assert.equal(await page.getByText('Hold Ctrl+Shift+Space', { exact: false }).count(), 0);
    await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    for (const name of ['Templates', 'Saved places', 'Assets', 'Settings']) await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
    assert.match(await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily), /Pixelify Sans/);
  };
  await empty();
  await page.evaluate(() => document.fonts.ready);
  await mkdir('test-results', { recursive: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const prompt = await page.locator('.prompt-bar').boundingBox();
    assert.ok(prompt.y > viewport.height / 2 && prompt.y + prompt.height <= viewport.height, 'prompt starts below the shell');
    assert.equal(await page.locator('canvas').count(), 1);
    await page.screenshot({ path: `test-results/empty-room-${viewport.width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('region', { name: 'Templates', exact: true }).getByRole('button', { name: 'Beach', exact: true }).click();
  await page.waitForFunction(() => window.__pixelRoom().scene.room.art === 'demo-beach' && window.__pixelRoom().avatarReady);
  await page.getByRole('button', { name: 'New Place', exact: true }).click();
  await empty();
  await page.reload(); await empty();
  assert.deepEqual(errors, []);
  console.log('PASS: empty shell on startup/reset/reload, no welcome/idle hint, pixel font, ready prompt and panels, demo reveals sources/avatar, desktop/mobile/landscape');
} finally { await browser.close(); }
