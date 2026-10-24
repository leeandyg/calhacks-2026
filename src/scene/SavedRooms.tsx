import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex, useConvexAuth, useConvexConnectionState, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import { convex } from "./convex.js";
import { Scene } from "./scene.js";
import { useSceneStore } from "./store.js";

type Props = { disabled: boolean; onLoad: (name: string) => void };

// An unavailable/misconfigured cloud library must never take down the playing room.
class SavedRoomsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="saved-rooms">
      <p role="status">Saved rooms are unavailable. You can keep editing your room.</p>
      <button type="button" onClick={() => this.setState({ failed: false })}>Retry saved rooms</button>
    </div>;
    return this.props.children;
  }
}

export function SavedRooms(props: Props) {
  if (!convex) return <div className="saved-rooms"><p>Saving is not connected yet.</p></div>;
  return <SavedRoomsBoundary><ConnectedSavedRooms {...props} /></SavedRoomsBoundary>;
}

async function withDeadline<T>(request: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 10_000);
    })]);
  } finally { clearTimeout(timer!); }
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  return fallback;
}

function ConnectedSavedRooms({ disabled, onLoad }: Props) {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { isWebSocketConnected } = useConvexConnectionState();
  const client = useConvex();
  const save = useMutation(api.savedScenes.save);
  const rooms = useQuery(api.savedScenes.list, isAuthenticated ? {} : "skip");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Id<"savedScenes"> | "">("");
  const [pending, setPending] = useState<"save" | "load">();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [authError, setAuthError] = useState(false);
  const [retry, setRetry] = useState(0);
  const attempted = useRef(false);
  const mounted = useRef(true);
  const working = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (isLoading || isAuthenticated || !isWebSocketConnected || attempted.current) return;
    attempted.current = true;
    void signIn("anonymous").catch(() => {
      if (mounted.current) setAuthError(true);
    });
  }, [isLoading, isAuthenticated, isWebSocketConnected, signIn, retry]);

  const ready = isWebSocketConnected && isAuthenticated && rooms !== undefined;

  async function saveRoom() {
    if (!ready || disabled || working.current || !name.trim()) return;
    working.current = true;
    setPending("save"); setError(undefined); setNotice(undefined);
    const savedName = name.trim();
    try {
      // Snapshot at the click; a subscription update only refreshes the list.
      const scene = Scene.parse(useSceneStore.getState().scene);
      const id = await withDeadline(save({ name: savedName, scene }), "Save was not confirmed.");
      if (!mounted.current) return;
      setSelected(id);
      setNotice(`Saved “${savedName}”.`);
    } catch (error) {
      if (mounted.current) setError(errorMessage(error, "Save was not confirmed. Check your connection and saved rooms before retrying."));
    } finally {
      working.current = false;
      if (mounted.current) setPending(undefined);
    }
  }

  async function loadRoom() {
    if (!ready || disabled || working.current || !selected) return;
    working.current = true;
    setPending("load"); setError(undefined); setNotice(undefined);
    const before = useSceneStore.getState().scene;
    try {
      const saved = await withDeadline(client.query(api.savedScenes.load, { id: selected }), "Loading took too long.");
      if (!mounted.current) return;
      // Do not let a delayed load undo a newer prompt, preset selection, or manual drag.
      if (useSceneStore.getState().scene !== before) {
        setError("Your room changed while loading. Select Load room again to replace it.");
        return;
      }
      useSceneStore.getState().setScene(Scene.parse(saved.scene));
      setName(saved.name);
      onLoad(saved.name);
    } catch (error) {
      if (mounted.current) setError(errorMessage(error, "Could not load that saved room. Your current room was kept."));
    } finally {
      working.current = false;
      if (mounted.current) setPending(undefined);
    }
  }

  return <div className="saved-rooms">
    <fieldset disabled={disabled || Boolean(pending) || !ready}>
      <legend>Saved rooms</legend>
      <input aria-label="Room name" value={name} maxLength={80} placeholder="Room name"
        onChange={(event) => setName(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); void saveRoom(); }
        }} />
      <button type="button" disabled={!name.trim()} onClick={() => void saveRoom()}>{pending === "save" ? "Saving…" : "Save room"}</button>
      <select aria-label="Saved room" value={selected} onChange={(event) => setSelected(event.target.value as Id<"savedScenes"> | "")}>
        <option value="">{rooms?.length ? "Choose a saved room…" : "No saved rooms yet"}</option>
        {rooms?.map((room) => <option key={room._id} value={room._id}>{room.name}</option>)}
      </select>
      <button type="button" disabled={!selected} onClick={() => void loadRoom()}>{pending === "load" ? "Loading…" : "Load room"}</button>
    </fieldset>
    {authError ? <p role="status">Could not connect to saved rooms. <button type="button" onClick={() => {
      attempted.current = false; setAuthError(false); setRetry((value) => value + 1);
    }}>Retry</button></p> : !ready ? <p role="status">{isWebSocketConnected ? "Connecting to saved rooms…" : "Saved rooms are offline. You can keep editing."}</p>
      : <p>Use an existing name to replace that save. Saved rooms belong to this browser.</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
