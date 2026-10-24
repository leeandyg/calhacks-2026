# Saved rooms

`savedScenes.ts` saves the existing Zod scene JSON, lists room metadata, and loads a
snapshot on request. Every function checks the current Convex Auth user. A matching
name updates that user's existing save; records from another user are inaccessible.

`auth.ts` uses anonymous sessions, `auth.config.ts` verifies their tokens, and
`http.ts` serves the authentication routes. `_generated/` comes from `convex dev`.
No Gemini or sound-generation keys are needed here.

See the root README's **Save and load rooms with Convex** section for local setup,
cloud deployment, signing keys and verification.
