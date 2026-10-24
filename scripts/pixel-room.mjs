import assert from 'node:assert/strict';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const skill = process.env.PXL_SKILL_DIR ?? join(process.env.HOME, '.claude/skills/pxl-pixel-art');
const cli = join(skill, 'bin/pxl.js');
assert.ok(existsSync(cli), 'Set PXL_SKILL_DIR to the installed pxl-pixel-art skill directory.');
const source = join(root, 'art/pixel-room/room.px.js');
const command = process.argv[2] ?? 'build';
function pxl(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (command === 'serve') {
  pxl('serve', source, '--port', '4321', '--no-preview');
  process.exit(0);
}
if (command === 'build') pxl('build', source, '--only', 'room-base,room-loop,room-frames', '--no-preview');
if (command === 'lint') pxl('lint', source, 'room-base', 'room-loop', '--no-preview');
assert.ok(['build', 'lint', 'verify'].includes(command), 'Use build, lint, verify, or serve.');
const { loadProject } = await import(pathToFileURL(join(skill, 'src/node/load.ts')));
const { lint } = await import(pathToFileURL(join(skill, 'src/core/lint.ts')));
const { Img } = await import(pathToFileURL(join(skill, 'src/core/image.ts')));
const { encodePng } = await import(pathToFileURL(join(skill, 'src/node/png.ts')));
const { encodeGif } = await import(pathToFileURL(join(skill, 'src/node/gif.ts')));
const project = loadProject(source);
const base = project.image('_shell');
const frames = project.frames('room-loop');
const { w, h } = base;
assert.deepEqual([w, h, frames.length], [480, 270, 16]);
assert.equal(frames.reduce((sum, frame) => sum + frame.ms, 0), 1600);
assert.ok(frames.every(frame => frame.ms === 100));
assert.deepEqual(project.image('room-loop', 0, 1600).data, frames[0].img.data, 'loop returns exactly to its starting phase');
assert.deepEqual(project.image('room-base').data, frames[0].img.data);
const colors = new Set();
const allowed = (x, y) => (x >= 188 && x <= 208 && y >= 78 && y <= 129)
  || (x >= 181 && x <= 213 && y >= 146 && y <= 173)
  || (x >= 227 && x <= 253 && y >= 171 && y <= 207);
const diffs = [];
const patches = [];
for (const [index, frame] of frames.entries()) {
  assert.deepEqual(lint(frame.img), [], `pxl lint frame ${index}`);
  let x0 = w, y0 = h, x1 = 0, y1 = 0, changing = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const value = frame.img.get(x, y);
    colors.add(value);
    if (value !== frames[(index + 1) % frames.length].img.get(x, y)) changing++;
    if (value !== base.get(x, y)) {
      assert.ok(allowed(x, y), `unexpected change to static scene at ${x},${y}, frame ${index}`);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  diffs.push(changing);
  const patch = new Img(x1 - x0 + 1, y1 - y0 + 1);
  const composed = base.copy();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const value = frame.img.get(x, y);
    if (value !== base.get(x, y)) {
      patch.set(x - x0, y - y0, value);
      composed.set(x, y, value);
    }
  }
  assert.deepEqual(composed.data, frame.img.data, `base + transparent patch reconstructs frame ${index}`);
  patches.push({ file: `patches/${String(index).padStart(2, '0')}.png`, x: x0, y: y0, width: patch.w, height: patch.h, ms: frame.ms, image: patch });
}
assert.ok(colors.size <= 24, `${colors.size} colors exceeds the palette budget`);
assert.ok(diffs.every(count => count > 0), 'every frame must animate');
assert.ok(diffs.at(-1) <= Math.max(...diffs.slice(0, -1)), 'wrap transition has no extra jump');
const eye = project.assets.get('room-loop').pal.keys.get('e');
assert.equal(frames[3].img.get(193, 155), eye, 'blue bird blinks at 300ms');
assert.notEqual(frames[2].img.get(193, 155), eye);
assert.equal(frames[11].img.get(199, 159), eye, 'gold bird blinks at 1100ms');
assert.notEqual(frames[10].img.get(199, 159), eye);
assert.notEqual(frames[0].img.get(229, 200), frames[4].img.get(229, 200), 'base wobbles one pixel');
const report = { width: w, height: h, frameCount: frames.length, fps: 10, durationMs: 1600, colors: colors.size, lintFindings: 0, lintedFrames: 16, staticPixelsUnchanged: true, patchesReconstructFrames: true, exactPhaseWrap: true, adjacentFramePixelChanges: diffs };
if (command === 'build') {
  const output = join(root, 'public/pixel-room');
  await mkdir(join(output, 'patches'), { recursive: true });
  await writeFile(join(output, 'static-base.png'), encodePng(base));
  await writeFile(join(output, 'room.png'), encodePng(frames[0].img));
  await writeFile(join(output, 'room.gif'), encodeGif(frames));
  // A nearest-neighbor 2× export for viewing/sharing. No additional colors.
  const large = frames.map(frame => {
    const image = new Img(w * 2, h * 2);
    for (let y = 0; y < image.h; y++) for (let x = 0; x < image.w; x++) image.set(x, y, frame.img.get(x >> 1, y >> 1));
    return { img: image, ms: frame.ms };
  });
  await writeFile(join(output, 'room-2x.gif'), encodeGif(large));
  await writeFile(join(output, 'room-2x.png'), encodePng(large[0].img));
  for (const patch of patches) await writeFile(join(output, patch.file), encodePng(patch.image));
  await writeFile(join(output, 'animation.json'), JSON.stringify({ width: w, height: h, fps: 10, durationMs: 1600, colors: colors.size, loop: true, base: 'static-base.png', frames: patches.map(({ image, ...metadata }) => metadata) }, null, 2) + '\n');
  await writeFile(join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  await copyFile(join(root, 'art/pixel-room/out/room-frames.png'), join(output, 'frames.png'));
  await copyFile(join(root, 'art/pixel-room/out/room-frames.json'), join(output, 'frames.json'));
}
console.log(JSON.stringify(report, null, 2));
