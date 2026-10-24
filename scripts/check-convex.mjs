import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { createServer } from "vite";
import { api } from "../convex/_generated/api.js";

// Creates isolated anonymous test users on a running LOCAL Convex deployment.
const url = process.env.VITE_CONVEX_URL;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("Start local Convex first. This check only writes to a localhost deployment.");
}
const client = () => new ConvexHttpClient(url, { logger: false });
async function signedIn() {
  const result = client();
  const { tokens } = await result.action(api.auth.signIn, { provider: "anonymous" });
  assert.ok(tokens?.token, "Anonymous authentication failed");
  result.setAuth(tokens.token);
  return { result, token: tokens.token };
}
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { cafe, forest } = await server.ssrLoadModule("/src/scene/fixtures.ts");
  const first = await signedIn();
  const second = await signedIn();
  const room = structuredClone(cafe);
  room.objects[0].position = [1.4, 1.2, -1.7];
  room.objects[0].volume = 0.42;
  delete room.objects[0].sound.assetId; // Unresolved descriptions are valid scene state too.
  room.objects[2].intervalSec = [7, 19];
  room.listener.yaw = 0.7;
  room.session.minutesLeft = 23;
  let id;
  let passed = 0;
  async function check(name, test) { await test(); passed++; console.log(`PASS ${name}`); }
  await check("unauthenticated clients cannot list or save rooms", async () => {
    await assert.rejects(client().query(api.savedScenes.list, {}));
    await assert.rejects(client().mutation(api.savedScenes.save, { name: "Denied", scene: room }));
  });
  await check("a full scene round-trips with manual placements and session state", async () => {
    id = await first.result.mutation(api.savedScenes.save, { name: "  My study room  ", scene: room });
    const loaded = await first.result.query(api.savedScenes.load, { id });
    assert.equal(loaded.name, "My study room");
    assert.deepEqual(loaded.scene, room);
  });
  await check("listing returns only the user's room metadata", async () => {
    const list = await first.result.query(api.savedScenes.list, {});
    assert.equal(list.length, 1); assert.equal(list[0]._id, id);
    assert.equal(list[0].name, "My study room"); assert.equal("scene" in list[0], false);
  });
  await check("saving the same name replaces one snapshot instead of duplicating it", async () => {
    const replacementId = await first.result.mutation(api.savedScenes.save, { name: "My study room", scene: forest });
    assert.equal(replacementId, id);
    assert.equal((await first.result.query(api.savedScenes.list, {})).length, 1);
    assert.deepEqual((await first.result.query(api.savedScenes.load, { id })).scene, forest);
  });
  await check("another anonymous user cannot list, load, or overwrite the first user's room", async () => {
    assert.deepEqual(await second.result.query(api.savedScenes.list, {}), []);
    await assert.rejects(second.result.query(api.savedScenes.load, { id }));
    const otherId = await second.result.mutation(api.savedScenes.save, { name: "My study room", scene: cafe });
    assert.notEqual(otherId, id);
    assert.deepEqual((await first.result.query(api.savedScenes.load, { id })).scene, forest);
  });
  await check("invalid scenes and names are rejected without changing the save", async () => {
    await assert.rejects(first.result.mutation(api.savedScenes.save, { name: "My study room", scene: { room: {} } }));
    for (const name of ["  ", "x".repeat(81)]) await assert.rejects(first.result.mutation(api.savedScenes.save, { name, scene: room }));
    assert.deepEqual((await first.result.query(api.savedScenes.load, { id })).scene, forest);
  });
  await check("a fresh connection with the same session restores persisted state", async () => {
    const fresh = client(); fresh.setAuth(first.token);
    assert.deepEqual((await fresh.query(api.savedScenes.load, { id })).scene, forest);
  });
  console.log(`Passed ${passed} Convex persistence and access checks.`);
} finally { await server.close(); }
