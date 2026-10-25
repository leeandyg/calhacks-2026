import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// A fresh anonymous browser session saves only the bundled public demo; no generation providers.
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/voice', route => route.fulfill({ json: { configured: false, spokenReplies: false } }));
try {
  await page.goto(`${process.env.TEST_URL ?? 'http://localhost:5173'}/?demo`);
  const saved = page.getByRole('region', { name: 'Saved places', exact: true });
  const name = saved.getByLabel('Place name', { exact: true });
  const save = saved.getByRole('button', { name: 'Save place', exact: true });
  const load = saved.getByRole('button', { name: 'Load 8-bit Save Test', exact: true });
  await expect(save).toBeDisabled();
  await page.getByRole('region', { name: 'Templates', exact: true }).getByRole('button', { name: 'Beach', exact: true }).click();
  await page.waitForFunction(() => window.__pixelRoom?.().scene.objects.length === 3 && window.__spawnBusy === false);
  await name.fill('   '); await expect(save).toBeDisabled();
  await name.fill(' 8-bit Save Test '); await expect(save).toBeEnabled({ timeout: 20000 });
  assert.equal(await saved.locator('.place-load').count(), 0, 'visiting a template does not save it');
  await save.click();
  await expect(saved.getByText('Saved 8-bit Save Test.', { exact: true })).toBeVisible();
  await expect(load).toBeVisible();
  await expect(name).toHaveValue('8-bit Save Test');
  const volume = page.locator('.asset-volume').first();
  await volume.focus(); await page.keyboard.press('ArrowLeft');
  const snapshot = await page.evaluate(() => window.sceneStore.getState().scene);
  await save.click();
  await expect(save).toBeEnabled();
  await expect(saved.locator('.place-load')).toHaveCount(1, { timeout: 10000 });
  await saved.getByRole('button', { name: 'New Place', exact: true }).click();
  await page.waitForFunction(() => window.__pixelRoom().objects.length === 0 && window.__pixelRoom().avatar === null);
  await expect(name).toHaveValue('');
  await expect(save).toBeDisabled();
  await load.click();
  await expect(saved.getByText('Loaded 8-bit Save Test.', { exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.sceneStore.getState().scene), snapshot, 'named load restores the exact updated scene');
  await page.reload();
  await page.waitForFunction(() => window.__pixelRoom?.().objects.length === 0);
  await expect(load).toBeVisible({ timeout: 15000 });
  await load.click();
  await expect(saved.getByText('Loaded 8-bit Save Test.', { exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.sceneStore.getState().scene), snapshot, 'save survives a page reload');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/saved-places-desktop.png' });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const control of [name, save, load]) {
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      const prompt = await page.locator('.prompt-bar').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, 'saved-place controls fit horizontally');
      assert.ok(box.y + box.height < prompt.y, 'the prompt never covers a saved-place control');
    }
    await page.screenshot({ path: `test-results/saved-places-${viewport.width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: explicit named save, whitespace guard, update without duplicate, reset, exact load and reload persistence, accessible mobile/landscape controls');
} finally { await browser.close(); }
