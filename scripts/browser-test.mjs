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
const settle = async () => {
  await page.waitForFunction(() => !document.querySelector('[aria-label="Rotate Right"]').disabled);
  await page.evaluate(() => new Promise(requestAnimationFrame));
};
try {
  await page.goto(process.env.TEST_URL ?? 'http://localhost:5173');
  await page.getByRole('button', { name: 'Enter room' }).click(); // browsers need a click before audio
  await page.waitForFunction(() => window.__pixelRoom?.().objects.every(object => object.model));
  const initial = await inspect();
  const verify = async turn => {
    const current = await inspect();
    assert.ok(Math.abs(current.angle - turn * Math.PI / 2) < 1e-10);
    assert.equal(current.walls.filter(wall => wall.opacity === 0).length, 2);
    assert.equal(current.walls.filter(wall => wall.opacity === 1).length, 2);
    assert.deepEqual(current.camera, initial.camera);
    assert.deepEqual(current.scene, initial.scene, 'view rotation never changes scene coordinates');
    assert.ok(current.windowOpacities.length > 10);
    assert.ok(current.windowOpacities.every(opacity => Math.abs(opacity - (0.2 + 0.8 * current.walls.find(wall => wall.id === initial.scene.objects.find(object => object.model === 'rain').wall).opacity)) < 1e-9));
    assert.deepEqual(current.shadows, { enabled: false, casting: 0, receiving: 0 });
    assert.ok(current.bounds.left >= 0 && current.bounds.top >= 0 && current.bounds.right <= 1440 && current.bounds.bottom < 824);
  };
  assert.equal(await page.getByRole('button').count(), 3, 'two rotation arrows and one send button');
  assert.deepEqual(initial.scene.room.grid, { mode: 'Square', columns: 10, rows: 10, wallHeight: 7 });
  assert.equal(initial.floorModules, 100);
  assert.equal(initial.walls.find(wall => wall.id === 'west').modules, 64);
  assert.equal(initial.walls.find(wall => wall.id === 'east').modules, 70);
  assert.equal(initial.shell.floorThickness, 0.42);
  assert.equal(initial.shell.floorColor, '969aa3');
  assert.ok(initial.shell.walls.every(wall => wall.thickness === initial.shell.floorThickness && wall.color === initial.shell.floorColor && wall.childCount === 1), 'same gray slab material, fixed equal thickness, no cap or baseboard');
  assert.deepEqual(initial.shell.surfaceDetails, [], 'plain rooms have no surface speckles');
  assert.equal(initial.camera.orthographic, true);
  const offset = initial.camera.position.map((value, i) => value - initial.camera.target[i]);
  assert.ok(Math.abs(offset[0] - offset[2]) < 1e-9);
  assert.ok(Math.abs(Math.atan2(offset[1], Math.hypot(offset[0], offset[2])) - Math.PI / 6) < 1e-9);
  assert.equal(await page.getByRole('button', { name: 'Rotate Right', exact: true }).evaluate(el => getComputedStyle(el).boxShadow), 'none');
  assert.equal((await page.locator('body').innerText()).replace(await page.locator('.demo-controls').innerText(), '').trim(), '', 'besides the demo controls, controls have icons and a placeholder only');
  assert.equal(await page.locator('header,nav,footer,textarea,h1,h2').count(), 0);
  assert.equal(await page.locator('label,select').count(), await page.locator('.demo-controls label, .demo-controls select').count(), 'labels and selects only in the demo controls');
  assert.deepEqual(initial.objects.map(object => object.model).sort(), ['birds', 'fan', 'rain']);
  const canvas = await page.locator('canvas').boundingBox();
  assert.deepEqual([canvas.x, canvas.y, canvas.width, canvas.height], [0, 0, 1440, 900], 'full-viewport canvas');
  await verify(0);
  await page.screenshot({ path: 'test-results/grid-square.png' });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(150);
  const measured = await page.evaluate(() => {
    const project = window.__pixelRoomProject;
    const left = project([-5.21, -0.42, 5.21]);
    const right = project([5.21, -0.42, -5.21]);
    const front = project([5.21, -0.42, 5.21]);
    const top = project([-5.21, 7, -5.21]);
    return { floorSlope: (front[1] - left[1]) / (front[0] - left[0]), outlineRatio: (front[1] - top[1]) / (right[0] - left[0]), top: top[1] };
  });
  assert.ok(Math.abs(measured.floorSlope - 0.5) < 1e-8, 'reference 1:2 floor-edge slope');
  assert.ok(Math.abs(measured.outlineRatio - 0.9355) < 0.005, 'reference wall/floor silhouette ratio');
  assert.ok(measured.top > 45 && measured.top < 80, 'room moved upward to leave prompt-bar clearance');
  await page.screenshot({ path: 'test-results/reference-matched-1920.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(100);

  await page.getByRole('button', { name: 'Rotate Right', exact: true }).click();
  await page.waitForTimeout(170);
  const moving = await inspect();
  assert.ok(moving.angle < 0 && moving.angle > -Math.PI / 2, 'right is clockwise');
  assert.ok(await page.getByRole('button', { name: 'Rotate Right', exact: true }).isDisabled());
  await settle(); await verify(3);
  for (const turn of [2, 1, 0]) {
    await page.getByRole('button', { name: 'Rotate Right', exact: true }).click(); await settle(); await verify(turn);
    await page.screenshot({ path: `test-results/minimal-orientation-${turn}.png` });
  }
  assert.equal((await inspect()).angle, 0, 'four right turns return exactly home');
  await page.evaluate(() => { const button = document.querySelector('[aria-label="Rotate Right"]'); for (let i = 0; i < 10; i++) button.click(); });
  await settle(); await verify(3);
  for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Rotate Right', exact: true }).click(); await settle(); }
  await verify(0);
  console.log('PASS: icon controls, modular square room, independent wall height, exact manual rotation, fixed camera and no shadows');
  assert.equal((await page.evaluate(() => window.__pixelRoomEdit([{ op: 'set_room', preset: 'forest' }]))).ok, true);
  await page.waitForFunction(() => window.__pixelRoom().shell.floorColor === '828c79');
  await page.waitForTimeout(100);
  const forest = await inspect();
  assert.ok(forest.shell.walls.every(wall => wall.thickness === 0.42 && wall.color === forest.shell.floorColor));
  assert.ok(forest.shell.surfaceDetails.some(detail => detail.wall && detail.count > 0), 'forest slabs have small dirt and moss pixels');
  const checkDetails = current => {
    for (const detail of current.shell.surfaceDetails.filter(detail => detail.wall)) {
      const wall = current.walls.find(wall => wall.id === detail.wall);
      assert.equal(detail.opacity, wall.opacity, 'surface pixels fade with their own wall');
      assert.equal(detail.visible, wall.visible, 'no floating pixels on hidden walls');
    }
  };
  checkDetails(forest);
  await page.screenshot({ path: 'test-results/slab-forest-desktop.png' });
  await page.getByRole('button', { name: 'Rotate Right', exact: true }).click();
  await page.waitForTimeout(320);
  checkDetails(await inspect());
  await settle();
  for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Rotate Right', exact: true }).click(); await settle(); checkDetails(await inspect()); }
  assert.deepEqual((await inspect()).camera, forest.camera, 'environment changes never alter the camera');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/slab-forest-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  console.log('PASS: fixed equal gray slabs, seamless surfaces, adaptive forest dirt, synchronized detail fading and mobile forest rendering');
  const editResult = await page.evaluate(() => window.__pixelRoomEdit([{ op: 'set_room', preset: 'bedroom', grid: { mode: 'Rectangle', columns: 10, rows: 6, wallHeight: 4 }, openings: [{ id: 'door-1', kind: 'door', wall: 'west', column: 1, level: 0, span: 1, height: 2 }] }]));
  assert.equal(editResult.ok, true);
  await page.waitForFunction(() => window.__pixelRoom().floorModules === 60);
  await page.waitForTimeout(150);
  const rectangle = await inspect();
  assert.equal(rectangle.shell.floorThickness, 0.42);
  assert.ok(rectangle.shell.walls.every(wall => wall.thickness === 0.42));
  assert.deepEqual(rectangle.shell.surfaceDetails, [], 'returning to a plain room removes all dirt pixels');
  assert.equal(rectangle.walls.find(wall => wall.id === 'north').modules, 40);
  assert.equal(rectangle.walls.find(wall => wall.id === 'west').modules, 16);
  assert.ok(rectangle.bounds.left >= 0 && rectangle.bounds.top >= 0 && rectangle.bounds.right <= 1440 && rectangle.bounds.bottom < 824);
  await page.screenshot({ path: 'test-results/grid-rectangle.png' });
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Rotate Right', exact: true }).click(); await settle();
    const current = await inspect();
    assert.deepEqual(current.camera, rectangle.camera);
    assert.deepEqual(current.scene, rectangle.scene);
    assert.ok(current.bounds.left >= 0 && current.bounds.top >= 0 && current.bounds.right <= 1440 && current.bounds.bottom < 824);
  }
  assert.equal((await inspect()).orientation, 0);
  console.log('PASS: 10-by-6 rectangle, modular doorway and moving-window cutout, complete framing at all four orientations');
  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 780 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), 'no page overflow');
    const rect = await page.locator('canvas').boundingBox();
    assert.equal(rect.width, viewport.width); assert.equal(rect.height, viewport.height);
    const bounds = (await inspect()).bounds;
    assert.ok(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= viewport.width && bounds.bottom < viewport.height - 76);
    assert.equal(await page.getByRole('button').count(), 3);
    await page.getByRole('button', { name: 'Rotate Right', exact: true }).click(); await settle();
    await page.screenshot({ path: `test-results/grid-${viewport.width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: desktop, mobile portrait/landscape, no scrolling, working rotation and no browser errors');
} finally { await browser.close(); }
