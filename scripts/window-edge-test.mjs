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
      const opening = state.walls.find(item => item.id === wall.id).openings.find(opening => opening.id === 'source-rain-1');
      assert.ok(opening.column === 1 || opening.column + opening.span === length - 1, 'window clamps to nearest safe end cell');
      assert.ok(opening.column >= 1 && opening.column + opening.span <= length - 1);
      assert.ok(state.walls.filter(item => item.id !== wall.id).every(item => !item.openings.some(opening => opening.id === 'source-rain-1')), 'old wall cutout is closed');
      const actualPanels = await page.evaluate(({wall, length, opening}) => {
        const results = [];
        for (let level = opening.level; level < opening.level + opening.height; level++) {
          results.push(window.__pixelRoomWallSolid(wall, 0, level));
          results.push(window.__pixelRoomWallSolid(wall, length - 1, level));
        }
        results.push(!window.__pixelRoomWallSolid(wall, opening.column, opening.level));
        return results;
      }, { wall: wall.id, length, opening });
      assert.ok(actualPanels.every(Boolean), 'raycasts confirm solid corner posts and a correctly aligned window opening');
      assert.deepEqual(state.camera, fixedCamera);
      await page.screenshot({ path: `test-results/window-edge-${prefix}-${wall.id}-${end}.png` });
    }
  }
}
try {
  await mkdir('test-results', { recursive: true });
  assert.ok((await readdir('public/pixel-room')).every(file => !file.endsWith('.html')), 'there is no separate pixel frontend');
  await page.goto(process.env.TEST_URL ?? 'http://localhost:5173');
  await page.getByRole('button', { name: 'Enter room' }).click(); // browsers need a click before audio
  await page.waitForFunction(() => window.__pixelRoom?.().rendering && window.__pixelRoomWallSolid && window.__spawnBusy === false);
  assert.equal(await page.getByRole('button').count(), 3);
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
  console.log('PASS: original frontend only; real window drags to both ends, solid corner posts, no stale cutouts, four orientations, rectangle and mobile, no browser errors');
} finally { await browser.close(); }
