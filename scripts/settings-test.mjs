import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createFixtureRoom } from './create-fixture-room.mjs';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.route('**/api/voice', route => route.fulfill({ json: route.request().method() === 'GET' ? { configured: true, spokenReplies: false } : { token: 'test-only', version: '2026-08-14' } }));
  await page.routeWebSocket(/api\.cartesia\.ai\/stt\//, socket => { socket.onMessage(() => {}); });
  await page.goto(process.env.TEST_URL ?? 'http://localhost:5173');
  await createFixtureRoom(page);
  const settings = page.getByRole('region', { name: 'Settings', exact: true });
  await expect(settings.getByRole('heading', { name: 'Voice Agent' })).toBeVisible();
  assert.equal(await page.getByRole('button', { name: 'Recenter', exact: true }).count(), 0);
  await expect(settings.getByLabel('Finish automatically', { exact: true })).toBeVisible();
  await expect(settings.getByLabel('Hey agent', { exact: true })).toBeVisible();
  const microphone = page.locator('.prompt-bar').getByRole('button', { name: 'Talk to agent', exact: true });
  await expect(microphone).toBeVisible();
  assert.equal(await microphone.innerText(), '');
  assert.equal(await microphone.locator('svg').count(), 1);
  await expect(microphone).toBeEnabled();
  await microphone.click();
  await expect(page.locator('.prompt-bar').getByRole('button', { name: 'Stop & send', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(microphone).toBeVisible();
  await expect(microphone).toHaveAttribute('aria-pressed', 'false');
  assert.equal(await page.locator('.prompt-tools .agent-activation').count(), 0);
  const finish = settings.getByLabel('Finish automatically', { exact: true });
  await finish.check(); await expect(finish).toBeChecked();
  await finish.uncheck(); await expect(finish).not.toBeChecked();
  const pose = async yaw => page.evaluate(async yaw => {
    const { useHeadPose } = await import('/src/sensors/headPose.ts');
    useHeadPose.setState({ yaw, status: 'tracking' });
  }, yaw);
  await pose(0); await expect(settings.locator('.head-angle')).toHaveText('0°');
  await pose(Math.PI / 6); await expect(settings.locator('.head-angle')).toHaveText('30° left');
  await pose(-Math.PI / 6); await expect(settings.locator('.head-angle')).toHaveText('30° right');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const left = await page.locator('.places-dock').boundingBox();
    const right = await page.locator('.assets-dock').boundingBox();
    assert.ok(Math.abs(left.width - right.width) < 1, 'both sidebars have equal widths');
    const label = await settings.locator('.head-tracking .switch-row').boundingBox();
    const toggle = await settings.locator('.head-tracking .switch').boundingBox();
    const angle = await settings.locator('.head-angle').boundingBox();
    const text = await settings.locator('.head-tracking .switch-label').boundingBox();
    assert.ok(angle.x + angle.width <= text.x, 'angle pill stays to the left of Head tracking');
    assert.ok(Math.abs(label.x + label.width - toggle.x - toggle.width) < 1, 'head toggle sticks to right');
    const float = await settings.getByRole('button', { name: 'Float controls', exact: true }).boundingBox();
    const group = await settings.locator('.agent-activation').boundingBox();
    assert.ok(Math.abs(float.width - group.width) < 1, 'Float controls spans its group');
  }
  await mkdir('test-results', { recursive: true });
  await page.setViewportSize({ width: 844, height: 390 });
  const compact = await settings.boundingBox();
  assert.ok(compact.y + compact.height <= 390, 'Settings remains within a short viewport');
  await settings.getByRole('button', { name: 'Float controls', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/settings-landscape.png' });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: 'test-results/settings-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/settings-controls.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: right-aligned switches, equal sidebar widths, angle pills, prompt microphone and Settings voice controls');
} finally { await browser.close(); }
