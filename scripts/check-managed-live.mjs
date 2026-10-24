import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Reuses one completed live run: real session history, file proxy, art and chirp audio are loaded.
// Only its initial /api/scene reply is replayed, so rerunning this check does not regenerate art.
const run = await readFile('test-results/managed-live-run.json', 'utf8').then(JSON.parse).catch(() => undefined);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], audio = [], progress = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => { if (response.headers()['content-type']?.startsWith('audio/')) audio.push(response.status()); });
if (run) await page.route('**/api/scene', route => route.fulfill({ status: 202, json: run }));
else page.on('response', async response => {
  if (new URL(response.url()).pathname !== '/api/scene') return;
  const started = await response.json().catch(() => null);
  if (started?.kind === 'managed') { await mkdir('test-results', { recursive: true }); await writeFile('test-results/managed-live-run.json', JSON.stringify(started), { mode: 0o600 }); }
});
try {
  await page.goto(process.env.TEST_URL ?? 'http://localhost:5173');
  assert.equal(await page.locator('canvas').count(), 0);
  await page.getByLabel('Prompt', { exact: true }).fill('A peaceful forest clearing with uneven mossy ground and exactly three animated sound sources: a tree rustling in wind, sparrows on a branch, and a small flowing stream');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => window.__pixelRoom?.().scene.room.art?.startsWith('agent-'), { timeout: 60000 });
  await page.waitForFunction(() => window.__pixelRoom().scene.objects.every(object => object.sound.assetId?.startsWith('managed:')));
  await page.waitForFunction(() => !window.__spawnBusy);
  for (let i=0;i<10;i++) { progress.push(await page.evaluate(() => window.__pixelRoom().objects.map(object => ({ id: object.id, frame: object.artFrame })))); await page.waitForTimeout(150); }
  const scene = await page.evaluate(() => window.__pixelRoom().scene);
  assert.equal(scene.objects.length, 3);
  assert.ok(scene.room.terrain?.some(row => row.some(height => height > 0)));
  const bed = scene.objects.find(object => object.kind === 'bed');
  assert.ok(new Set(progress.map(objects => objects.find(object => object.id === bed.id)?.frame)).size > 1, 'generated sprite strip actually animates');
  for (let i=0;i<100 && audio.length<3;i++) await page.waitForTimeout(200);
  assert.ok(audio.length >= 3 && audio.every(status => status === 200), `generated chirp audio loads through the server: ${JSON.stringify(audio)}`);
  await page.getByRole('button', { name: 'Rotate Right', exact: true }).click();
  await page.waitForFunction(() => !window.__pixelRoom().rotating);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/managed-live-forest.png' });
  assert.deepEqual(errors, []);
  console.log('PASS live managed session -> scene, animated pxl sprites, raised terrain, chirp audio and manual rotation');
} finally { await browser.close(); }
