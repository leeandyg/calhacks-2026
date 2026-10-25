import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

// Exercise the real loading surfaces without invoking an AI provider or Convex.
process.env.VITE_CONVEX_URL = '';
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
await server.listen();
const channel = process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
// Expected mocked provider HTTP failures are separate from graphics/runtime errors.
page.on('console', message => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text());
});
let release;
const pending = new Promise(resolve => { release = resolve; });
const timeout = setTimeout(() => { console.error('FAIL: generation froze the test browser'); process.exit(1); }, 45_000);
try {
  await page.addInitScript(() => {
    window.loadingGlContexts = 0;
    const canvases = new WeakSet();
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...options) {
      const context = getContext.call(this, type, ...options);
      if (/^webgl2?$/.test(type) && context && !canvases.has(this)) {
        canvases.add(this); window.loadingGlContexts++;
      }
      return context;
    };
  });
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/scene') {
      await pending;
      return route.fulfill({ json: { kind: 'create', scene } });
    }
    return route.fulfill({ status: 503, json: { error: 'No providers in the loading regression test.' } });
  });
  await page.goto(server.resolvedUrls.local[0]);
  const scene = await page.evaluate(async () => (await import('/src/scene/fixtures.ts')).starter);
  const prompt = page.getByLabel('Prompt', { exact: true });
  await prompt.fill('A quiet room for studying');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => window.__pixelRoom?.()?.rendering);
  // Multiple frames and a timer must still run while the generation stays pending.
  await page.evaluate(() => new Promise(resolve => {
    let frames = 0;
    const next = () => ++frames < 12 ? requestAnimationFrame(next) : setTimeout(resolve, 300);
    requestAnimationFrame(next);
  }));
  assert.equal(await page.evaluate(() => window.loadingGlContexts), 1, 'the loader never opens a second WebGL context');
  assert.equal(await page.locator('.scene-error strong').count(), 0);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/generation-loading.png' });
  release();
  await expect(prompt).toHaveValue('');
  await page.waitForFunction(() => window.__pixelRoom?.().scene.objects.length > 0);
  await prompt.fill('Make it rainier');
  await expect(prompt).toHaveValue('Make it rainier');
  await page.getByRole('button', { name: 'Rainy café', exact: true }).click();
  await page.waitForFunction(() => window.__pixelRoom?.().scene.room.art === 'demo-cafe');
  assert.equal(await page.evaluate(() => window.loadingGlContexts), 1);
  assert.deepEqual(errors, []);
  console.log(`PASS: responsive loading, one graphics context, typing and demo transition (${channel ?? 'Chromium'})`);
} finally {
  release();
  await browser.close();
  await server.close();
  clearTimeout(timeout);
}
