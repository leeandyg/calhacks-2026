import { createPortal } from "react-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex, useConvexAuth, useConvexConnectionState, useMutation, useQuery } from "convex/react";
import { BorderBeam } from "border-beam";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import { convex } from "../scene/convex.js";
import { DEFAULT_GRID, Scene } from "../scene/scene.js";
import { useSceneStore } from "../scene/store.js";
import { useArtStore } from "../art/store.js";
import { createPlaceAutosave, savedPlaceBackend } from "../scene/placeAutosave.js";
import { resetManagedSession } from "../ai/managedClient.js";

type Props = { target: HTMLElement | null; hasScene: boolean; onReset: () => void; onLoad: () => void };

// The blank slate a New Place drops you into: only the fixed shell, no art, sources or session (#91).
function emptyScene() {
  return { room: { preset: "bedroom" as const, grid: DEFAULT_GRID, openings: [], reverb: "none" as const }, listener: { position: [0, 1.6, 0] as [number, number, number], yaw: 0 }, objects: [] };
}

function startNewPlace(onReset: () => void) {
  useSceneStore.getState().setScene(emptyScene());
  resetManagedSession();
  onReset();
}

// A saved library must never crash the playing room.
class PlacesBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

const NewPlaceButton = ({ onClick }: { onClick: () => void }) => (
  <li className="place-item">
    <button type="button" className="place-new" onClick={onClick}>
      <span className="place-plus" aria-hidden="true">+</span> New Place
    </button>
  </li>
);

function PlacesView({ hasScene, target, children }: Pick<Props, "hasScene" | "target"> & { children: ReactNode }) {
  if (!target) return null;
  return createPortal(hasScene
    ? <BorderBeam size="md" colorVariant="mono" strength={0.7} theme="dark" borderRadius={0} className="assets-beam places-beam">
        <section className="places-panel" aria-label="Visited places">
          <h2 className="assets-title">Visited places</h2>
          {children}
        </section>
      </BorderBeam>
    : <section className="initial-places" aria-label="Visited places">
        <h2 className="initial-places-title">Visited places</h2>
        {children}
      </section>, target);
}

export function PlacesPanel(props: Props) {
  if (convex) return <PlacesBoundary><ConnectedPlaces {...props}/></PlacesBoundary>;
  if (!props.hasScene) return null;
  return <PlacesView {...props}><ul className="places-list"><NewPlaceButton onClick={() => startNewPlace(props.onReset)}/></ul></PlacesView>;
}

function ConnectedPlaces({ hasScene, onReset, onLoad, target }: Props) {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { isWebSocketConnected } = useConvexConnectionState();
  const client = useConvex();
  const save = useMutation(api.savedScenes.save);
  const rooms = useQuery(api.savedScenes.list, isAuthenticated ? {} : "skip");
  const listedRooms = useRef(rooms);
  listedRooms.current = rooms;
  const [activeId, setActiveId] = useState<Id<"savedScenes"> | null>(null);
  const [notice, setNotice] = useState<string>();
  const autosave = useMemo(() => createPlaceAutosave<Id<"savedScenes">>({
    ...savedPlaceBackend(save, () => listedRooms.current ?? []), onActive: setActiveId,
    onError: failed => setNotice(failed ? "Could not save this place. Your next edit or reconnect will retry." : undefined),
  }), [save]);
  const attempted = useRef(false);

  useEffect(() => {
    if (isLoading || isAuthenticated || !isWebSocketConnected || attempted.current) return;
    attempted.current = true;
    void signIn("anonymous").catch(() => {});
  }, [isLoading, isAuthenticated, isWebSocketConnected, signIn]);

  const ready = isWebSocketConnected && isAuthenticated && rooms !== undefined;

  useEffect(() => {
    autosave.setReady(ready);
    return () => autosave.pause();
  }, [autosave, ready]);

  // Capture snapshots immediately; debounce backend writes without losing an earlier visit.
  // Art arrives independently of the canonical scene, so it must also refresh the saved label.
  useEffect(() => {
    if (!hasScene) return;
    const capture = () => {
      const scene = useSceneStore.getState().scene;
      const env = scene.room.art ? useArtStore.getState().envs[scene.room.art] : undefined;
      autosave.observe(scene, env?.concept, env?.title);
    };
    capture();
    const unsubscribeScene = useSceneStore.subscribe(capture);
    const unsubscribeArt = useArtStore.subscribe((state, before) => {
      const art = useSceneStore.getState().scene.room.art;
      if (art && (state.envs[art]?.concept !== before.envs[art]?.concept || state.envs[art]?.title !== before.envs[art]?.title)) capture();
    });
    return () => { unsubscribeScene(); unsubscribeArt(); };
  }, [hasScene, autosave]);

  const loadPlace = async (id: Id<"savedScenes">) => {
    setNotice(undefined);
    const before = useSceneStore.getState().scene;
    try {
      const saved = await client.query(api.savedScenes.load, { id });
      if (useSceneStore.getState().scene !== before) { setNotice("Your room changed while loading. Tap the place again."); return; }
      const parsed = Scene.parse(saved.scene);
      autosave.select(id, parsed.room.art);
      const result = useSceneStore.getState().setScene(parsed);
      if (!result.ok) { setNotice("That place could not load."); return; }
      resetManagedSession();
      onLoad();
    } catch { setNotice("Could not load that place."); }
  };

  const newPlace = () => {
    autosave.select(null); setNotice(undefined);
    startNewPlace(onReset);
  };

  if (!hasScene && !rooms?.length) return null;
  return <PlacesView hasScene={hasScene} target={target}>
    <ul className="places-list">
      {hasScene && <NewPlaceButton onClick={newPlace} />}
      {rooms?.map((room) => (
        <li key={room._id} className="place-item">
          <button type="button" className="place-row" aria-current={room._id === activeId || undefined} onClick={() => void loadPlace(room._id)}>
            {room.name}
          </button>
        </li>
      ))}
    </ul>
    {notice && <p className="places-note" role="status">{notice}</p>}
  </PlacesView>;
}
