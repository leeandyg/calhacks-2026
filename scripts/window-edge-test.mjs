import { createFixtureRoom } from './create-fixture-room.mjs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const inspect = () => page.evaluate(() => window.__pixelRoom());
const project = position => page.evaluate(position => window.__pixelRoomProject(position), position);
const source = async () => (await inspect()).objects.find(object => object.id === 'rain-1');
const settle = () => page.waitForFunction(() => !window.__pixelRoom().rotating);
async function dragTo(position) {
  const window = await source();
  const center = await project(window.position);
  const target = await project(position);
  await page.mouse.move(...window.screen); await page.mouse.down();
  assert.equal((await inspect()).dragging, 'rain-1');
  await page.mouse.move(target[0] + window.screen[0] - center[0], target[1] + window.screen[1] - center[1], { steps: 10 });
  await page.mouse.up();
  await page.evaluate(() => new Promise(requestAnimationFrame));
}
async function checkEdges(prefix) {
  let state = await inspect();
  const grid = state.scene.room.grid;
  const fixedCamera = state.camera;
  for (const wall of state.walls.filter(wall => wall.opacity === 1)) {
    const alongZ = wall.id === 'east' || wall.id === 'west';
    const length = alongZ ? grid.rows : grid.columns;
    for (const end of [-1, 1]) {
      const current = await source();
      const tangent = end * (length / 2 - 0.02);
      const normal = (wall.id === 'north' || wall.id === 'west' ? -1 : 1) * ((alongZ ? grid.columns : grid.rows) / 2 + 0.1);
      await dragTo(alongZ ? [normal, current.position[1], tangent] : [tangent, current.position[1], normal]);
      state = await inspect();
      const moved = state.objects.find(object => object.id === 'rain-1');
      assert.equal(moved.wall, wall.id);
      assert.equal(moved.muted, false);
      // A wall-mounted source no longer cuts the slab: no wall keeps any opening, and every cell of
      // the destination wall stays a solid segment however far the window is dragged toward a corner.
      assert.ok(state.walls.every(item => (item.openings ?? []).length === 0), 'no source leaves a wall cutout');
      const solid = await page.evaluate(({ wall, length, height }) => {
        for (let column = 0; column < length; column++) for (let level = 0; level < height; level++)
          if (!window.__pixelRoomWallSolid(wall, column, level)) return false;
        return true;
      }, { wall: wall.id, length, height: grid.wallHeight });
      assert.ok(solid, 'raycasts confirm every wall cell is a solid slab segment, including the corners');
      assert.deepEqual(state.camera, fixedCamera);
      await page.screenshot({ path: `test-results/window-edge-${prefix}-${wall.id}-${end}.png` });
    }
  }
}
try {
  await mkdir('test-results', { recursive: true });
  assert.ok((await readdir('public/pixel-room')).every(file => !file.endsWith('.html')), 'there is no separate pixel frontend');
  await page.goto(process.env.TEST_URL ?? 'http://localhost:5173');
  await createFixtureRoom(page);
  await page.waitForFunction(() => window.__pixelRoom?.().rendering && window.__pixelRoomWallSolid && window.__spawnBusy === false);
  const assetCount = (await inspect()).scene.objects.length;
  assert.equal(await page.getByRole('button').count(), 3 + 2 * assetCount, '2 arrows + send, plus disable & delete per asset');
  assert.equal(await page.getByRole('textbox', { name: 'Prompt' }).count(), 1);
  assert.equal(await page.locator('#root canvas').count(), 1, 'original React app hosts the live scene');
  for (let orientation = 0; orientation < 4; orientation++) {
    await checkEdges(`square-${orientation}`);
    await page.getByRole('button', { name: 'Rotate Right', exact: true }).click(); await settle();
  }
  assert.equal((await inspect()).orientation, 0);
  assert.equal((await page.evaluate(() => window.__pixelRoomEdit([{ op: 'set_room', preset: 'bedroom', grid: { mode: 'Rectangle', columns: 6, rows: 4, wallHeight: 3 } }]))).ok, true);
  await page.waitForTimeout(120);
  await checkEdges('rectangle');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(100);
  await page.screenshot({ path: 'test-results/window-edge-mobile.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: original frontend only; window drags to both ends on fully solid walls (no cutouts), four orientations, rectangle and mobile, no browser errors');
} finally { await browser.close(); }
