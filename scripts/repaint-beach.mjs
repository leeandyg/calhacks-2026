import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

// One panorama, sliced in the room's north/east/south/west order. Model code stays
// in the existing QuickJS renderer. Sounds, source art and the scene are read-only.
const root = 'public/demo/beach';
const scratch = '.convex/beach-panorama';
const walls = ['north', 'east', 'south', 'west'];
const width = 160, height = 112;
const { decodePng, encodePng } = await import(new URL('node/png.js', import.meta.resolve('pxl-pixelart')).href);
function pixels(bytes) {
  const { w, h, rgba } = decodePng(bytes), data = new Uint32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = ((rgba[i * 4] << 24) | (rgba[i * 4 + 1] << 16) | (rgba[i * 4 + 2] << 8) | rgba[i * 4 + 3]) >>> 0;
  return { w, h, data };
}
const hash = value => createHash('sha256').update(value).digest('hex');
process.env.VITE_CONVEX_URL = '';
const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
const { renderPxl, pxlDocs } = await server.ssrLoadModule('/server/pxl.ts');
const { ManagedAssets } = await server.ssrLoadModule('/src/ai/world.ts');
const Paint = z.object({
  concept: z.string().min(1).max(1500), shell: z.string().regex(/^#[a-f0-9]{6}$/i),
  colors: z.array(z.string().regex(/^#[a-f0-9]{6}$/i)).min(8).max(24),
  code: z.string().min(1).max(60000),
});
const brief = `Paint ONE continuous, horizontally wrapping tropical coastline panorama and its sandy floor in polished pixel art.
Define ONLY a sprite named '_panorama' at 640x112 and a sprite named 'floor' at 160x160.
Our trusted exporter stamps consecutive 160px slices into north, east, south, west wall textures.
All four views belong to one place, time of day and palette; do not design independent panels.
Use the SAME perfectly level ocean horizon at y=60 across the entire 640px width.
Sky occupies y=0..59, turquoise ocean y=60..93, a thin pale foam edge near y=94,
and warm sand y=96..111. All four corners must wrap seamlessly, including x=639 to x=0.
Sky: soft blue upper sky warming to peach/cream near the horizon, a few elegant connected clouds,
one small warm sun around x=70,y=34, soft atmospheric distance. Ocean: muted teal depth bands,
subtle irregular horizontal wavelets and restrained highlights, no giant alternating rainbow stripes.
Keep the far coastline minimal, low and coherent. Broad clean shapes, deliberate fine detail,
3-4 shades per material, sparse texture, no noisy dithering or confetti. A convincing calm beach.
The floor is pale warm sand with subtle wind ripples; its outermost 2px match the panorama's bottom
2px uniformly so every wall meets the same sand. No separate shoreline on only one floor edge.
No palms, gulls, props, signage, boats, objects, text or cast shadows: existing source icons remain.
Use a cohesive palette compatible with the original turquoise water, beige palm trunk, green fronds
and ivory gull. Shell is a readable warm sand midtone. Fully opaque surfaces, flat ground.
Reuse pxl parts and a few short shape loops, not per-pixel drawing loops. The renderer supports
a 640px INTERNAL part; only the five small output slices are exported. Do not create wall outputs.`;

async function paint() {
  if (process.argv.includes('--reuse')) return JSON.parse(await readFile(`${scratch}/result.json`));
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  assert.ok(apiKey, 'Configure GEMINI_API_KEY before repainting.');
  const client = new GoogleGenAI({ apiKey });
  let feedback = '', previousCode = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    console.log(`beach: painting one continuous panorama (attempt ${attempt + 1})`);
    const result = await client.interactions.create({
      model: process.env.GEMINI_ART_MODEL?.trim() || 'gemini-3.8-flash', store: false,
      system_instruction: `You are a pixel artist painting a coherent beach environment. Call paint_beach with complete pxl code.\n${pxlDocs()}`,
      input: `${brief}${feedback ? `\nRepair this: ${feedback}\nPrevious code:\n${previousCode}` : ''}`,
      tools: [{ type: 'function', name: 'paint_beach', description: 'Submit the cohesive panorama and floor.', parameters: {
        type: 'object', properties: { concept: { type: 'string' }, shell: { type: 'string' }, colors: { type: 'array', items: { type: 'string' } }, code: { type: 'string' } },
        required: ['concept', 'shell', 'colors', 'code'], additionalProperties: false,
      } }],
      generation_config: { tool_choice: 'any', thinking_level: 'low', max_output_tokens: 8192 },
    }, { timeout: 70_000, retries: { strategy: 'attempt-count-backoff', maxRetries: 0 } });
    const call = result.steps.find(step => step.type === 'function_call');
    const parsed = Paint.safeParse(call?.arguments);
    if (!parsed.success) { feedback = 'Supply concept, shell, 8-24 hex colors, and complete code.'; continue; }
    previousCode = parsed.data.code;
    const cuts = walls.map((wall, index) => `sprite('__wall_${wall}',{w:${width},h:${height}},stamp('_panorama',-${index * width},0));`).join('\n');
    const rendered = await renderPxl(`${previousCode}\n${cuts}`, [...walls.map(wall => `__wall_${wall}`), 'floor']);
    if (!rendered.ok) { feedback = rendered.error; continue; }
    if (Object.entries(rendered.assets).some(([name, asset]) => asset.transparent || asset.w !== width || asset.h !== (name === 'floor' ? width : height))) {
      feedback = 'All surfaces must be completely opaque, panorama 640x112 and floor 160x160.'; continue;
    }
    const output = { ...parsed.data, assets: rendered.assets, prompt: brief };
    await writeFile(`${scratch}/result.json`, JSON.stringify(output));
    return output;
  }
  throw new Error('Could not paint a valid continuous beach panorama. Existing beach is unchanged.');
}

try {
  await mkdir(scratch, { recursive: true });
  const result = await paint();
  const assets = JSON.parse(await readFile(`${root}/assets.json`));
  const capture = JSON.parse(await readFile(`${root}/capture.json`));
  const images = walls.map(wall => pixels(Buffer.from(result.assets[`__wall_${wall}`].png, 'base64')));
  // Two adjacent samples represent the same room corner. Share their endpoint color exactly;
  // the composition comes from a single panorama, so this touches just one column per side.
  for (let index = 0; index < 4; index++) {
    const left = images[index], right = images[(index + 1) % 4];
    for (let y = 0; y < height; y++) right.data[y * width] = left.data[y * width + width - 1];
  }
  const floor = pixels(Buffer.from(result.assets.floor.png, 'base64'));
  const sand = images[0].data[(height - 1) * width + width / 2];
  for (const image of images) image.data.fill(sand, (height - 2) * width);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++)
    if (x < 2 || y < 2 || x >= width - 2 || y >= width - 2) floor.data[y * width + x] = sand;
  const panorama = { w: 640, h: height, data: new Uint32Array(640 * height) };
  for (const [index, image] of images.entries()) for (let y = 0; y < height; y++)
    panorama.data.set(image.data.subarray(y * width, (y + 1) * width), y * 640 + index * width);
  const preserved = capture.preserved;
  assert.ok(preserved, 'Beach must have an existing preservation record.');
  assert.equal(hash(await readFile(`${root}/scene.json`)), preserved.sceneSha256);
  assert.equal(hash(JSON.stringify(assets.sprites)), preserved.spritesSha256);
  assert.equal(hash(JSON.stringify(assets.sounds)), preserved.soundsSha256);
  for (const [file, digest] of Object.entries(preserved.files)) assert.equal(hash(await readFile(`${root}/assets/${file}`)), digest);
  const backup = `${scratch}/backup-${Date.now()}`;
  await mkdir(backup, { recursive: true });
  for (const name of ['assets.json', 'capture.json']) await copyFile(`${root}/${name}`, `${backup}/${name}`);
  for (const surface of ['floor', ...walls]) await copyFile(`${root}/assets/${surface}.png`, `${backup}/${surface}.png`);
  const iconColors = new Set();
  for (const sprite of assets.sprites) {
    const png = pixels(await readFile(`public${sprite.url}`));
    for (const color of png.data) if ((color & 255) > 0) iconColors.add(`#${(color >>> 8).toString(16).padStart(6, '0')}`);
  }
  const colors = new Set([...iconColors, ...result.colors]);
  for (const image of [...images, floor]) for (const color of image.data) colors.add(`#${(color >>> 8).toString(16).padStart(6, '0')}`);
  assert.ok(colors.size <= 48, 'Keep the panorama and original source icons within 48 colors.');
  for (const [index, wall] of walls.entries()) {
    await writeFile(`${root}/assets/${wall}.png`, encodePng(images[index]));
    assets.environment.textures[wall] = { url: `/demo/beach/assets/${wall}.png`, w: width, h: height, frames: 1, fps: 10 };
  }
  await writeFile(`${root}/assets/floor.png`, encodePng(floor));
  await writeFile(`${root}/panorama.png`, encodePng(panorama));
  assets.environment.concept = result.concept;
  assets.environment.shell = result.shell;
  assets.environment.colors = [...colors];
  capture.backgroundUpdatedAt = new Date().toISOString();
  capture.backgroundPrompt = brief;
  capture.backgroundArtwork = 'Gemini/pxl: one continuous panorama';
  capture.panorama = { file: '/demo/beach/panorama.png', wallOrder: walls, width: 640, height, panelWidth: width, horizon: 60, sandStart: 110 };
  ManagedAssets.parse(assets);
  await writeFile(`${root}/assets.json`, JSON.stringify(assets, null, 2) + '\n');
  await writeFile(`${root}/capture.json`, JSON.stringify(capture, null, 2) + '\n');
  console.log(`beach: one panorama applied; all four corners match, ${colors.size} shared colors; sounds, icons and scene preserved`);
} catch (error) {
  console.error(error && typeof error === 'object' && 'status' in error
    ? `Beach art provider returned HTTP ${error.status}. Existing audio and icons are unchanged.`
    : error instanceof Error ? error.message : 'Beach panorama generation failed.');
  process.exitCode = 1;
} finally { await server.close(); }
