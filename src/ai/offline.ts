import { presets } from "../scene/presets.js";
import { SceneResponse, type EditOp, type Scene, type SoundObject } from "../scene/scene.js";
import { clampPosition } from "../scene/store.js";
import { demoRecordings } from "./recordings.js";

export const demoPrompts = [
  "Rainy Tokyo cafe, I'm writing an essay.",
  "Make it rainier.",
  "Push the chatter farther away and add a fireplace.",
];

function recorded(name: keyof typeof demoRecordings.responses): SceneResponse {
  const response = SceneResponse.parse(structuredClone(demoRecordings.responses[name]));
  // Fixed, reviewed bindings for saved responses only. General sound resolution belongs to #17.
  const bind = (object: SoundObject) => ({
    ...object,
    sound: { ...object.sound, assetId: demoRecordings.assets[object.id as keyof typeof demoRecordings.assets] },
  });
  if (response.kind === "create") return { ...response, scene: { ...response.scene, objects: response.scene.objects.map(bind) } };
  return { ...response, ops: response.ops.map((op) => op.op === "add" ? { ...op, object: bind(op.object) } : op) };
}

function freshId(id: string, scene: Scene) {
  let unique = id;
  for (let suffix = 2; scene.objects.some((object) => object.id === unique); suffix++) unique = `${id}-${suffix}`;
  return unique;
}

export function offlineResponse(prompt: string, scene: Scene | null): { response: SceneResponse; notice: string } {
  const text = prompt.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  if (/make (?:it rainier|(?:it |the rain )?(?:rain )?harder)|make the rain louder/.test(text)) {
    if (!scene) throw new Error("Load a preset before using the recorded rain edit.");
    const rain = scene.objects.filter((object) => object.kind === "bed" && /rain/i.test(object.label + " " + object.sound.query));
    if (rain.length) {
      return {
        response: { kind: "edit", ops: rain.map((object) => ({
          op: "set_volume", id: object.id, volume: Math.min(1, object.volume + demoRecordings.rainIncrease),
        })) },
        notice: "Replayed the saved rain edit for the current room. Manual positions are preserved.",
      };
    }
    if (scene.objects.length >= 12) throw new Error("This room is full. Load a preset before adding demo rain.");
    const addition = recorded("rainAddition");
    if (addition.kind !== "edit" || addition.ops[0]?.op !== "add") throw new Error("Invalid saved rain response.");
    const object = addition.ops[0].object;
    return {
      response: { kind: "edit", ops: [{ op: "add", object: {
        ...object, id: freshId(object.id, scene), position: clampPosition(object.position, scene.room),
      } }] },
      notice: "Replayed the saved rain addition. Existing objects are preserved.",
    };
  }

  if (/chatter/.test(text) && /fireplace/.test(text)) {
    if (!scene) throw new Error("Load the rainy café before using the recorded chatter/fireplace edit.");
    const chatter = scene.objects.find((object) => /murmur|chatter|cafe (?:background|ambience)/i.test(object.label + " " + object.sound.query));
    if (!chatter) throw new Error("This saved edit needs café chatter. Load the rainy café first.");
    const saved = recorded("fireplace");
    if (saved.kind !== "edit") throw new Error("Invalid saved fireplace response.");
    const hasFireplace = scene.objects.some((object) => object.sound.assetId === "fireplace");
    if (!hasFireplace && scene.objects.length >= 12) throw new Error("This room is full. Load a preset before adding a fireplace.");
    return {
      response: { kind: "edit", ops: saved.ops.flatMap<EditOp>((op) => {
        if (op.op === "move") return [{ ...op, id: chatter.id, position: clampPosition(op.position, scene.room) }];
        if (op.op === "add" && !hasFireplace) return [{ ...op, object: {
          ...op.object, id: freshId(op.object.id, scene), position: clampPosition(op.object.position, scene.room),
        } }];
        return [];
      }) },
      notice: "Replayed the saved chatter/fireplace edit for the current room.",
    };
  }

  if (scene && /\b(?:make|move|push|pull|lower|raise|increase|decrease|remove|delete|add|turn|set|change|reduce)\b/.test(text)) {
    throw new Error("Offline mode supports the listed demo prompts and six presets. Your room was kept unchanged.");
  }
  const preset = presets.find((entry) => entry.match.test(text));
  if (!preset && scene) throw new Error("No saved response matches this prompt. Choose a preset or a listed demo prompt. Your room was kept unchanged.");
  if (preset?.id === "cafe") return { response: recorded("cafe"), notice: "Replayed the saved rainy café scene with local sounds." };
  const fallback = preset ?? presets[0];
  return {
    response: { kind: "create", scene: structuredClone(fallback.scene) },
    notice: `Loaded the ${fallback.label} local preset${preset ? "." : " as the default fallback."}`,
  };
}
