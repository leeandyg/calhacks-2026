# Visited Places sidebar + Settings card — design

Date: 2026-10-25
Status: awaiting approval

## Intent / why

Today saving a room is a manual chore: a centered Save/Load bar with a "Room
name" box, a "Save room" button, a saved-room dropdown and a "Load room"
button. People have to name and save rooms by hand, and the control clutters
the center under the prompt.

We want visiting rooms to feel like moving between places that are always
remembered. Every room you create is auto-saved and auto-named, and you switch
between them from a left sidebar — the way you'd expect "recent places" to
work, with nothing to click to save.

Separately, the center is getting crowded. Head tracking is a persistent
preference, not a per-prompt action, so it moves into a new **Settings** card
in the right sidebar beneath Assets.

## Goals

- Replace the center Save/Load bar entirely with a left **"Visited places"**
  sidebar, in the same BorderBeam frosted style as the prompt bar and Assets.
- Every place is **auto-saved** (no Save button) and **auto-labeled** with a
  short title **derived on-device from the environment description** (no AI
  call; works in `?demo`).
- A **"New Place"** entry at the top of the sidebar clears to the empty
  blank-slate room (centered prompt + the four demo choices).
- Add a **Settings** card to the right sidebar below Assets; the Assets list
  becomes scrollable and capped so the two cards split the sidebar height.
- Move the head-tracking control from the center into Settings, rendered as an
  iOS-style toggle switch: gray track off, **purple (`#5b6ce0`, the send
  button's color)** track with the knob slid right when on.

## Non-goals

- No deleting places from the sidebar (history is kept). No renaming by hand.
- No AI-generated titles.
- No change to the audio engine, the scene contract (`scene.ts`), the grid, or
  how worlds are generated/restored. We reuse the existing Convex
  `savedScenes` + `agentWorlds` restore path (#112) unchanged.
- The "Hey agent" voice controls stay in the center (not moved).

## Anti-goals (would make this a failure)

- Auto-save silently overwriting or losing a place the user still wanted.
- Auto-save churn hammering the backend on every drag frame.
- The sidebars covering the rotation arrows or the room, or breaking the
  mobile layout.

## Behavior

### Places & auto-save

- A **place** is one `savedScenes` record (per-browser, via the existing
  anonymous Convex auth). Its `name` holds the generated title.
- A small shared store tracks the **current place id** and the room.art id last
  saved for it.
- Auto-save subscribes to the scene store, **debounced (~1s)**, and only runs
  once there is real content (a room.art or any objects) and Convex is ready:
  - **New environment** (scene gains a room.art that differs from the current
    place's saved art — i.e. a fresh `create` or demo pick): insert a **new
    record**, derive its title, make it the current place.
  - **Edits that keep the same room.art** (drag, volume, add/remove, mute):
    **patch the current record** in place; title unchanged.
- Loading a place sets the current id and saved-art so it is not re-created;
  the existing `startWorldRestore` subscription reinstalls its art/sounds.

### Titles (from the environment description)

- `placeTitle(concept, objects)` derives a short title from the art store's
  `env.concept` string: take the first sentence/clause, drop a leading
  article, keep the first ~4 meaningful words up to a comma/preposition, Title
  Case, cap ~28 chars. Fallbacks: the first object label, then "Untitled
  place". Pure function, unit-tested.

### New Place

- Resets the scene store to the empty canonical scene, clears the current place
  id and the managed session, and returns the app to the centered-prompt state
  (`hasScene = false`) with the four demo choices. The previous place is
  already saved, so nothing is lost. The next creation makes a new record.

## Layout / UI

- **Left sidebar (`places-dock`)**: fixed on the left, mirroring the right
  `assets-dock` width/offset and BorderBeam frosted card. Title **"Visited
  places"**. First row: **"New Place"** (＋). Then places newest-first; the
  active place is highlighted; clicking a row loads it. Shown whenever Convex is
  configured, including on the fresh centered-prompt screen (so you can jump
  back into a past place). On mobile it collapses the same way the Assets dock
  does.
- **Right sidebar**: `assets-dock` becomes a column of two cards.
  - **Assets** card on top: its list gets a max-height (~45% of the dock) and
    scrolls; the permanent "You" row and sources live inside the scroll area.
  - **Settings** card below, same frosted style. Contains the head-tracking
    toggle (switch + "Head tracking" label), and — while tracking is on — the
    "Recenter" button and status text underneath.
- **Center**: loses the Save/Load bar and the head-tracking row. Keeps the
  status line, prompt bar, demo choices and the Hey-agent voice controls.

## The how — decided

- **Backend** (`convex/savedScenes.ts`): add `create({name, scene}) → id` and
  `update({id, name, scene})` (ownership-checked patch by id). Keep `list`,
  `load`. No schema change (`name` carries the title).
- **State**: a small `places` store (zustand) for `currentId` + `savedArt`, or
  local refs inside the left-sidebar component. Auto-save lives in the
  left-sidebar component (inside the Convex provider) via a debounced scene
  subscription.
- **Components**: new `PlacesPanel` (left sidebar, owns list + auto-save),
  new `SettingsPanel` (right, below Assets). `AssetsPanel` stays the Assets
  card. `HeadTrackingControl` restyled as the toggle and rendered in Settings.
  Delete `SavedRooms.tsx`; remove it and `HeadTrackingControl` from
  `PromptBar`.
- **Wiring**: `App.tsx` renders `PlacesPanel` (with `hasScene`, an `onReset`
  that sets `hasScene=false`, and an `onLoad` that sets it true) and groups the
  right dock's two cards.
- **CSS** (`styles.css`): `places-dock`/`places-panel`/`place-row`/
  `place-new`; two-card right dock with a scrollable Assets list; the toggle
  switch (purple `#5b6ce0` when on).
- **Title helper** (`src/scene/placeTitle.ts`) with a vitest unit test.

## The how — left to the builder

- Exact debounce timing, highlight styling, the `＋`/switch markup, and the
  precise title heuristic wording, within the behavior above.

## Shared docs to update in the same PR

- `LAYOUT.md` and `CLAUDE.md` + `AGENTS.md` (kept identical): the canonical
  frontend now includes the left "Visited places" sidebar and the right
  Settings card; head tracking lives in Settings.

## Verification

- `npm run build`, `npm test` (incl. new `placeTitle` test), and the relevant
  `check:*`/browser tests. Update any existing test that clicks the center
  "Head tracking" checkbox to use the Settings toggle.
