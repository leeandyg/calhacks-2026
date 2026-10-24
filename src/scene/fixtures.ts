import { DEFAULT_GRID, type Scene } from "./scene.js";

// Hand-written scenes so the room and audio can be built before the agent exists.
// Asset ids are files in the sound pack (public/sounds/manifest.json).

export const cafe: Scene = {
  room: { preset: "cafe", grid: DEFAULT_GRID, openings: [], reverb: "small-room" },
  listener: { position: [0, 1.6, 0], yaw: 0 },
  objects: [
    {
      id: "rain-1",
      label: "Rain on window",
      kind: "bed",
      sound: { query: "steady rain on glass", assetId: "rain_window" },
      position: [-3, 1.5, 1],
      volume: 0.6,
    },
    {
      id: "murmur-1",
      label: "Café murmur",
      kind: "bed",
      sound: { query: "soft indistinct café murmur", assetId: "cafe_murmur" },
      position: [2.5, 1.2, -2.5],
      volume: 0.3,
    },
    {
      id: "cups-1",
      label: "Cups clinking",
      kind: "event",
      sound: { query: "ceramic cup clink", assetId: "cup_clink" },
      position: [3, 1, 2],
      volume: 0.25,
      intervalSec: [8, 25],
    },
  ],
  session: { task: "writing an essay", mode: "focus", minutesLeft: 50 },
};

export const bedroom: Scene = {
  room: { preset: "bedroom", grid: DEFAULT_GRID, openings: [], reverb: "small-room" },
  listener: { position: [0, 1.6, 0], yaw: 0 },
  objects: [
    {
      id: "rain-1",
      label: "Rain on roof",
      kind: "bed",
      sound: { query: "heavy rain on a roof", assetId: "rain_roof" },
      position: [0, 2.4, -1.5],
      volume: 0.7,
    },
    {
      // Was a desk fan; the fan recording was removed from the pack for its electrical hum
      id: "noise-1",
      label: "Brown noise",
      kind: "bed",
      sound: { query: "soft brown noise", assetId: "brown_noise" },
      position: [1.8, 0.8, 1.5],
      volume: 0.35,
    },
  ],
};

export const forest: Scene = {
  room: { preset: "forest", grid: DEFAULT_GRID, openings: [], reverb: "outdoor" },
  listener: { position: [0, 1.6, 0], yaw: 0 },
  objects: [
    {
      id: "stream-1",
      label: "Creek",
      kind: "bed",
      sound: { query: "gentle flowing creek", assetId: "creek" },
      position: [-4, 0.3, -2],
      volume: 0.5,
    },
    {
      id: "wind-1",
      label: "Wind in trees",
      kind: "bed",
      sound: { query: "soft wind through leaves", assetId: "wind_trees" },
      position: [3, 4, 3],
      volume: 0.3,
    },
    {
      id: "birds-1",
      label: "Distant birds",
      kind: "event",
      sound: { query: "sparrow chirps", assetId: "sparrow" },
      position: [5, 3, -5],
      volume: 0.25,
      intervalSec: [8, 25],
    },
  ],
};

export const fixtures = { cafe, bedroom, forest };
