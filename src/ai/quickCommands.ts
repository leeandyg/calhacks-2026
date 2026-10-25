import type { EditOpInput, Scene, SoundObject } from "../scene/scene.js";

export type QuickCommand = { kind: "undo" } | { kind: "edit"; ops: EditOpInput[]; message: string };

/** Only explicit, unambiguous edits skip Gemini/Moss. Unknown targets stay on the AI path. */
export function quickCommand(text: string, scene: Scene): QuickCommand | undefined {
  const prompt = text.toLowerCase().trim().replace(/[.!?]+$/, "");
  if (/^undo(?: that| last change| the last change)?$/.test(prompt)) return { kind: "undo" };
  if (/^(?:stop(?: all)?(?: sounds?| audio| everything)?|mute (?:all|everything|all sounds))$/.test(prompt)) {
    return { kind: "edit", ops: scene.objects.map(({ id }) => ({ op: "set_muted", id, muted: true })), message: "All sounds muted." };
  }
  if (/^unmute (?:all|everything|all sounds)$/.test(prompt)) {
    return { kind: "edit", ops: scene.objects.map(({ id }) => ({ op: "set_muted", id, muted: false })), message: "All sounds unmuted." };
  }
  const mute = /^(mute|unmute) (?:the )?(.+)$/.exec(prompt);
  const volume = /^(?:make )?(?:the )?(.+?) (louder|quieter)$/.exec(prompt)
    ?? /^turn (?:the )?(.+?) (up|down)$/.exec(prompt);
  const target = mute?.[2] ?? volume?.[1];
  if (!target) return;
  const matches = scene.objects.filter((object) => matchesTarget(object, target));
  if (!matches.length) return;
  // Source categories can intentionally address several sounds; labels must identify one.
  if (matches.length > 1 && !CATEGORIES[target]) return;
  const ops: EditOpInput[] = matches.map((object) => mute
    ? { op: "set_muted", id: object.id, muted: mute[1] === "mute" }
    : { op: "set_volume", id: object.id, volume: Math.max(0, Math.min(1,
      object.volume + (volume![2] === "louder" || volume![2] === "up" ? 0.1 : -0.1))) });
  return { kind: "edit", ops, message: mute ? `${target} ${mute[1] === "mute" ? "muted" : "unmuted"}.`
    : `${target} turned ${volume![2] === "louder" || volume![2] === "up" ? "up" : "down"}.` };
}
const CATEGORIES: Record<string, RegExp> = {
  rain: /\brain(?:fall|drops)?\b/i, fan: /\bfans?\b/i, fans: /\bfans?\b/i,
  birds: /\bbirds?(?:song)?\b|\bchirp/i, "brown noise": /\bbrown noise\b/i,
};
function matchesTarget(object: SoundObject, target: string) {
  return CATEGORIES[target]?.test(object.label)
    ?? object.label.toLowerCase() === target;
}

/** Resolver asset assignment isn't a manual edit; every other later edit invalidates undo. */
export function sceneFingerprint(scene: Scene) {
  return JSON.stringify({ ...scene, objects: scene.objects.map(({ sound, ...object }) => ({ ...object, sound: { ...sound, assetId: undefined } })) });
}
export type CommandChange = { before: Scene; after: string };
export function commandChange(before: Scene, after: Scene): CommandChange | undefined {
  return sceneFingerprint(before) === sceneFingerprint(after) ? undefined : { before, after: sceneFingerprint(after) };
}
export function undoScene(change: CommandChange | undefined, current: Scene): Scene {
  if (!change) throw new Error("There is no room change to undo.");
  if (sceneFingerprint(current) !== change.after) throw new Error("The room changed after that command. Undo was skipped to preserve your edits.");
  return change.before;
}
