import { getModelId, groundHeight } from './layout.js';
import type { Scene, SoundObject, Vec3 } from './scene.js';

/** Centered speakers form the manually placed support beneath the listener. */
export function isBearSpeaker(object: SoundObject, room?: Scene['room']) {
  return (!room?.art || /\bspeaker\b/i.test(`${object.label ?? ''} ${object.sound.query}`)) && getModelId(object) === 'speaker' && !object.wall && object.position[0] === 0 && object.position[2] === 0;
}
export function bearGround(room: Scene['room']) {
  return Math.max(...[-0.4, 0.4].flatMap(x => [-0.3, 0.3].map(z => groundHeight([x, 0, z], room))));
}
export function bearSpeakers(scene: Scene) {
  return scene.objects.filter(object => isBearSpeaker(object, scene.room)).sort((a, b) => a.position[1] - b.position[1]);
}
/** Half-block canonical heights keep both sound and geometry on the same support. */
export function settleBearSpeakers(scene: Scene): Scene {
  const speakers = bearSpeakers(scene);
  if (speakers.length > 2) throw new Error('The bear can sit on at most two speakers.');
  let top = bearGround(scene.room);
  const positions = new Map<string, Vec3>();
  for (const object of speakers) {
    const y = Math.ceil((top + 0.75 * object.scale) * 2) / 2;
    if (y + 0.75 * object.scale > scene.room.grid.wallHeight) throw new Error('There is no room for another speaker beneath the bear.');
    positions.set(object.id, [0, y, 0]);
    top = y + 0.7 * object.scale;
  }
  return { ...scene, objects: scene.objects.map(object => {
    const position = positions.get(object.id);
    return position && position.some((v, i) => v !== object.position[i]) ? { ...object, position } : object;
  }) };
}

/** Enter the center deliberately; a full stack rejects the move atomically in the store. */
export function getBearDragPosition(object: SoundObject, raw: Vec3, scene: Scene): SoundObject | undefined {
  if ((scene.room.art && !/\bspeaker\b/i.test(`${object.label ?? ''} ${object.sound.query}`)) || getModelId(object) !== 'speaker' || Math.hypot(raw[0], raw[2]) > 0.85) return undefined;
  if (isBearSpeaker(object, scene.room)) return object;
  const others = bearSpeakers(scene).filter(source => source.id !== object.id);
  const top = others.at(-1);
  return { ...object, wall: null, position: [0, top ? top.position[1] + 1.5 * top.scale : bearGround(scene.room) + 1, 0] };
}
