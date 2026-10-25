import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createServer } from 'vite';

// Run once using the app's server handlers, then commit only public/demo. Resume files contain
// temporary provider capabilities and stay in the ignored .convex directory.
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const rooms = {
  cafe: { label: 'Rainy café', prompt: 'Capture a beautifully detailed cozy cafe in the rain, with warm amber lighting, dark walnut floor, brick and plaster cafe walls, large rain-streaked windows and rich coherent pixel art. EXACTLY THREE sound objects: rain pattering against a glass window (bed), a working espresso machine with steady steam hiss (bed), and a porcelain cup and saucer clinking once (event, random gaps 12-25 seconds). Give every sound its recognizable animated physical source sprite. No speech or music. Only these three objects; no decorative freestanding objects. Preserve the normal full room dimensions. Use restrained detailed material shading, readable silhouettes and a cohesive palette.' },
  beach: { label: 'Beach', prompt: 'Capture a beautiful tranquil tropical beach at golden hour in rich coherent pixel art. Paint the sandy floor with a shallow turquoise water edge, and the fixed walls as a continuous ocean horizon and warm sky. EXACTLY THREE sound objects: gently breaking ocean surf (bed, a small animated waterline pool), sea breeze rustling a palm (bed, a recognizable palm tree), and a seagull calling once (event, gull perched on driftwood, random gaps 15-30 seconds). No speech or music. Only these three objects; no decorative freestanding objects. Preserve the normal full room dimensions. Use restrained detailed material shading, readable silhouettes and a cohesive palette.' },
  cyberpunk: { label: 'Cyberpunk city', prompt: 'Capture a beautiful atmospheric cyberpunk city street at night in rich coherent pixel art: violet and cyan neon, wet pavement reflections, detailed architecture painted into the fixed wall surfaces, warm windows, readable midtone slab edges. EXACTLY THREE sound objects: rain pattering on wet street pavement (bed, an animated puddle), a ventilation unit humming (bed, a recognizable industrial vent), and a futuristic electric vehicle passing once (event, a small hovering vehicle, random gaps 12-25 seconds). No speech, sirens or music. Only these three objects; no decorative freestanding objects. Preserve the normal full room dimensions. Use restrained detailed material shading, readable silhouettes and a cohesive palette.' },
};
const selected = process.argv.slice(2);
for (const id of selected) assert.ok(rooms[id], `Unknown demo room: ${id}`);
process.env.VITE_CONVEX_URL = ''; // no cloud writes while capturing a local bundle
const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
const { ManagedResult, ManagedAssets } = await server.ssrLoadModule('/src/ai/world.ts');
const { Scene } = await server.ssrLoadModule('/src/scene/scene.ts');
const { matchSound } = await server.ssrLoadModule('/src/audio/resolve.ts');
const manifest = JSON.parse(await readFile('public/sounds/manifest.json', 'utf8'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = filename => readFile(filename, 'utf8').then(JSON.parse).catch(() => undefined);
async function api(url, options = {}) {
  const target = new URL(url, 'http://localhost');
  assert.ok(/^\/api\/(scene|world|sound)$/.test(target.pathname), 'Only app media endpoints can be captured.');
  const handlers = await server.ssrLoadModule(`${target.pathname}.ts`);
  const response = await handlers[options.method ?? 'GET'](new Request(target, options));
  if (!response.ok && response.status !== 202) throw new Error(`Demo API returned HTTP ${response.status}`);
  return response;
}
async function generate(id) {
  const spec = rooms[id], privateDir = `.convex/demo-capture/${id}`;
  await mkdir(privateDir, { recursive: true });
  const saved = await json(`${privateDir}/result.json`);
  if (saved) return ManagedResult.parse(saved);
  let run = await json(`${privateDir}/run.json`);
  if (!run) {
    const response = await api('/api/scene', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: spec.prompt, scene: null }) });
    run = await response.json();
    assert.equal(run.kind, 'managed', 'Capture needs the configured managed world generator.');
    await writeFile(`${privateDir}/run.json`, JSON.stringify(run), { mode: 0o600 });
  }
  console.log(`${id}: generating artwork and three sources`);
  const deadline = Date.now() + 15 * 60_000;
  let complete = false, lastReport = 0;
  while (!complete && Date.now() < deadline) {
    const response = await api(`/api/world?${new URLSearchParams({ action: 'stream', token: run.token })}`);
    let pending = '';
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      pending = (pending + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
      let end;
      while ((end = pending.indexOf('\n\n')) >= 0) {
        const data = pending.slice(0, end).split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        pending = pending.slice(end + 2);
        if (!data) continue;
        const event = JSON.parse(data);
        if (event.type === 'error') throw new Error(`${id}: managed generation could not finish`);
        if (event.type === 'complete') complete = true;
        if (event.type === 'progress' && Date.now() - lastReport > 30_000) {
          console.log(`${id}: generating and validating assets`); lastReport = Date.now();
        }
      }
    }
  }
  assert.ok(complete, `${id}: generation timed out; rerun to resume the saved session.`);
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await api('/api/world', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'result', token: run.token, scene: null }) });
    if (response.status === 202) { await pause(2000); continue; }
    const result = ManagedResult.parse(await response.json());
    await writeFile(`${privateDir}/result.json`, JSON.stringify(result), { mode: 0o600 });
    return result;
  }
  throw new Error(`${id}: files are not yet available; rerun to resume.`);
}
async function capture(id) {
  if (await json(`public/demo/${id}/scene.json`) && await json(`public/demo/${id}/assets.json`)) {
    console.log(`${id}: keeping the existing reviewed capture`);
    return;
  }
  const result = await generate(id);
  assert.equal(result.response.kind, 'create');
  const scene = structuredClone(result.response.scene), assets = structuredClone(result.assets);
  assert.equal(scene.objects.length, 3, `${id}: expected exactly three sounds`);
  assert.ok(scene.objects.every(object => object.kind !== 'live'));
  const dir = `public/demo/${id}`, prefix = `/demo/${id}/assets/`;
  await mkdir(`${dir}/assets`, { recursive: true });
  scene.room.art = assets.envId = `demo-${id}`;
  async function image(record, name) {
    const response = await api(record.url);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.subarray(1, 4).equals(Buffer.from('PNG')), 'Expected PNG artwork');
    await writeFile(`${dir}/assets/${name}.png`, bytes);
    record.url = `${prefix}${name}.png`;
  }
  await Promise.all([
    ...Object.entries(assets.environment.textures).map(([surface, record]) => image(record, surface)),
    ...assets.sprites.map((record, index) => image(record, `source-${index + 1}`)),
  ]);
  const taken = new Set(), sounds = [], provenance = [];
  for (const [index, object] of scene.objects.entries()) {
    const match = matchSound(object.sound.query, object.kind, manifest, taken);
    const generated = assets.sounds.find(sound => sound.objectId === object.id);
    const name = `sound-${index + 1}.mp3`, fileId = `demo-${id}-${index + 1}`;
    if (match?.good) {
      const entry = manifest.find(entry => entry.id === match.assetId);
      assert.equal(path.extname(entry.file), '.mp3');
      await copyFile(`public/sounds/${entry.file}`, `${dir}/assets/${name}`);
      taken.add(entry.id);
      provenance.push({ objectId: object.id, libraryId: entry.id, license: entry.license });
    } else {
      const response = generated ? await api(generated.url)
        : await api(`/api/sound?${new URLSearchParams({ kind: object.kind, q: object.sound.query })}`);
      const raw = `.convex/demo-capture/${id}/sound-${index + 1}.input`;
      await writeFile(raw, Buffer.from(await response.arrayBuffer()));
      const converted = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-vn', '-ac', '1', '-ar', '44100', '-codec:a', 'libmp3lame', '-b:a', '128k', `${dir}/assets/${name}`], { encoding: 'utf8', windowsHide: true });
      assert.equal(converted.status, 0, `Audio conversion failed; set FFMPEG_PATH. ${converted.error?.message ?? ''}`);
      provenance.push({ objectId: object.id, provider: generated ? 'Claude/chirp' : 'ElevenLabs' });
    }
    assert.ok((await stat(`${dir}/assets/${name}`)).size > 100);
    // Recorded demo bindings are fixed, reviewed exceptions to runtime resolver ownership.
    object.sound.assetId = `managed:${fileId}:${object.kind}:${object.sound.query.replace(/\s+/g, ' ').trim()}`;
    sounds.push({ objectId: object.id, query: object.sound.query, kind: object.kind, fileId, url: `${prefix}${name}` });
  }
  assets.sounds = sounds;
  const objectIds = new Map(scene.objects.map((object, index) => [object.id, `demo-${id}-source-${index + 1}`]));
  for (const object of scene.objects) object.id = objectIds.get(object.id);
  for (const sprite of assets.sprites) sprite.objectId = objectIds.get(sprite.objectId);
  for (const sound of assets.sounds) sound.objectId = objectIds.get(sound.objectId);
  for (const sound of provenance) sound.objectId = objectIds.get(sound.objectId);
  assert.ok(['floor', 'north', 'east', 'south', 'west'].every(surface => assets.environment.textures[surface]), 'Expected the floor and all four walls.');
  assert.ok(scene.objects.every(object => assets.sprites.some(sprite => sprite.objectId === object.id)), 'Each sound needs its own prop.');
  Scene.parse(scene); ManagedAssets.parse(assets);
  const metadata = { version: 1, label: rooms[id].label, prompt: rooms[id].prompt, capturedAt: new Date().toISOString(), artwork: 'Claude/pxl', sounds: provenance };
  for (const [name, value] of Object.entries({ scene, assets, capture: metadata }))
    await writeFile(`${dir}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
  console.log(`${id}: captured ${assets.sprites.length} props and ${sounds.length} local sounds`);
}
try {
  const results = await Promise.allSettled((selected.length ? selected : Object.keys(rooms)).map(capture));
  for (const result of results) if (result.status === 'rejected') { console.error(result.reason.message); process.exitCode = 1; }
} finally { await server.close(); }
