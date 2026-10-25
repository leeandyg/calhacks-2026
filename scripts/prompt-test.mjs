import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], requests = [];
// This suite tests prompts and the standard-room fallback. The art pipeline has its own suite.
await page.route('**/api/environment', route => route.fulfill({ json: { error: 'Art disabled for prompt test' } }));
// /api/scene is stubbed: live replies and outages that must never insert fixtures.
let reply;
await page.route('**/api/scene', async route => { requests.push(route.request().postDataJSON()); await reply(route); });
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && !(reply?.outage && message.text().includes('503'))) errors.push(message.text()); });
try {
  await mkdir('test-results', { recursive: true });
  await page.goto(process.env.TEST_URL ?? 'http://localhost:5173');
  const input = page.getByLabel('Prompt', { exact: true }); // a combobox while the offline demo suggests prompts
  const send = page.getByRole('button', { name: 'Send', exact: true });
  const rotate = page.getByRole('button', { name: 'Rotate Right', exact: true });
  assert.equal(await page.locator('[data-beam]').count(), 1);
  assert.equal(await page.locator('form').count(), 1);
  assert.equal(await page.locator('input[type=text]').count(), 1);
  assert.equal(await page.locator('textarea').count(), 0);
  const left = page.getByRole('button', { name: 'Rotate Left', exact: true });
  assert.equal(await page.getByRole('button').count(), 5);
  assert.equal(await page.locator('canvas, .room-rotation, .overlay').count(), 0);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const rect = await page.locator('.prompt-bar').boundingBox();
    assert.ok(Math.abs(rect.x + rect.width / 2 - viewport.width / 2) < 1);
    assert.ok(Math.abs(rect.y + rect.height / 2 - viewport.height / 2) < 1);
    await page.screenshot({ path: `test-results/empty-${viewport.width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await input.getAttribute('placeholder'), 'Generate anything...');
  assert.ok(await send.isDisabled());
  await input.fill('   '); await input.press('Enter');
  assert.ok(await send.isDisabled());
  assert.equal(requests.length, 0);
  assert.deepEqual(await page.evaluate(() => window.sceneStore.getState().scene.objects), [], 'canonical startup contains no hidden dummy objects');
  // A failed first creation leaves the page empty and the original prompt editable.
  reply = route => route.fulfill({ json: { kind: 'edit', ops: [] } });
  await input.fill('Make it quieter'); await send.click();
  await page.getByRole('alert').filter({ hasText: 'Describe a place' }).waitFor();
  assert.equal(requests[0].scene, null);
  assert.equal(await input.inputValue(), 'Make it quieter');
  assert.equal(await page.locator('canvas, .room-rotation').count(), 0);
  const scene = () => page.evaluate(() => window.__pixelRoom().scene);
  // A live create reply, as /api/scene returns it: the fixed grid, unresolved sounds and the agent's
  // props. The resolver binds the sounds; the store keeps the fixed room.
  const grid = { mode: 'Square', columns: 10, rows: 10, wallHeight: 7 };
  reply = route => route.fulfill({ json: { kind: 'create', scene: {
    room: { preset: 'forest', grid, openings: [], reverb: 'outdoor' }, listener: { position: [0, 1.6, 0], yaw: 0 },
    objects: [
      { id: 'creek-1', label: 'Creek', kind: 'bed', sound: { query: 'gentle flowing creek' }, position: [-2, 0.5, 1], volume: 0.5, model: 'speaker' },
      { id: 'rain-1', label: 'Rain on window', kind: 'bed', sound: { query: 'steady rain on glass' }, position: [4.79, 2.5, 0], volume: 0.4, model: 'rain', wall: 'east' },
      { id: 'birds-1', label: 'Birds', kind: 'event', sound: { query: 'sparrow chirps' }, position: [4, 1.5, -3], volume: 0.2, intervalSec: [8, 25], model: 'birds' },
    ] } } });
  const createReply = reply;
  let releaseCreation;
  const pendingCreation = new Promise(resolve => { releaseCreation = resolve; });
  reply = async route => { await pendingCreation; await createReply(route); };
  await input.fill('  A quiet forest room  '); await send.click();
  await page.waitForFunction(() => document.querySelector('form')?.getAttribute('aria-busy') === 'true');
  assert.equal(await page.locator('canvas, .room-rotation').count(), 0,'no starter room while creating');
  const pendingRect = await page.locator('.prompt-bar').boundingBox();
  assert.ok(Math.abs(pendingRect.y + pendingRect.height / 2 - 450) < 1,'progress leaves the prompt centered');
  releaseCreation();
  await page.waitForFunction(() => window.__pixelRoom?.().scene.room.preset === 'forest' && window.__pixelRoom().scene.objects.every(object => object.sound.assetId));
  assert.equal(await rotate.innerText(), '');
  assert.equal(await left.innerText(), '');
  assert.equal(await page.getByRole('button').count(), 7);
  assert.equal(await input.inputValue(), '');
  assert.equal(requests[1].prompt, 'A quiet forest room');
  assert.equal(requests[1].scene, null, 'the first room has no dummy scene context');
  const completedRect = await page.locator('.prompt-bar').boundingBox();
  assert.ok(completedRect.y > 700,'the prompt moves below the created room');
  let current = await scene();
  assert.deepEqual(current.room.grid, grid);
  assert.deepEqual(current.objects.map(object => object.sound.assetId), ['creek', 'rain_window', 'sparrow']);
  assert.deepEqual(current.objects.map(object => object.model), ['speaker', 'rain', 'birds']);
  assert.equal(current.objects[1].wall, 'east');
  assert.ok(await send.isDisabled());
  // A live edit keeps manual state: mute the creek, then let the agent change the rain volume.
  await page.evaluate(() => window.__pixelRoomEdit([{ op: 'set_muted', id: 'creek-1', muted: true }]));
  reply = route => route.fulfill({ json: { kind: 'edit', ops: [{ op: 'set_volume', id: 'rain-1', volume: 0.8 }] } });
  await input.fill('  Make it rainier  '); await input.press('Enter');
  await page.waitForFunction(() => window.__pixelRoom().scene.objects[1].volume === 0.8);
  current = await scene();
  assert.equal(current.objects[0].muted, true);
  assert.equal(await input.inputValue(), '');
  // A sound the pack lacks, with ElevenLabs off (the default, #97): no /api/sound request and no
  // "generating…" label; it plays the closest pack sound, or the Claude agent's chirp file when there is one.
  let soundRequests = 0;
  await page.route('**/api/sound*', route => { soundRequests++; return route.fulfill({ status: 503, json: { error: 'off' } }); });
  await page.evaluate(() => window.__pixelRoomEdit([{ op: 'add', object: { id: 'cat-1', label: 'Cat purring', kind: 'bed', sound: { query: 'a cat purring softly' }, position: [1.5, 1, -1.5], volume: 0.4 } }]));
  await page.waitForFunction(() => window.__pixelRoom().scene.objects.find(o => o.id === 'cat-1')?.sound.assetId);
  await page.waitForTimeout(1000);
  assert.equal(soundRequests, 0, 'live generation is off by default');
  assert.equal(await page.locator('.sound-status').count(), 0);
  await page.evaluate(() => window.__pixelRoomEdit([{ op: 'remove', id: 'cat-1' }]));
  // A live outage tries Gemini by name, then loads the offline room with a notice that says so (#110).
  reply = Object.assign(route => route.fulfill({ status: 503, json: { error: 'Scene generation unavailable' } }), { outage: true });
  const sentBeforeOutage = requests.length;
  await input.fill('cabin'); await send.click();
  await page.getByRole('status').filter({ hasText: 'Offline:' }).waitFor();
  assert.deepEqual(requests.slice(sentBeforeOutage).map(body => body.engine), [undefined, 'gemini']);
  const offlineRoom = await scene();
  assert.equal(offlineRoom.room.preset, 'cabin', 'the offline Cabin preset');
  assert.equal(await input.inputValue(), '');
  // A prompt the offline demo has no recording for keeps the room and stays editable.
  await input.fill('paint the walls blue'); await send.click();
  await page.waitForFunction(() => document.querySelector('form')?.getAttribute('aria-busy') === 'false');
  assert.match(await page.getByRole('alert').innerText(), /^Offline:.*kept unchanged/);
  assert.deepEqual(await scene(), offlineRoom);
  assert.equal(await input.inputValue(), 'paint the walls blue', 'a failed prompt stays editable');
  await page.waitForFunction(() => !window.__spawnBusy);
  const before = await page.evaluate(() => window.__pixelRoom().orientation);
  await rotate.click(); await page.waitForFunction(() => !window.__pixelRoom().rotating);
  assert.equal(await page.evaluate(() => window.__pixelRoom().orientation), (before + 3) % 4);
  await left.click(); await page.waitForFunction(() => !window.__pixelRoom().rotating);
  assert.equal(await page.evaluate(() => window.__pixelRoom().orientation), before, 'left reverses right');
  await input.fill('Hover check'); await send.hover(); await page.waitForTimeout(180);
  assert.ok(await send.evaluate(button => new DOMMatrix(getComputedStyle(button).transform).m42 < 0));
  await input.fill(''); await page.mouse.move(10, 10);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.prompt-send')).opacity === '0.45');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 780 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(180);
    const layout = await page.evaluate(() => {
      const bar = document.querySelector('.prompt-bar'), input = bar.querySelector('input'), send = bar.querySelector('.prompt-send'), arrows = [...document.querySelectorAll('.rotate-room')];
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
      return { bar: rect(bar), send: rect(send), arrows: arrows.map(rect), arrowStyles: arrows.map(button => ({ border: getComputedStyle(button).borderWidth, background: getComputedStyle(button).backgroundColor })), color: getComputedStyle(input).color, background: getComputedStyle(bar).backgroundColor, radius: getComputedStyle(bar).borderRadius, fontSize: getComputedStyle(input).fontSize, placeholder: getComputedStyle(input, '::placeholder').color, opacity: getComputedStyle(send).opacity, bounds: window.__pixelRoom().bounds, overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight };
    });
    assert.ok(Math.abs(layout.bar.width - Math.min(640, viewport.width * .92)) < 1);
    assert.equal(layout.bar.height, 76); assert.equal(layout.radius, '999px');
    assert.deepEqual([layout.send.width, layout.send.height], [44, 44]);
    assert.equal(layout.background, 'rgb(42, 44, 51)');
    assert.equal(layout.color, 'rgb(232, 232, 240)');
    assert.equal(layout.fontSize, '22px');
    assert.equal(layout.placeholder, 'rgb(122, 122, 144)');
    assert.equal(layout.opacity, '0.45');
    assert.ok(layout.bounds.bottom < layout.bar.y, 'room clears the taller prompt');
    assert.ok(layout.arrows[0].right <= layout.bounds.left + 0.5 && layout.arrows[1].x >= layout.bounds.right - 0.5, 'arrows flank the room without overlapping it');
    assert.ok(layout.arrows.every(arrow => arrow.x >= 0 && arrow.right <= viewport.width && arrow.y > layout.bounds.top && arrow.bottom < layout.bounds.bottom));
    assert.ok(layout.arrowStyles.every(style => style.border === '0px' && style.background === 'rgba(0, 0, 0, 0)'));
    assert.equal(layout.overflow, false);
    await page.screenshot({ path: `test-results/prompt-${viewport.width}.png` });
  }
  // The captured choices need no extra selectors; ?demo also retains saved prompt replay.
  assert.equal(await page.locator('select, input[type=checkbox]:not(.head-tracking input)').count(), 0);
  await page.goto(`${process.env.TEST_URL ?? 'http://localhost:5173'}/?demo`);
  assert.equal(await page.locator('canvas').count(), 0,'demo also starts empty');
  const sent = requests.length;
  await input.fill("Rainy Tokyo cafe, I'm writing an essay."); await send.click();
  await page.waitForFunction(() => window.__pixelRoom?.().scene.room.preset === 'cafe');
  assert.match(await page.getByRole('status').innerText(), /Demo mode/);
  assert.equal(requests.length, sent, '?demo sends no AI requests');
  assert.deepEqual(errors, []);
  console.log('PASS: one BorderBeam pill, specified dimensions/colors, blank input guard, live create/edit and safe live-failure prompts through /api/scene, icon rotation, desktop/mobile/landscape clearance and no browser errors');
} finally { await browser.close(); }
