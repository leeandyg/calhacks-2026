# Visited Places sidebar + Settings card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the center Save/Load bar with an auto-saving left "Visited places" sidebar, and add a right-sidebar Settings card that houses head tracking as a purple iOS-style toggle.

**Architecture:** Reuse the existing Convex `savedScenes` + `agentWorlds` world-restore path. A left `PlacesPanel` owns the places list and a debounced auto-save keyed to a current-place id; titles are derived on-device from the art store's `env.concept`. The right `assets-dock` becomes two stacked frosted cards — a scrollable `AssetsPanel` and a new `SettingsPanel` — and `HeadTrackingControl` moves there, restyled as a checkbox rendered as a switch.

**Tech Stack:** React + TypeScript, Vite, zustand, Convex, BorderBeam, vitest + Playwright scripts.

**Spec:** `docs/superpowers/specs/2026-10-25-places-sidebar-and-settings-design.md`

## Global Constraints

- Relative imports use `.js` extensions (`./scene.js`) so `api/` works on Vercel.
- Nothing in `src/` may read a secret; backend lives in `convex/`.
- Scene changes go only through `setScene`/`applyOps`; never mutate scene objects.
- Purple accent is exactly `#5b6ce0` (the `.prompt-send` background).
- Title is **derived on-device** from `env.concept`; no AI/network call.
- Keep the shared contract `src/scene/scene.ts` unchanged.
- `npm run build` before opening a PR.

## Review Focus

- **Rapid edits / create mid-debounce** → auto-save must land the latest scene once, not create duplicate records; a new environment id starts exactly one new record. (Task 4)
- **Missing/empty `env.concept`** (offline/Gemini fallback room) → title falls back to the first object label, then "Untitled place". (Task 1)
- **Convex unconfigured** (`convex === undefined`) → left sidebar still renders New Place and never crashes; no places list. (Task 4)
- **Load race** → loading a place while a newer prompt/edit has changed the scene must not clobber the newer state (preserve the existing SavedRooms guard). (Task 4)
- **Toggle a11y** → the switch stays a real `<input type="checkbox">`, keyboard- and screen-reader-operable, labeled "Head tracking". (Task 3)

---

### Task 1: Place title helper

**Files:**
- Create: `src/scene/placeTitle.ts`
- Test: `src/scene/placeTitle.test.ts`

**Interfaces:**
- Produces: `placeTitle(concept: string | undefined, objects: { label: string }[]): string`

**Algorithm (deterministic):** take `concept` up to the first of `. , ; — \n`; trim; drop a leading article (`a`/`an`/`the`, case-insensitive); split on whitespace and collect words, stopping before the first stop-word (`at in on of with and the a an to for`) but keeping at least the first word and at most 4; Title-Case each; join with spaces; truncate to ≤28 chars at a word boundary. If the result is empty, use the first object's `label`; if there are none, `"Untitled place"`.

- [ ] **Step 1: Write the failing test** in `src/scene/placeTitle.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { placeTitle } from './placeTitle.js';

describe('placeTitle', () => {
  it('derives a short title from the environment description', () => {
    expect(placeTitle('A cozy rainy Parisian café at night', [])).toBe('Cozy Rainy Parisian Café');
  });
  it('stops at the first clause and stop-word', () => {
    expect(placeTitle('Rainy café at night, warm lights, jazz', [])).toBe('Rainy Café');
  });
  it('caps the title length', () => {
    expect(placeTitle('Sprawling neonlit cyberpunk megacity downtown skyline', []).length).toBeLessThanOrEqual(28);
  });
  it('falls back to the first object label, then a default', () => {
    expect(placeTitle('', [{ label: 'Creek' }])).toBe('Creek');
    expect(placeTitle(undefined, [])).toBe('Untitled place');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/scene/placeTitle.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `placeTitle` in `src/scene/placeTitle.ts`** per the algorithm above.
- [ ] **Step 4: Run test to verify it passes** — `npx vitest run src/scene/placeTitle.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/scene/placeTitle.ts src/scene/placeTitle.test.ts && git commit -m "Add on-device place title helper"`

---

### Task 2: Convex create/update mutations for places

**Files:**
- Modify: `convex/savedScenes.ts`

**Interfaces:**
- Produces: `create({ name, scene }) → Id<"savedScenes">` (always inserts a new record for the current user) and `update({ id, name, scene })` (ownership-checked `ctx.db.patch` by id). Both validate `scene` with `Scene.safeParse` and clamp `name` to 1–80 chars like `save`. Keep `list`, `load`.

- [ ] **Step 1: Add `create` and `update` mutations** mirroring `save`'s validation; `update` throws `ConvexError("That saved room is unavailable.")` when the record is missing or not the user's. Set `updatedAt: Date.now()`.
- [ ] **Step 2: Typecheck** — `npx tsc` → no errors.
- [ ] **Step 3: Commit** — `git add convex/savedScenes.ts && git commit -m "Add create/update mutations for auto-saved places"`

---

### Task 3: Right-sidebar Settings card with head-tracking toggle

**Files:**
- Modify: `src/sensors/HeadTrackingControl.tsx`
- Create: `src/ui/SettingsPanel.tsx`
- Modify: `src/ui/AssetsPanel.tsx` (emit just the card beam, not the dock)
- Modify: `src/App.tsx` (wrap the right dock around Assets + Settings)
- Modify: `src/ui/PromptBar.tsx` (remove `HeadTrackingControl` from center)
- Modify: `src/styles.css`
- Modify: `scripts/browser-test.mjs`, `scripts/frontend-test.mjs`

**Interfaces:**
- Consumes: none new.
- Produces: `SettingsPanel()` React component rendering a frosted BorderBeam card titled "Settings" containing `<HeadTrackingControl/>`.

**Details:**
- `HeadTrackingControl`: keep the `<input type="checkbox" className=…>` for a11y but render it as a switch — wrap in `<span class="switch">` with a `<span class="switch-track"><span class="switch-knob"/></span>` and the "Head tracking" label; the existing Recenter button and status text stay, shown only while `on`.
- `AssetsPanel` returns just `<BorderBeam class="assets-beam">…</BorderBeam>` (drop the outer `.assets-dock` div). `App` renders `<div className="assets-dock"><AssetsPanel/><SettingsPanel/></div>`.
- CSS: `.assets-dock` becomes a vertical flex column with `gap`; `.assets-list` (or `.assets-panel` scroll area) gets `max-height` ~45dvh with `overflow-y:auto`; `.settings-panel` matches `.assets-panel`; switch styles with track `#3a3d47` off / `#5b6ce0` on (`:checked`), knob slides via `transform`.
- `PromptBar`: delete the `{hasScene && <HeadTrackingControl/>}` line and its import.
- Update the two browser-test body-text assertions to the new order (Assets text, then "Settings Head tracking", then the four demo labels) — match the actual rendered text after implementing.

- [ ] **Step 1: Restyle `HeadTrackingControl`** as the switch; keep the checkbox input and label.
- [ ] **Step 2: Create `SettingsPanel`** with the frosted card + `<HeadTrackingControl/>`.
- [ ] **Step 3: Refactor `AssetsPanel` to the card-only form; render both cards in `App`'s right dock; remove `HeadTrackingControl` from `PromptBar`.**
- [ ] **Step 4: Add CSS** for the two-card dock, scrollable Assets list, and purple switch.
- [ ] **Step 5: Build + run frontend/browser tests** — `npm run build`; with the dev server up, `PLAYWRIGHT_CHANNEL=chrome npm run test:frontend` and `test:browser`. Update the body-text assertions to match the new layout; re-run → PASS.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "Move head tracking into a Settings card with a purple toggle"`

---

### Task 4: Left "Visited places" sidebar with auto-save + New Place

**Files:**
- Create: `src/ui/PlacesPanel.tsx`
- Modify: `src/ai/managedClient.ts` (add `resetManagedSession()`)
- Modify: `src/App.tsx` (render `PlacesPanel`; pass `hasScene`, `onReset`, `onLoad`)
- Modify: `src/ui/PromptBar.tsx` (remove `SavedRooms` usage + import)
- Delete: `src/scene/SavedRooms.tsx`
- Modify: `src/styles.css`
- Create: `scripts/places-test.mjs`

**Interfaces:**
- Consumes: `placeTitle` (Task 1); `api.savedScenes.{list,load,create,update}` (Task 2); `useSceneStore`, `useArtStore`, `convex`, `startWorldRestore` already wired in `App`.
- Produces: `resetManagedSession(): void` (sets the module `sessionToken = undefined`); `PlacesPanel({ hasScene, onReset, onLoad })` React component.

**Behavior:**
- Render the left dock whenever the component mounts. The places **list** uses `useQuery(api.savedScenes.list, …)` and only appears when `convex` is configured; "New Place" always works.
- Current place is tracked in component refs: `currentId` and `savedArt` (the `room.art` last persisted for it).
- **Auto-save**: a `useEffect` subscribes to `useSceneStore`; on change, debounce ~1s, then if `hasScene` and Convex is ready and the scene has content (`room.art` or `objects.length`):
  - if `scene.room.art !== savedArt` → `create({ name: placeTitle(concept, objects), scene })`, set `currentId`/`savedArt`; `concept` = `useArtStore.getState().envs[scene.room.art]?.concept`.
  - else if `currentId` → `update({ id: currentId, name: <keep current title>, scene })`.
  - Guard with the mounted/working pattern from `SavedRooms`.
- **Load**: `load({ id })`, then if the live scene still equals the pre-load snapshot, `setScene(parsed)`, set `currentId`/`savedArt`, call `onLoad()`; otherwise show the "changed while loading" notice. (Port the guard from `SavedRooms.loadRoom`.)
- **New Place**: `useSceneStore.getState().setScene(<empty canonical scene>)` (room preset `bedroom`, default grid, no art/objects), `resetManagedSession()`, clear `currentId`/`savedArt`, `onReset()`.
- `App`: `onReset={() => setHasScene(false)}`, `onLoad={() => setHasScene(true)}`.

- [ ] **Step 1: Add `resetManagedSession()`** to `src/ai/managedClient.ts`.
- [ ] **Step 2: Create `PlacesPanel`** with list, New Place, load, and the debounced auto-save effect per Behavior.
- [ ] **Step 3: Wire `PlacesPanel` into `App`; remove `SavedRooms` from `PromptBar`; delete `SavedRooms.tsx`.**
- [ ] **Step 4: Add CSS** `.places-dock` (fixed left, mirrors `.assets-dock`), `.places-panel` frosted card, `.place-new` (＋ row), `.place-row` with active highlight.
- [ ] **Step 5: Write `scripts/places-test.mjs`** (Playwright): load `/?demo`, confirm the center has no "Save room"/"Load room"/"Room name"; the left sidebar shows "Visited places" and "New Place"; after selecting a demo and then clicking "New Place", the app returns to the centered prompt with the four demo choices and an empty scene (`window.sceneStore.getState().scene.objects` is `[]`). (Convex-backed list/auto-save is verified in the Convex-enabled environment.)
- [ ] **Step 6: Build + run** — `npm run build`; `PLAYWRIGHT_CHANNEL=chrome node scripts/places-test.mjs` → PASS; re-run `test:frontend`/`test:browser` and `npm run test:prompt` (its no-`select` assertion now holds since SavedRooms is gone) → PASS.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "Add Visited places sidebar with auto-save and New Place"`

---

### Task 5: Update shared docs

**Files:**
- Modify: `LAYOUT.md`, `CLAUDE.md`, `AGENTS.md` (keep the two identical)

- [ ] **Step 1: Update the frontend-layout descriptions** to include the left "Visited places" sidebar (auto-saved, auto-titled from the environment, with New Place) and the right Settings card (head tracking lives there as a purple toggle; Assets list scrolls); note the center no longer has the Save/Load bar or head-tracking row.
- [ ] **Step 2: Verify `CLAUDE.md` and `AGENTS.md` are byte-identical** — `diff CLAUDE.md AGENTS.md` → no output.
- [ ] **Step 3: Commit** — `git add LAYOUT.md CLAUDE.md AGENTS.md && git commit -m "Document the places sidebar and Settings card layout"`
