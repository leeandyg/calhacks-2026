import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`${process.env.TEST_URL ?? 'http://localhost:5173'}/?demo`);
  const choices = ['Rainy Café', 'Beach', 'Cyberpunk City', 'Zen Garden'];
  const templates = page.getByRole('region', { name: 'Templates', exact: true });
  await expect(templates).toBeVisible();
  await templates.getByRole('button', { name: choices[0], exact: true }).click();
  assert.equal(await page.locator('.room-controls .demo-rooms').count(), 0);
  for (const name of choices) await expect(templates.getByRole('button', { name, exact: true })).toBeVisible();
  await templates.getByRole('button', { name: 'Beach', exact: true }).click();
  await page.waitForFunction(() => window.sceneStore.getState().scene.objects.some(object => /surf|ocean|wave/i.test(object.label)));
  const places = page.getByRole('region', { name: 'Saved places', exact: true });
  for (const viewport of [{width:1440,height:900}, {width:390,height:844}, {width:844,height:390}]) {
    await page.setViewportSize(viewport);
    const bounds = await places.boundingBox();
    const prompt = await page.locator('.prompt-bar').boundingBox();
    if (bounds.x + bounds.width > prompt.x) assert.ok(bounds.y + bounds.height < prompt.y, 'Saved places stays clear of the bottom prompt');
    else assert.ok(bounds.y + bounds.height <= viewport.height - 24, 'Saved places fits the sidebar');
  }
  await page.setViewportSize({width:1440,height:900});
  const list = templates.locator('.templates-list');
  await list.evaluate(list => {
    for (let i = 0; i < 60; i++) {
      const item = document.createElement('li');
      item.innerHTML = `<button type="button" class="place-row">Saved place ${i + 1}</button>`;
      list.append(item);
    }
  });
  const overflow = await list.evaluate(el => ({ scrolls: el.scrollHeight > el.clientHeight, scrollbar: getComputedStyle(el).scrollbarWidth }));
  assert.equal(overflow.scrolls, true);
  assert.equal(overflow.scrollbar, 'none');
  await list.hover(); await page.mouse.wheel(0, 600);
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({path:'test-results/templates-and-saves.png'});
  await places.getByRole('button', {name:'New Place',exact:true}).click();
  await expect(templates).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.sceneStore.getState().scene.objects), []);
  assert.deepEqual(errors, []);
  console.log('PASS: Templates available from startup; room switching, list scrolling and reset preserve the empty-shell interface');
} finally { await browser.close(); }
