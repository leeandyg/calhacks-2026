import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const inspect = () => page.evaluate(() => window.__pixelRoom());
const source = async id => (await inspect()).objects.find(object => object.id === id);
const project = position => page.evaluate(position => window.__pixelRoomProject(position), position);
const waitFrame = () => page.evaluate(() => new Promise(requestAnimationFrame));
const settle = () => page.waitForFunction(() => !window.__pixelRoom().rotating);
async function dragTo(id, position, release = true) {
  const object = await source(id);
  const center = await project(object.position);
  const destination = await project(position);
  const pointer = [destination[0] + object.screen[0] - center[0], destination[1] + object.screen[1] - center[1]];
  await page.mouse.move(...object.screen); await page.mouse.down();
  assert.equal((await inspect()).dragging, id, `capture ${id}`);
  await page.mouse.move(...pointer, { steps: 8 });
  if (release) { await page.mouse.up(); await page.waitForFunction(() => window.__pixelRoom().dragging === null); }
  await waitFrame();
  return { pointer, original: object };
}
try {
  await page.goto(process.env.TEST_URL ?? 'http://localhost:5173');
  await page.getByRole('button', { name: 'Enter room' }).click(); // browsers need a click before audio
  await page.waitForFunction(() => window.__pixelRoom?.().objects.every(object => typeof object.opacity === 'number') && window.__spawnBusy === false);
  const initial = await inspect();
  assert.ok(!page.url().includes('/pixel-room/'), 'the original app is the only frontend');
  assert.deepEqual(initial.rendering, { interactive: true, pixelated: 'whole-room', objectPixelSize: 3, shellPixelSize: 3, shellSamples: 0, paletteColors: 20 });
  assert.deepEqual(initial.shadows, { enabled: false, casting: 0, receiving: 0 });
  await page.screenshot({ path: 'test-results/grid-desktop.png' });
  const animationStates = [];
  for (let i = 0; i < 17; i++) { animationStates.push((await inspect()).objects); await page.waitForTimeout(100); }
  assert.ok(new Set(animationStates.map(objects => objects.find(object => object.id === 'fan-1').bladeAngle)).size > 5);
  assert.ok(new Set(animationStates.map(objects => objects.find(object => object.id === 'fan-1').fanBaseX)).size > 5);
  assert.ok(new Set(animationStates.map(objects => JSON.stringify(objects.find(object => object.id === 'rain-1').rainPoses))).size > 5);
  assert.ok(new Set(animationStates.map(objects => JSON.stringify(objects.find(object => object.id === 'birds-1').birdPoses.map(pose => pose.y)))).size > 5);
  // A blink lasts one frame; observe it at display cadence instead of sampling
  // every 100ms, which can alias the 10fps animation and miss it entirely.
  for (const bird of [0, 1]) await page.waitForFunction(bird => window.__pixelRoom().objects.find(object => object.id === 'birds-1').birdPoses[bird].blinking, bird, { timeout: 3000 });
  assert.ok(animationStates.every(objects => objects.find(object => object.id === 'birds-1').birdPoses.filter(pose => pose.blinking).length <= 1));

  for (const id of ['fan-1', 'birds-1', 'rain-1']) {
    const original = await source(id);
    await page.mouse.click(...original.screen); await waitFrame();
    let current = await source(id);
    assert.equal(current.muted, true, `${id} mutes on a short click`);
    assert.ok(current.opacity < original.opacity, `${id} fades when muted`);
    const spread = color => Math.max(...color) - Math.min(...color);
    assert.ok(spread(current.color) < spread(original.color), `${id} desaturates`);
    const objectState = (await inspect()).scene.objects.find(object => object.id === id);
    assert.equal(objectState.volume, initial.scene.objects.find(object => object.id === id).volume);
    if (id === 'fan-1') {
      const angle = current.bladeAngle; await page.waitForTimeout(100);
      assert.equal((await source(id)).bladeAngle, angle, 'muted fan animation stops');
      await page.screenshot({ path: 'test-results/grid-muted.png' });
    }
    const frozen = { birds: current.birdPoses, rain: current.rainPoses };
    await page.waitForTimeout(120);
    const muted = await source(id);
    assert.deepEqual({ birds: muted.birdPoses, rain: muted.rainPoses }, frozen, 'muting freezes prop animation');
    await page.mouse.click(...current.screen); await waitFrame();
    current = await source(id); assert.equal(current.muted, false, `${id} unmutes`);
  }
  console.log('PASS: all objects click-mute/unmute, gray fading, saved volume preserved and fan animation stops');

  for (const id of ['rain-1', 'fan-1', 'birds-1']) {
    for (const [wall, x, z] of [['north', 0, -3.7], ['east', 3.7, 0], ['south', 0, 3.7], ['west', -3.7, 0]]) {
      const original = await source(id);
      await dragTo(id, [x, original.position[1], z]);
      const current = await source(id);
      assert.equal(current.wall, wall, `${id} reaches ${wall}`);
      if (id === 'rain-1') {
        const room = await inspect();
        assert.equal(room.walls.find(item => item.id === wall).openings.filter(opening => opening.id === 'source-rain-1').length, 1);
        assert.ok(room.walls.filter(item => item.id !== wall).every(item => !item.openings.some(opening => opening.id === 'source-rain-1')));
      }
      assert.equal(current.muted, false, 'dragging never mutes');
      assert.equal(current.position[1], original.position[1], 'drag preserves height');
    }
  }
  assert.deepEqual((await inspect()).camera, initial.camera);
  console.log('PASS: every source, including the window, reaches all four walls through real pointer drags');

  // A sustained edge hold must never rotate; the former delay was 750ms.
  await page.reload(); await page.getByRole('button', { name: 'Enter room' }).click(); await page.waitForFunction(() => window.__pixelRoom?.().objects.every(object => typeof object.opacity === 'number') && window.__spawnBusy === false);
  const fan = await source('fan-1');
  await dragTo('fan-1', [3.7, fan.position[1], 0], false);
  const edgePosition = (await source('fan-1')).position;
  assert.equal((await source('fan-1')).wall, 'east');
  await page.waitForTimeout(1800);
  assert.equal((await inspect()).rotating, false, 'holding an edge never starts a turn');
  assert.equal((await inspect()).orientation, 0, 'holding an edge never changes orientation');
  assert.deepEqual((await inspect()).camera, initial.camera);
  assert.deepEqual((await source('fan-1')).position, edgePosition);
  await page.mouse.up(); assert.equal((await inspect()).dragging, null);
  assert.equal((await source('fan-1')).muted, false);
  await page.getByRole('button', { name: 'Rotate Right', exact: true }).click(); await settle(); await waitFrame();
  assert.equal((await inspect()).orientation, 3, 'only the button turns the room');
  const original = await source('fan-1');
  await dragTo('fan-1', [0, original.position[1], -3.7], false);
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal((await inspect()).dragging, null);
  assert.deepEqual((await source('fan-1')).position, original.position, 'Escape restores the starting grid placement');
  assert.equal((await inspect()).orientation, 3);
  console.log('PASS: no auto-rotation on sustained edge hold, manual-only turns, rotated grid dragging and cancellation');

  await page.reload(); await page.getByRole('button', { name: 'Enter room' }).click(); await page.waitForFunction(() => window.__pixelRoom?.().objects.every(object => typeof object.opacity === 'number') && window.__spawnBusy === false);
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const tap = async () => {
    const object = await source('fan-1');
    const point = { x: object.screen[0], y: object.screen[1], id: 1 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitFrame();
  };
  await tap(); assert.equal((await source('fan-1')).muted, true);
  const touchFan = await source('fan-1'); const point = { x: touchFan.screen[0], y: touchFan.screen[1], id: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: point.x - step * 6, y: point.y + step * 3 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await waitFrame();
  assert.notDeepEqual((await source('fan-1')).position, touchFan.position);
  assert.equal((await source('fan-1')).muted, true, 'moving a muted object preserves mute');
  await tap(); assert.equal((await source('fan-1')).muted, false);
  assert.equal((await inspect()).dragging, null);
  assert.equal(await page.getByRole('button').count(), 3);
  assert.equal((await page.locator('body').innerText()).trim(), 'Head tracking');
  await page.screenshot({ path: 'test-results/grid-mobile.png' });
  assert.deepEqual(errors, [], 'no browser runtime or console errors');
  console.log('PASS: touch tap mute/unmute, muted dragging, minimal mobile UI, no shadows and no browser errors');
} finally { await browser.close(); }
