import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

// AI/Moss calls are mocked. Convex only supplies an isolated anonymous browser session.
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const scene = JSON.parse(await readFile('public/demo/cafe/scene.json', 'utf8'));
scene.room.preset = 'forest';
let release, started;
const pending = new Promise(resolve => { release = resolve; });
const generation = new Promise(resolve => { started = resolve; });
const records = [], saves = [], errors = [];
let paintings = 0;
page.on('pageerror', error => errors.push(error.message));
try {
  await page.route('**/api/voice', route => route.fulfill({ json: route.request().method() === 'GET'
    ? { configured: true, spokenReplies: false } : { token: 'test-only', version: '2026-08-14' } }));
  await page.route('**/api/environment', route => { paintings++; return route.fulfill({ status: 503, json: { error: 'Mock generation uses bundled artwork.' } }); });
  const reply = async route => {
    const data = route.request().postDataJSON();
    if (data.action === 'list') return route.fulfill({ json: { preferences: records, memory: { provider: 'moss', status: 'configured' } } });
    if (data.action === 'remember') {
      saves.push(data); records.splice(0, records.length, { _id: 'test-preference', updatedAt: Date.now(), ...data });
      return route.fulfill({ json: { message: `Remembered your ${data.task} preference (${data.timeBucket}).`, notice: 'Moss semantic memory is active; preferences are kept in Convex.',
        remembered: { task: data.task, timeBucket: data.timeBucket }, memory: { provider: 'moss', status: 'pending' } } });
    }
    if (data.prompt === 'I am going to code') return route.fulfill({ json: { kind: 'create', restored: true, scene: records[0].scene, recalled: ['coding (any)'], notice: 'Loaded your saved coding room.' } });
    started(); await pending;
    return route.fulfill({ json: { kind: 'create', scene } });
  };
  await page.route('**/api/agent', reply);
  await page.route('**/api/scene', reply);
  await page.goto(server.resolvedUrls.local[0]);
  assert.equal(await page.getByRole('button', { name: 'Remember this room', exact: true }).count(), 0, 'manual controls remain hidden before the first room');
  const prompt = page.getByLabel('Prompt', { exact: true });
  await prompt.fill('I am going to code, bring me to the river');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await generation;
  assert.equal(saves.length, 0, 'the prior scene is never remembered before generation succeeds');
  release();
  await expect.poll(() => saves.length, { timeout: 15000 }).toBe(1);
  assert.equal(saves[0].task, 'coding'); assert.equal(saves[0].timeBucket, 'any');
  assert.equal(saves[0].scene.room.preset, 'forest');
  await expect(prompt).toHaveValue('');
  await page.getByText('Environment memory', { exact: true }).click();
  await expect(page.getByLabel('Preference task')).toHaveValue('coding');
  await expect(page.getByLabel('Preference time')).toHaveValue('any');
  await expect(page.getByText('Moss semantic memory · preferences stored in Convex', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Beach', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await page.waitForFunction(() => window.sceneStore.getState().scene.room.art === 'demo-beach');
  await prompt.fill('I am going to code');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => window.sceneStore.getState().scene.room.preset === 'forest');
  assert.equal(paintings, 1, 'memory recall restores artwork without a new generation');
  assert.equal(saves.length, 1, 'recall does not overwrite memory');
  await expect(prompt).toHaveValue('');
  await page.getByLabel('Preference task').fill('reading');
  await page.getByLabel('Preference time').selectOption('evening');
  await page.getByLabel('Preference notes').fill('Keep the water soft');
  await page.getByRole('button', { name: 'Remember this room', exact: true }).click();
  await expect.poll(() => saves.length).toBe(2);
  assert.equal(saves[1].task, 'reading'); assert.equal(saves[1].timeBucket, 'evening');
  await expect(page.getByRole('button', { name: 'Remember this room', exact: true })).toBeEnabled();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/task-memory-controls.png' });
  assert.deepEqual(errors, []);
  console.log('PASS first-prompt task/place learning, deferred save, Moss status, snapshot recall and manual memory settings');
} finally { release(); await browser.close(); await server.close(); }
