import type { EditOpInput, Scene, SoundObject, Vec3 } from "../scene/scene.js";
import { useSceneStore } from "../scene/store.js";

// App audio in the room (#28). The Swift helper (helper/, #26/#27) finds each Mac app playing
// sustained audio (Spotify, Music, a video in another browser), mutes it and streams it here over a
// loopback WebSocket. Each stream plays through an AudioWorklet (public/live-stream-worklet.js) and
// becomes a "live" sound object, which the engine pans like any other. The object appears when the
// helper starts the stream, keeps its dragged spot when an agent create, a preset or Load room
// replaces the scene, and goes when the helper stops the stream. Without the helper this only
// retries the connection quietly.

const HELPER_URL = "ws://127.0.0.1:47800";
const RETRY_SEC = [1, 2, 5, 10]; // then every 10 s, so a helper started later is found
const END_AFTER_MS = 1000; // keeps a stopped stream's node playing (silence) through the voice's fade-out
const DEFAULT_VOLUME = 0.5; // apps play near -14 LUFS, louder than the pack's -20
const FIRST_POSITION: Vec3 = [0, 1, -2.5]; // in front of the listener; each further app 2 m to the right

type HelperMessage =
  | { type: "start"; stream: string; channel: number; name: string; sampleRate: number }
  | { type: "stop"; stream: string };
export type LiveStream = { stream: string; name: string };
type Placement = Pick<SoundObject, "position" | "wall" | "volume" | "muted" | "scale">;

const streams = new Map<string, LiveStream & { node: AudioWorkletNode }>(); // by stream id
const channels = new Map<number, AudioWorkletNode>();

/** The node playing a live stream, for the engine's voice. */
export function liveSource(stream: string): AudioNode | undefined {
  return streams.get(stream)?.node;
}

export function liveObjectId(stream: string): string {
  return `live-${stream.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/**
 * The ops that make the scene's live objects match the playing streams: removes objects whose
 * stream ended and adds a missing one where it last was (or in front of the listener).
 */
export function reconcileLive(scene: Scene, playing: LiveStream[], placements: Map<string, Placement>): EditOpInput[] {
  const wanted = new Set(playing.map((s) => s.stream));
  const ops: EditOpInput[] = scene.objects
    .filter((o) => o.kind === "live" && !wanted.has(o.sound.stream))
    .map((o) => ({ op: "remove", id: o.id }));
  playing.forEach(({ stream, name }, i) => {
    if (scene.objects.some((o) => o.kind === "live" && o.sound.stream === stream)) return;
    const [x, y, z] = FIRST_POSITION;
    const placed = placements.get(stream) ?? { position: [x + 2 * i, y, z], wall: null, volume: DEFAULT_VOLUME, muted: false, scale: 1 };
    ops.push({ op: "add", object: { id: liveObjectId(stream), label: name, kind: "live", model: "speaker", sound: { query: name, stream }, ...placed } });
  });
  return ops;
}

/** Connects to the helper and keeps live objects in the scene while it streams. Returns a stop function. */
export function startLiveAudio(ctx: AudioContext): () => void {
  // Automated browser tests run without the helper, and each failed connection logs a console error.
  if (navigator.webdriver) return () => {};
  const worklet = ctx.audioWorklet.addModule("/live-stream-worklet.js");
  const placements = new Map<string, Placement>();
  const starting = new Set<string>();
  const unplaced = new Set<string>(); // warned once that the room is full
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let stopped = false;

  const reconcile = () => {
    const { scene, applyOps } = useSceneStore.getState();
    for (const o of scene.objects) {
      if (o.kind === "live") placements.set(o.sound.stream, { position: o.position, wall: o.wall, volume: o.volume, muted: o.muted, scale: o.scale });
    }
    const ops = reconcileLive(scene, [...streams.values()], placements);
    if (!ops.length) return;
    const result = applyOps(ops);
    if (!result.ok) {
      for (const { stream, name } of streams.values()) {
        if (unplaced.has(stream)) continue;
        unplaced.add(stream);
        console.warn(`live audio: could not place ${name} in the room:`, result.error);
      }
    }
  };

  const end = (stream: string) => {
    starting.delete(stream);
    const playing = streams.get(stream);
    if (!playing) return;
    streams.delete(stream);
    for (const [channel, node] of channels) if (node === playing.node) channels.delete(channel);
    unplaced.delete(stream);
    reconcile();
    setTimeout(() => {
      playing.node.port.postMessage("end");
      playing.node.disconnect();
    }, END_AFTER_MS);
  };

  const onMessage = async (message: HelperMessage) => {
    if (message.type === "stop") return end(message.stream);
    if (message.type !== "start" || streams.has(message.stream)) return;
    starting.add(message.stream);
    await worklet;
    if (stopped || !starting.delete(message.stream)) return; // stopped while the worklet loaded
    const node = new AudioWorkletNode(ctx, "live-stream", {
      numberOfInputs: 0,
      outputChannelCount: [1],
      processorOptions: { inputRate: message.sampleRate },
    });
    streams.set(message.stream, { stream: message.stream, name: message.name, node });
    channels.set(message.channel, node);
    reconcile();
  };

  // Each frame: a little-endian Uint32 channel, then mono float32 samples.
  const onAudio = (frame: ArrayBuffer) => {
    const node = channels.get(new DataView(frame).getUint32(0, true));
    node?.port.postMessage(new Float32Array(frame, 4), [frame]);
  };

  const connect = () => {
    const ws = new WebSocket(HELPER_URL);
    socket = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      attempt = 0;
      ws.send(JSON.stringify({ type: "subscribe" }));
      console.info("live audio: connected to the room helper");
    };
    ws.onmessage = (event) => {
      if (typeof event.data === "string") void onMessage(JSON.parse(event.data) as HelperMessage);
      else onAudio(event.data as ArrayBuffer);
    };
    ws.onclose = () => {
      for (const stream of [...streams.keys(), ...starting]) end(stream);
      if (!stopped) retry = setTimeout(connect, RETRY_SEC[Math.min(attempt++, RETRY_SEC.length - 1)] * 1000);
    };
  };

  connect();
  const unsubscribe = useSceneStore.subscribe(reconcile);
  return () => {
    stopped = true;
    clearTimeout(retry);
    unsubscribe();
    socket?.close();
  };
}
