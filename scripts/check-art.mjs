import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { renderPxl } from '../server/pxl.ts';
import { cachedArt } from '../server/artCache.ts';

let passed = 0;
async function check(name, test) { await test(); passed++; console.log(`PASS ${name}`); }
const sprite = 'sprite("x", { w: 4, h: 4 }, rect(0, 0, 4, 4, "#123456"))';
await check('renders named assets to PNG with lint findings', async () => {
  const result = await renderPxl(sprite, ['x']);
  assert.ok(result.ok, result.error);
  assert.deepEqual([result.assets.x.w, result.assets.x.h], [4, 4]);
  assert.equal(Buffer.from(result.assets.x.png, 'base64').subarray(1, 4).toString(), 'PNG');
  assert.ok(Array.isArray(result.assets.x.lint));
});
await check('reports DSL errors and missing assets', async () => {
  assert.equal((await renderPxl('sprite("x", {w: 4, h: 4}, rect(0,0,4,4,"nope"))', ['x'])).ok, false);
  const missing = await renderPxl(sprite, ['floor']);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /no asset named 'floor'/);
});
await check('has no host, network, filesystem, process, timers or module APIs', async () => {
  const result = await renderPxl(`
    for (const name of ['process','require','fetch','WebSocket','XMLHttpRequest','setTimeout','Deno','Bun','std','os']) {
      if (typeof globalThis[name] !== 'undefined') throw new Error(name + ' exposed');
    }
    ${sprite}`, ['x']);
  assert.ok(result.ok, result.error);
});
for (const [name, code] of Object.entries({
  'constructor escape': 'this.constructor.constructor("return process")().getBuiltinModule("fs").readFileSync(".env")',
  'DSL function constructor escape': 'rect.constructor("return process")()',
  'filesystem image': 'sprite("x", {w:4,h:4}, image(".env",0,0))',
  'file include': 'include(".env")',
  'dynamic import': 'throw import("node:fs")',
})) {
  await check(`rejects ${name}`, async () => {
    assert.equal((await renderPxl(`${code}; ${sprite}`, ['x'])).ok, false);
  });
}
await check('an endless loop is interrupted', async () => {
  const started = Date.now();
  const result = await renderPxl('while (true) {}', ['x']);
  assert.equal(result.ok, false);
  assert.match(result.error, /interrupt|longer than/i);
  assert.ok(Date.now() - started < 14_000);
});
await check('memory exhaustion stays inside the renderer', async () => {
  const result = await renderPxl('const a=[]; while(true) a.push(new Array(100000).fill(42));', ['x']);
  assert.equal(result.ok, false);
});
await check('cache coalesces matching requests and does not cache failures', async () => {
  const key = randomUUID(); let calls = 0;
  const generate = async () => { calls++; return { png: 'test' }; };
  const values = await Promise.all([cachedArt(key, generate), cachedArt(key, generate)]);
  assert.deepEqual(values, [{ png: 'test' }, { png: 'test' }]);
  assert.equal(calls, 1);
  await cachedArt(key, generate); assert.equal(calls, 1);
  const failure = randomUUID();
  await assert.rejects(cachedArt(failure, async () => { throw new Error('failed'); }));
  await cachedArt(failure, generate); assert.equal(calls, 2);
});
console.log(`Passed ${passed} art renderer checks.`);
