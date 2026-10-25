import { createPortal } from "react-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex, useConvexAuth, useConvexConnectionState, useMutation, useQuery } from "convex/react";
import { BorderBeam } from "border-beam";
import { Component, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import { convex } from "../scene/convex.js";
import { DEFAULT_GRID, Scene } from "../scene/scene.js";
import { useSceneStore } from "../scene/store.js";
import { resetManagedSession } from "../ai/managedClient.js";
import { resumeAudio } from "../audio/context.js";

type Props = { target: HTMLElement | null; hasScene: boolean; disabled?: boolean; onReset: () => void; onLoad: () => void };

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
class PlacesBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const NewPlaceButton = ({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) => (
  <li className="place-item">
    <button type="button" className="place-new" onClick={onClick} disabled={disabled}>
      <span className="place-plus" aria-hidden="true">+</span> New Place
    </button>
  </li>
);

function PlacesView({ target, children }: Pick<Props, "target"> & { children: ReactNode }) {
  if (!target) return null;
  return createPortal(<BorderBeam size="md" colorVariant="mono" strength={0.7} theme="dark" borderRadius={0} className="assets-beam places-beam">
        <section className="places-panel" aria-label="Saved places">
          <h2 className="assets-title">Saved places</h2>
          {children}
        </section>
      </BorderBeam>, target);
}

export function PlacesPanel(props: Props) {
  const unavailable = <PlacesView target={props.target}>
    <ul className="places-list"><NewPlaceButton disabled={props.disabled} onClick={() => startNewPlace(props.onReset)}/></ul>
    <p className="places-note" role="status">Saved places is unavailable. Your room is still open.</p>
  </PlacesView>;
  return convex ? <PlacesBoundary fallback={unavailable}><ConnectedPlaces {...props}/></PlacesBoundary> : unavailable;
}

function ConnectedPlaces({ hasScene, onReset, onLoad, target, disabled }: Props) {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { isWebSocketConnected } = useConvexConnectionState();
  const client = useConvex();
  const save = useMutation(api.savedScenes.save);
  const rooms = useQuery(api.savedScenes.list, isAuthenticated ? {} : "skip");
  const [activeId, setActiveId] = useState<Id<"savedScenes"> | null>(null);
  const [name, setName] = useState('');
  const [working, setWorking] = useState<'save' | 'load'>();
  const [notice, setNotice] = useState<string>();
  const attempted = useRef(false);

  useEffect(() => {
    if (isLoading || isAuthenticated || !isWebSocketConnected || attempted.current) return;
    attempted.current = true;
    void signIn("anonymous").catch(() => setNotice('Saved places could not connect. Reload to retry.'));
  }, [isLoading, isAuthenticated, isWebSocketConnected, signIn]);

  const ready = isWebSocketConnected && isAuthenticated && rooms !== undefined;

  const locked = disabled || Boolean(working);
  const savePlace = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!ready || locked || !hasScene || !trimmed) return;
    setWorking('save'); setNotice(undefined);
    try {
      const scene = Scene.parse(useSceneStore.getState().scene);
      const id = await save({ name: trimmed, scene });
      setActiveId(id); setName(trimmed); setNotice(`Saved ${trimmed}.`);
    } catch { setNotice('Could not save this place. Try again.'); }
    finally { setWorking(undefined); }
  };

  const loadPlace = async (id: Id<"savedScenes">) => {
    if (!ready || locked) return;
    setWorking('load'); setNotice(undefined);
    void resumeAudio().catch(() => {});
    const before = useSceneStore.getState().scene;
    try {
      const saved = await client.query(api.savedScenes.load, { id });
      if (useSceneStore.getState().scene !== before) { setNotice("Your room changed while loading. Tap the place again."); return; }
      const parsed = Scene.parse(saved.scene);
      const result = useSceneStore.getState().setScene(parsed);
      if (!result.ok) { setNotice("That place could not load."); return; }
      resetManagedSession();
      setActiveId(id); setName(saved.name); setNotice(`Loaded ${saved.name}.`);
      onLoad();
    } catch { setNotice("Could not load that place. Try again."); }
    finally { setWorking(undefined); }
  };

  const newPlace = () => {
    setActiveId(null); setName(''); setNotice(undefined);
    startNewPlace(onReset);
  };

  return <PlacesView target={target}>
    <form className="place-save" onSubmit={event => { void savePlace(event); }} aria-busy={working === 'save'}>
      <label htmlFor="place-name">Place name</label>
      <input id="place-name" type="text" placeholder="Name this place" value={name} maxLength={80} disabled={locked} onChange={event => setName(event.target.value)} autoComplete="off"/>
      <button type="submit" className="place-row" disabled={!ready || locked || !hasScene || !name.trim()}>{working === 'save' ? 'Saving…' : 'Save place'}</button>
      {rooms?.some(room => room.name === name.trim()) && <p className="places-note">Saving updates the place with this name.</p>}
    </form>
    <ul className="places-list">
      <NewPlaceButton disabled={locked} onClick={newPlace} />
      {rooms?.map((room) => (
        <li key={room._id} className="place-item">
          <button type="button" className="place-row place-load" title={room.name} aria-label={`Load ${room.name}`} aria-current={room._id === activeId || undefined} disabled={!ready || locked} onClick={() => void loadPlace(room._id)}>
            <span className="place-name">{room.name}</span><span className="place-load-label" aria-hidden="true">Load</span>
          </button>
        </li>
      ))}
    </ul>
    {!ready && !notice && <p className="places-note" role="status">Connecting to saved places…</p>}
    {ready && !rooms?.length && <p className="places-note">No saved places yet.</p>}
    {working && <p className="places-note" role="status">{working === 'save' ? 'Saving place…' : 'Loading place…'}</p>}
    {notice && <p className="places-note" role="status">{notice}</p>}
  </PlacesView>;
}
