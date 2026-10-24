import { DEFAULT_ROOM_GRID } from '../shared/layout';
import type { SceneInput } from '../shared/scene';
export const soundscapes: Record<string, { label: string; description: string; scene: SceneInput }> = {
  rainy: {
    label: 'Rainy afternoon', description: 'Rain at the window. A little room to focus.',
    scene: {
      room: { preset: 'bedroom', grid: { ...DEFAULT_ROOM_GRID }, reverb: 'small-room' },
      listener: { position: [0, 1.6, 0], yaw: 0 },
      objects: [
        { id: 'rain-1', model: 'rain', label: 'Rain on window', kind: 'bed', sound: { query: 'steady rain on glass' }, position: [-DEFAULT_ROOM_GRID.columns / 2, 3.5, -1.5], volume: 0.55, wall: 'west', scale: 1 },
        { id: 'fan-1', model: 'fan', label: 'Gentle fan', kind: 'bed', sound: { query: 'soft fan hum' }, position: [1.5, 1.5, 1.5], volume: 0.25, scale: 1.1 },
        { id: 'birds-1', model: 'birds', label: 'Distant birds', kind: 'event', sound: { query: 'sparrow chirps' }, position: [-2.5, 1.5, 1.5], volume: 0.25, intervalSec: [20, 60], scale: 1.1 },
      ],
      session: { task: 'A quiet focus session', mode: 'focus', minutesLeft: 50 },
    },
  },
  cabin: {
    label: 'Cabin retreat', description: 'Warm embers and the trees outside.',
    scene: {
      room: { preset: 'cabin', grid: { ...DEFAULT_ROOM_GRID }, reverb: 'warm-room' }, listener: { position: [0, 1.6, 0], yaw: 0 },
      objects: [
        { id: 'fire-1', label: 'Crackling fire', kind: 'bed', sound: { query: 'warm crackling fireplace' }, position: [-2.8, 0.8, -2.1], volume: 0.5 },
        { id: 'wind-1', label: 'Forest breeze', kind: 'bed', sound: { query: 'forest wind leaves' }, position: [2.7, 1.5, -2.8], volume: 0.3 },
        { id: 'chime-1', label: 'Wind chime', kind: 'event', sound: { query: 'soft windchime bell' }, position: [2.8, 1.7, 2.6], volume: 0.2, intervalSec: [25, 55] },
      ], session: { task: 'Read a few pages', mode: 'focus', minutesLeft: 50 },
    },
  },
  cafe: {
    label: 'Quiet café', description: 'Coffee shop comfort, without the conversation.',
    scene: {
      room: { preset: 'cafe', grid: { ...DEFAULT_ROOM_GRID }, reverb: 'small-room' }, listener: { position: [0, 1.6, 0], yaw: 0 },
      objects: [
        { id: 'cafe-1', label: 'Café atmosphere', kind: 'bed', sound: { query: 'cafe espresso machine hiss' }, position: [2.7, 1.3, -2.6], volume: 0.4 },
        { id: 'rain-1', label: 'Rain outside', kind: 'bed', sound: { query: 'steady rain on glass' }, position: [-2.9, 1.5, -1.9], volume: 0.45 },
        { id: 'noise-1', label: 'Soft masking', kind: 'bed', sound: { query: 'deep brown noise' }, position: [2.6, 1, 2.7], volume: 0.15 },
      ], session: { task: 'Writing an essay', mode: 'focus', minutesLeft: 50 },
    },
  },
};
