import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';

process.env.VITE_CONVEX_URL = '';
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const sockets = [], errors = [];
const watchdog = setTimeout(() => { console.error('Floating UI test exceeded 90 seconds'); process.exit(1); }, 90_000);
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined }));
await context.route('**/api/voice', route => route.fulfill({ json: route.request().method() === 'GET'
  ? { configured: true, spokenReplies: false } : { token: 'test-only', version: '2026-08-14' } }));
await context.routeWebSocket(/api\.cartesia\.ai\/stt\//, socket => { sockets.push(socket); socket.onMessage(() => {}); });
await context.route('**/float-font-test.css', route => route.fulfill({ contentType: 'text/css', body: '@font-face { font-family: "Pixelify Sans"; src: url("/fonts/pixelify-sans.ttf"); font-weight: 400 700; }' }));
try {
  await mkdir('test-results', { recursive: true });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.evaluate(() => document.fonts.ready);
  // Production loads external CSS; cover that path alongside Vite's inline styles.
  await page.addStyleTag({ url: `http://127.0.0.1:${server.httpServer.address().port}/float-font-test.css` });
  await page.evaluate(async () => {
    const react = await import('/node_modules/.vite/deps/react.js');
    const client = await import('/node_modules/.vite/deps/react-dom_client.js');
    const React = react.default ?? react;
    const { createRoot } = client.default ?? client;
    const { VoiceAgentControls } = await import('/src/ai/AgentControls.tsx');
    const host = document.createElement('div'); host.id = 'float-test';
    host.style.cssText = 'position:fixed;bottom:0;right:0;width:280px;z-index:10;background:var(--ui-panel)';
    document.body.append(host);
    window.floatTestRoot = createRoot(host);
    window.floatTestRoot.render(React.createElement(VoiceAgentControls, { token: 'test-only', disabled: false, demoMode: false, refresh: 0, onContext: () => {},
      onCommand: async () => { throw new Error('This is a deliberately long error message to verify that the compact microphone controls stay visible without any scrolling. '.repeat(4)); } }));
  });
  const [floating] = await Promise.all([page.waitForEvent('popup'), page.locator('#float-test').getByRole('button', { name: 'Float controls', exact: true }).click()]);
  floating.on('pageerror', error => errors.push(error.message));
  await floating.setViewportSize({ width: 300, height: 240 });
  await floating.bringToFront();
  await expect(floating.getByRole('heading', { name: 'roomto.study', exact: true })).toBeVisible();
  assert.equal(await floating.title(), 'roomto.study');
  await floating.waitForFunction(() => [...document.fonts].some(font => font.family.includes('Pixelify Sans') && font.status === 'loaded'));
  const noScroll = async () => {
    assert.ok(await floating.evaluate(() => document.body.scrollHeight <= innerHeight && document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth), 'no document scrolling');
    for (const control of [floating.locator('.floating-mic'), floating.getByRole('button', { name: 'Stop voice', exact: true }), floating.getByRole('button', { name: 'Close controls', exact: true }), floating.locator('.switch')]) {
      const box = await control.boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 300 && box.y + box.height <= 240, 'all controls fit');
    }
  };
  const background = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  const sameTheme = async () => {
    const main = await page.locator('.settings-panel').evaluate(el => getComputedStyle(el).backgroundColor);
    await expect.poll(() => floating.locator('.floating-voice-panel').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(main);
  };
  const grey = await background();
  assert.equal(grey, 'rgb(17, 23, 30)');
  await sameTheme(); await noScroll();
  await floating.screenshot({ path: 'test-results/floating-compact-grey.png', timeout: 5000 });
  const colors = [];
  for (const name of ['Rainy Café', 'Beach', 'Cyberpunk City', 'Zen Garden']) {
    await page.getByRole('region', { name: 'Templates', exact: true }).getByRole('button', { name, exact: true }).click();
    await page.waitForFunction(() => window.sceneStore.getState().scene.objects.length === 3 && !window.__spawnBusy);
    await sameTheme(); await noScroll(); colors.push(await background());
    await floating.screenshot({ path: `test-results/floating-${name.split(' ')[0].toLowerCase()}.png` });
  }
  assert.equal(new Set(colors).size, 4, 'each environment has its own background');
  await page.getByRole('button', { name: 'New Place', exact: true }).click();
  await expect.poll(background).toBe(grey); await sameTheme();
  await floating.getByRole('button', { name: 'Talk to agent', exact: true }).click();
  await expect(floating.locator('.floating-mic')).toHaveAttribute('aria-pressed', 'true');
  await noScroll();
  await floating.screenshot({ path: 'test-results/floating-compact-listening.png' });
  const liveSocket = sockets.at(-1);
  await page.getByRole('region', { name: 'Templates', exact: true }).getByRole('button', { name: 'Beach', exact: true }).click();
  await sameTheme();
  await expect(floating.locator('.floating-mic')).toHaveAttribute('aria-pressed', 'true');
  assert.equal(sockets.at(-1), liveSocket, 'changing colors keeps the current voice connection');
  sockets.at(-1).send(JSON.stringify({ type: 'turn.end', transcript: 'a deliberately long voice command '.repeat(10) }));
  await expect(floating.getByRole('alert')).toContainText('deliberately long error');
  await noScroll();
  await floating.screenshot({ path: 'test-results/floating-compact-error.png' });
  await floating.getByLabel('Hey agent', { exact: true }).check();
  await expect(floating.locator('.floating-mic')).toHaveAttribute('aria-pressed', 'true');
  await noScroll();
  await floating.getByRole('button', { name: 'Stop voice', exact: true }).click();
  await expect(floating.locator('.floating-mic')).toHaveAttribute('aria-pressed', 'false');
  await floating.getByRole('button', { name: 'Close controls', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log('PASS: compact branded mic window, no scrolling in idle/listening/error/wake states, live matching palettes, grey reset, stop and close controls');
} catch (error) { console.error(error); throw error; }
finally { clearTimeout(watchdog); await browser.close(); await server.close(); }
