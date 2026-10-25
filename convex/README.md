# Saved rooms

`savedScenes.ts` saves the existing Zod scene JSON, lists room metadata, and loads a
snapshot on request. Every function checks the current Convex Auth user. A matching
name updates that user's existing save; records from another user are inaccessible.

`auth.ts` uses anonymous sessions, `auth.config.ts` verifies their tokens, and
`http.ts` serves the authentication routes. `_generated/` comes from `convex dev`.

The other tables:

- `agentWorlds.ts`: kept Claude worlds. Right after a world arrives, the browser asks Convex to
  copy its paintings, sprites and chirp sounds into file storage (`agentFiles`) and keep one
  manifest per world (`agentWorlds`), so reloads and saved rooms reopen it. No key: files are
  fetched from the production `/api/world` proxy with the world's signed token.
- `preferences.ts`: Moss preference memory records ("my usual coding setup"), per user.
- `sounds.ts`, `elevenlabs.ts`: the shared cache of ElevenLabs-generated sounds. Used only when
  live generation is on (`VITE_ELEVENLABS_SOUNDS=on`); it needs `ELEVENLABS_API_KEY` in the
  Convex deployment.

See the root README's **Save and load rooms with Convex** section for local setup,
cloud deployment, signing keys and verification.
