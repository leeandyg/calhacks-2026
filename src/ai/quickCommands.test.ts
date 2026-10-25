import { describe, expect, it } from "vitest";
import { cafe } from "../scene/fixtures.js";
import { Scene } from "../scene/scene.js";
import { useSceneStore } from "../scene/store.js";
import { commandChange, quickCommand, sceneFingerprint, undoScene } from "./quickCommands.js";

describe("quick voice commands", () => {
  it("mutes only rain and preserves manual placements, volumes and other sounds", () => {
    useSceneStore.getState().setScene(cafe);
    const before = useSceneStore.getState().scene;
    const command = quickCommand("Mute the rain.", before);
    expect(command?.kind).toBe("edit");
    if (command?.kind !== "edit") throw new Error("Expected rain edit");
    expect(useSceneStore.getState().applyOps(command.ops).ok).toBe(true);
    for (const [i, object] of useSceneStore.getState().scene.objects.entries()) {
      expect(object.position).toEqual(before.objects[i].position);
      expect(object.volume).toBe(before.objects[i].volume);
      expect(object.muted).toBe(/rain/i.test(object.label) ? true : before.objects[i].muted);
    }
  });
  it("clamps volume changes and leaves unknown/ambiguous commands for AI", () => {
    const scene = structuredClone(cafe);
    scene.objects[0].label = "Rain"; scene.objects[0].volume = 0.98;
    const command = quickCommand("Turn the rain up", scene);
    expect(command?.kind === "edit" && command.ops[0]).toMatchObject({ op: "set_volume", volume: 1 });
    for (const text of ["remember my rain preference", "use my usual room", "move it left", "mute something", "make it rainier and move the birds"])
      expect(quickCommand(text, scene)).toBeUndefined();
    scene.objects[1].label = "Other"; scene.objects[2].label = "Other";
    expect(quickCommand("mute other", scene)).toBeUndefined();
  });
  it("stops/unmutes all sounds without deleting them", () => {
    expect(quickCommand("Stop", cafe)).toMatchObject({ kind: "edit", ops: cafe.objects.map(({ id }) => ({ op: "set_muted", id, muted: true })) });
    expect(quickCommand("Unmute all", cafe)).toMatchObject({ kind: "edit", ops: cafe.objects.map(({ id }) => ({ op: "set_muted", id, muted: false })) });
    expect(quickCommand("Undo that", cafe)).toEqual({ kind: "undo" });
  });
  it("undo survives resolver assignment and refuses to overwrite later manual edits", () => {
    const before = structuredClone(cafe), after = structuredClone(cafe);
    after.objects[0].volume = 0.8;
    const change = commandChange(before, after);
    after.objects[0].sound.assetId = "gen:bed:test";
    expect(undoScene(change, after)).toEqual(before);
    after.objects[1].position = [2, 1, 2];
    expect(() => undoScene(change, after)).toThrow(/preserve your edits/);
    expect(() => undoScene(undefined, after)).toThrow(/no room change/);
    expect(commandChange(before, structuredClone(before))).toBeUndefined();
    expect(sceneFingerprint(after)).not.toContain("gen:bed:test");
  });
  it("a changed live audio stream also invalidates undo", () => {
    const before = Scene.parse({ ...cafe, objects: [{ ...cafe.objects[0], kind: "live", sound: { query: "Spotify", stream: "app:spotify" } }] });
    const after = structuredClone(before); after.objects[0].volume = 0.3;
    const change = commandChange(before, after);
    if (after.objects[0].kind === "live") after.objects[0].sound.stream = "app:browser";
    expect(() => undoScene(change, after)).toThrow(/preserve your edits/);
  });
});
