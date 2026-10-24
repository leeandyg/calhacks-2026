import { z } from "zod";

// public/sounds/manifest.json: one entry per file in the local sound pack (#4).

export const ManifestEntry = z.object({
  id: z.string(),
  /** Path relative to /sounds/. */
  file: z.string(),
  tags: z.array(z.string()),
  kind: z.enum(["bed", "event"]),
  license: z.string(),
});
export type ManifestEntry = z.infer<typeof ManifestEntry>;

let manifest: Promise<Map<string, ManifestEntry>> | undefined;

export function loadManifest(): Promise<Map<string, ManifestEntry>> {
  manifest ??= fetch("/sounds/manifest.json")
    .then((res) => {
      if (!res.ok) throw new Error(`Sound manifest failed: ${res.status}`);
      return res.json();
    })
    .then((json) => new Map(z.array(ManifestEntry).parse(json).map((e) => [e.id, e])))
    .catch((error) => { manifest = undefined; throw error; });
  return manifest;
}
