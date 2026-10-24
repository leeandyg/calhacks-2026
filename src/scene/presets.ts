import { bedroom, cafe, forest } from "./fixtures.js";
import { snapScene } from "./layout.js";
import { DEFAULT_GRID, Scene, type SceneInput, type Vec3 } from "./scene.js";

type SoundObjectInput = SceneInput["objects"][number];

function bed(id: string, label: string, assetId: string, position: Vec3, volume: number): SoundObjectInput {
  return { id, label, kind: "bed", sound: { query: label, assetId }, position, volume };
}

function event(id: string, label: string, assetId: string, position: Vec3, volume: number): SoundObjectInput {
  return { id, label, kind: "event", sound: { query: label, assetId }, position, volume, intervalSec: [20, 60] };
}

function scene(room: Scene["room"], objects: SoundObjectInput[]): Scene {
  return snapScene(Scene.parse({ room, listener: { position: [0, 1.6, 0], yaw: 0 }, objects }));
}

export const presets = [
  { id: "cafe", label: "Rainy café", match: /\bcafe\b|coffee shop/i, scene: cafe },
  { id: "bedroom", label: "Bedroom", match: /bedroom|desk fan/i, scene: bedroom },
  { id: "forest", label: "Forest", match: /forest|woods|creek/i, scene: forest },
  {
    id: "library", label: "Library", match: /library/i,
    scene: scene({ preset: "library", grid: DEFAULT_GRID, openings: [], reverb: "small-room" }, [
      bed("library-room", "Quiet library room tone", "library", [1.5, 1.2, -0.5], 0.25),
      bed("library-noise", "Brown noise", "brown_noise", [-1.5, 1.2, 0.5], 0.4),
      event("library-pages", "Distant page turn", "page_flip", [3, 1, -3], 0.15),
    ]),
  },
  {
    id: "cabin", label: "Cabin", match: /cabin|fireplace/i,
    scene: scene({ preset: "cabin", grid: DEFAULT_GRID, openings: [], reverb: "small-room" }, [
      bed("cabin-rain", "Rain on roof", "rain_roof", [-1.6, 2.5, -1], 0.5),
      bed("cabin-fire", "Crackling fireplace", "fireplace", [1.5, 0.5, 1], 0.4),
      event("cabin-owl", "Distant owl", "owl", [3.5, 2, -3.5], 0.12),
    ]),
  },
  {
    id: "coast", label: "Coast", match: /coast|ocean|beach|sea waves/i,
    // The existing forest preset supplies the outdoor room; no scene-contract change is needed.
    scene: scene({ preset: "forest", grid: DEFAULT_GRID, openings: [], reverb: "outdoor" }, [
      bed("coast-waves", "Ocean waves", "ocean", [-1.8, 0.5, -0.5], 0.5),
      bed("coast-wind", "Gentle wind", "wind", [1.6, 1.6, 1], 0.35),
      event("coast-bird", "Distant bird", "bird_chirp", [5, 3, -4], 0.15),
    ]),
  },
] as const;
