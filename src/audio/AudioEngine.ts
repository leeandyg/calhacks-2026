import { setEventPlaying } from './activity.js';
import { isManagedSound, loadManagedSound, parseManagedAssetId } from './managed.js';
import { useEffect } from "react";
import type { Listener, Scene, SoundObject } from "../scene/scene.js";
import { useHeadPose } from "../sensors/headPose.js";
import { useSceneStore } from "../scene/store.js";
import { getAudioContext } from "./context.js";
import { subscribeDucking } from "./ducking.js";
import { addMeter, removeMeter } from "./levels.js";
import { elevenLabsEnabled, isGenerated, loadGenerated, parseGeneratedAssetId } from "./generated.js";
import { liveSource, startLiveAudio } from "./live.js";
import { loadManifest } from "./manifest.js";
import { matchSound, startResolver } from "./resolve.js";
import { Reverb } from "./reverb.js";

// Renders the scene store as sound. It reads only from the store, never from the 3D view,
// so drags, agent edits and presets all reach the audio the same way.
//
// Each store change is diffed against the previous scene by object id:
//   new id      -> create a Voice
//   changed obj -> voice.update() (the store replaces an object whenever it changes)
//   missing id  -> voice.dispose()

const RAMP_SEC = 0.05; // time constant for setTargetAtTime; long enough that drags never click
const FADE_SEC = 0.3; // fade for starting, stopping and swapping sounds
const LOOP_TRIM_SEC = 0.03; // skip the silence mp3 encoders add at each end, or loops gap
const MAX_HRTF = 12; // HRTF is expensive; quieter voices beyond this use equal-power panning
const EVENT_DETUNE_CENTS = 100; // random pitch spread so repeated events don't sound identical
const EVENT_MIN_GAIN = 0.75; // vary each occurrence below the user's chosen volume
const FIRST_EVENT_SEC: [number, number] = [0.5, 3]; // a new event sound plays soon, so its prop isn't silent
const MAX_EVENT_GAP_SEC = 30; // longer gaps make an event prop seem broken
const MUTE_FADE_SEC = 0.25; // muting or unmuting fades instead of cutting

export class AudioEngine {
  private voices = new Map<string, Voice>();
  private master: GainNode;
  private output: GainNode;
  private unsubscribeDucking: () => void;
  private reverb: Reverb;
  private unsubscribe?: () => void;
  private unsubscribeHead?: () => void;

  constructor(private ctx: AudioContext) {
    this.master = ctx.createGain();
    this.output = ctx.createGain();
    this.master.connect(this.output).connect(ctx.destination);
    this.reverb = new Reverb(ctx, this.output);
    this.unsubscribeDucking = subscribeDucking((gain) => {
      this.output.gain.setTargetAtTime(gain, ctx.currentTime, gain < 1 ? 0.035 : 0.12);
    });
  }

  start() {
    this.sync(useSceneStore.getState().scene, undefined);
    this.unsubscribe = useSceneStore.subscribe((state, prev) => this.sync(state.scene, prev.scene));
    // Turning your head (head tracking, #21) turns your ears; the sounds stay where they are in the room.
    this.unsubscribeHead = useHeadPose.subscribe((state, prev) => {
      if (state.yaw !== prev.yaw) this.setListener(useSceneStore.getState().scene.listener);
    });
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribeHead?.();
    this.unsubscribeDucking();
    for (const voice of this.voices.values()) voice.dispose();
    this.voices.clear();
    this.master.disconnect();
    this.reverb.disconnect();
    this.output.disconnect();
  }

  private sync(scene: Scene, prev: Scene | undefined) {
    if (scene.listener !== prev?.listener) this.setListener(scene.listener);
    if (scene.room.reverb !== prev?.room.reverb) this.reverb.setPreset(scene.room.reverb);

    const seen = new Set<string>();
    for (const object of scene.objects) {
      seen.add(object.id);
      let voice = this.voices.get(object.id);
      if (voice && voice.object.kind !== object.kind) {
        // bed <-> event plays completely differently; start over
        voice.dispose();
        voice = undefined;
      }
      if (!voice) this.voices.set(object.id, new Voice(this.ctx, this.master, this.reverb.input, object));
      else if (voice.object !== object) voice.update(object);
    }
    for (const [id, voice] of this.voices) {
      if (!seen.has(id)) {
        voice.dispose();
        this.voices.delete(id);
      }
    }

    this.assignPanningModels(scene.listener);
  }

  /** The loudest MAX_HRTF voices (volume over distance) get HRTF; the rest get equal-power. */
  private assignPanningModels(listener: Listener) {
    const loudness = (v: Voice) => (v.object.muted ? 0 : v.object.volume) / Math.max(1, distance(v.object.position, listener.position));
    const ranked = [...this.voices.values()].sort((a, b) => loudness(b) - loudness(a));
    ranked.forEach((voice, i) => voice.setPanningModel(i < MAX_HRTF ? "HRTF" : "equalpower"));
  }

  /**
   * The listener sits in the room and faces scene.listener.yaw plus the tracked head's yaw (#21).
   * Turning the room view only moves the camera around the room, so it never changes what you hear.
   */
  private setListener({ position: [x, y, z], yaw: sceneYaw }: Listener) {
    const l = this.ctx.listener;
    const now = this.ctx.currentTime;
    const yaw = sceneYaw + useHeadPose.getState().yaw;
    const forward = [-Math.sin(yaw), 0, -Math.cos(yaw)];
    if (l.positionX) {
      l.positionX.setTargetAtTime(x, now, RAMP_SEC);
      l.positionY.setTargetAtTime(y, now, RAMP_SEC);
      l.positionZ.setTargetAtTime(z, now, RAMP_SEC);
      l.forwardX.setTargetAtTime(forward[0], now, RAMP_SEC);
      l.forwardY.setTargetAtTime(forward[1], now, RAMP_SEC);
      l.forwardZ.setTargetAtTime(forward[2], now, RAMP_SEC);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      // Firefox: no AudioParams on the listener
      l.setPosition(x, y, z);
      l.setOrientation(forward[0], forward[1], forward[2], 0, 1, 0);
    }
  }
}

/**
 * One sound object: source(s) -> gain -> HRTF panner -> master, plus gain -> send -> reverb, and
 * gain -> analyser for the room view's level meter (levels.ts).
 * The send is taken before the panner, so the reverb doesn't fade with distance (see reverb.ts).
 * Beds loop one source (with its own fade gain so sound swaps crossfade).
 * Live objects play an app's stream from the room helper (live.ts) instead of a file.
 * Events play soon after a new sound arrives, then wait a fresh random silent gap within intervalSec
 * (at most MAX_EVENT_GAP_SEC) after each play.
 */
type Playback = { source: AudioBufferSourceNode; fade: GainNode };

class Voice {
  private gain: GainNode;
  private panner: PannerNode;
  private send: GainNode;
  private analyser: AnalyserNode;
  private bed?: Playback;
  private live?: { node: AudioNode; fade: GainNode };
  private liveStream?: string;
  private events = new Set<Playback>();
  private eventLoading = false;
  private firstPlay = true; // the current event sound hasn't played yet
  private timer?: ReturnType<typeof setTimeout>;
  private loadedAssetId?: string;
  private loadVersion = 0;
  private disposed = false;

  constructor(
    private ctx: AudioContext,
    output: AudioNode,
    reverb: AudioNode,
    public object: SoundObject,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.panner = new PannerNode(ctx, {
      panningModel: "HRTF",
      distanceModel: "inverse",
      // Events are brief and already mixed below beds. A 2 m reference keeps them audible
      // at the perimeter (+6 dB beyond 2 m), while retaining inverse-distance falloff.
      refDistance: object.kind === "event" ? 2 : 1,
      rolloffFactor: 1,
    });
    this.gain.connect(this.panner).connect(output);
    this.send = new GainNode(ctx, { gain: 1 });
    this.gain.connect(this.send).connect(reverb);
    this.analyser = new AnalyserNode(ctx, { fftSize: 1024 });
    this.gain.connect(this.analyser);
    addMeter(object.id, this.analyser);
    this.update(object);
  }

  update(object: SoundObject) {
    const previous = this.object;
    this.object = object;
    const now = this.ctx.currentTime;
    const [x, y, z] = object.position;
    this.panner.positionX.setTargetAtTime(x, now, RAMP_SEC);
    this.panner.positionY.setTargetAtTime(y, now, RAMP_SEC);
    this.panner.positionZ.setTargetAtTime(z, now, RAMP_SEC);
    // Muting (a click on the object) fades it out but keeps its volume for unmuting.
    const fade = object.muted !== previous.muted ? MUTE_FADE_SEC / 3 : RAMP_SEC;
    this.gain.gain.setTargetAtTime(object.muted ? 0 : object.volume, now, fade);
    // A missing replacement asset must stop the old sound too.
    if (object.kind === "bed" && object.sound.assetId !== this.loadedAssetId) void this.playBed();
    if (object.kind === "live" && object.sound.stream !== this.liveStream) this.playLive(object.sound.stream);
    if (object.kind === "event") {
      const changedAsset = object.sound.assetId !== this.loadedAssetId;
      if (changedAsset) {
        this.loadedAssetId = object.sound.assetId;
        this.loadVersion++;
        this.eventLoading = false;
        this.firstPlay = true;
        this.stopEvents();
      }
      if (changedAsset || previous.kind !== "event" ||
          previous.intervalSec[0] !== object.intervalSec[0] || previous.intervalSec[1] !== object.intervalSec[1]) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
      this.scheduleEvent();
    }
  }

  setPanningModel(model: PanningModelType) {
    if (this.panner.panningModel !== model) this.panner.panningModel = model;
  }

  dispose() {
    this.disposed = true;
    this.loadVersion++;
    removeMeter(this.object.id, this.analyser);
    clearTimeout(this.timer);
    this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, RAMP_SEC);
    this.stopBed();
    this.stopEvents();
    this.stopLive();
    // Disconnect after the fade so removing a sound never clicks
    setTimeout(() => {
      this.panner.disconnect();
      this.send.disconnect();
      this.analyser.disconnect();
    }, FADE_SEC * 1000 * 2);
  }

  /** Starts (or crossfades to) the bed loop for the current assetId. */
  private async playBed() {
    const assetId = this.object.sound.assetId;
    const version = ++this.loadVersion;
    this.loadedAssetId = assetId;
    this.stopBed();
    const buffer = await loadBuffer(this.ctx, assetId);
    // Ignore if disposed or the asset changed again while loading
    if (this.disposed || this.loadVersion !== version) return;
    if (!buffer) {
      this.loadedAssetId = undefined; // A later scene update may retry a failed file load.
      return;
    }

    const loopStart = buffer.duration > 1 ? LOOP_TRIM_SEC : 0;
    const loopEnd = buffer.duration - loopStart;
    const source = new AudioBufferSourceNode(this.ctx, { buffer, loop: true, loopStart, loopEnd });
    const fade = new GainNode(this.ctx, { gain: 0 });
    source.connect(fade).connect(this.gain);
    source.onended = () => { source.disconnect(); fade.disconnect(); };
    // Random offset so two similar loops don't phase against each other
    source.start(0, loopStart + Math.random() * (loopEnd - loopStart));
    fade.gain.setTargetAtTime(1, this.ctx.currentTime, FADE_SEC / 3);
    this.bed = { source, fade };
  }

  /** Plays a live app stream through this voice. The stream's node belongs to live.ts. */
  private playLive(stream: string) {
    this.stopLive();
    this.liveStream = stream;
    const node = liveSource(stream);
    if (!node) return;
    const fade = new GainNode(this.ctx, { gain: 0 });
    node.connect(fade).connect(this.gain);
    fade.gain.setTargetAtTime(1, this.ctx.currentTime, FADE_SEC / 3);
    this.live = { node, fade };
  }

  private stopLive() {
    if (!this.live) return;
    const { node, fade } = this.live;
    this.live = undefined;
    fade.gain.setTargetAtTime(0, this.ctx.currentTime, FADE_SEC / 3);
    setTimeout(() => {
      fade.disconnect();
      try {
        node.disconnect(fade);
      } catch {
        // live.ts already disconnected the ended stream
      }
    }, FADE_SEC * 1000 * 2);
  }

  private stopBed() {
    if (!this.bed) return;
    this.stopPlayback(this.bed);
    this.bed = undefined;
  }

  private stopPlayback({ source, fade }: Playback) {
    const now = this.ctx.currentTime;
    fade.gain.setTargetAtTime(0, now, FADE_SEC / 3);
    source.stop(now + FADE_SEC);
  }

  private stopEvents() {
    for (const event of this.events) this.stopPlayback(event);
    this.events.clear();
    setEventPlaying(this.object.id, false);
  }

  private scheduleEvent(soon = this.firstPlay) {
    if (this.object.kind !== "event" || this.disposed || this.timer !== undefined || this.eventLoading || this.events.size) return;
    const [a, b] = this.object.intervalSec;
    const delaySec = soon ? randomBetween(...FIRST_EVENT_SEC)
      : randomBetween(Math.min(a, b, MAX_EVENT_GAP_SEC), Math.min(Math.max(a, b), MAX_EVENT_GAP_SEC));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.playEvent();
    }, delaySec * 1000);
  }

  private async playEvent() {
    const version = this.loadVersion;
    this.eventLoading = true;
    const buffer = await loadBuffer(this.ctx, this.object.sound.assetId);
    if (this.disposed || this.loadVersion !== version) return;
    this.eventLoading = false;
    if (!buffer) {
      // Retry at the normal pace; a newly resolved sound arrives through update() and plays soon.
      this.scheduleEvent(false);
      return;
    }
    this.firstPlay = false;
    const detune = randomBetween(-EVENT_DETUNE_CENTS, EVENT_DETUNE_CENTS);
    const source = new AudioBufferSourceNode(this.ctx, { buffer, detune, loop: false });
    const fade = new GainNode(this.ctx, { gain: randomBetween(EVENT_MIN_GAIN, 1) });
    const playback = { source, fade };
    source.connect(fade).connect(this.gain);
    this.events.add(playback);
    source.onended = () => {
      source.disconnect();
      fade.disconnect();
      this.events.delete(playback);
      if (!this.events.size) setEventPlaying(this.object.id, false);
      if (this.loadVersion === version) this.scheduleEvent();
    };
    source.start();
    setEventPlaying(this.object.id, true);
  }
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function distance([ax, ay, az]: readonly number[], [bx, by, bz]: readonly number[]) {
  return Math.hypot(ax - bx, ay - by, az - bz);
}

const buffers = new Map<string, Promise<AudioBuffer | undefined>>();

function loadBuffer(ctx: AudioContext, assetId: string | undefined): Promise<AudioBuffer | undefined> {
  if (!assetId) return Promise.resolve(undefined); // not resolved yet (see resolve.ts)
  let buffer = buffers.get(assetId);
  if (!buffer) {
    buffer = (isManagedSound(assetId) ? loadManagedOrFallback(ctx, assetId) : isGenerated(assetId) ? loadGeneratedOrFallback(ctx, assetId) : loadPackSound(ctx, assetId)).catch((err) => {
      // Retry pack files after transient network/decode failures. A failed generated or agent sound
      // is not retried: each scene update (every drag frame) would otherwise fetch it again.
      if (!isGenerated(assetId) && !isManagedSound(assetId)) buffers.delete(assetId);
      console.warn(`audio: could not load "${assetId}"`, err);
      return undefined;
    });
    buffers.set(assetId, buffer);
  }
  return buffer;
}

// Library files fetched before they play, by assetId: demo rooms warm theirs (capturedDemos.ts).
const packFiles = new Map<string, Promise<ArrayBuffer>>();

/** Downloads a library sound ahead of time, so choosing a demo room plays it without waiting. */
export function preloadPackSound(assetId: string): Promise<ArrayBuffer> {
  let file = packFiles.get(assetId);
  if (!file) {
    file = fetchPackFile(assetId).catch((error) => { packFiles.delete(assetId); throw error; });
    packFiles.set(assetId, file);
  }
  return file;
}

async function fetchPackFile(assetId: string) {
  const entry = (await loadManifest()).get(assetId);
  if (!entry) throw new Error(`no manifest entry "${assetId}"`);
  const res = await fetch(`/sounds/${entry.file}`);
  if (!res.ok) throw new Error(`Sound file failed: ${res.status}`);
  return res.arrayBuffer();
}

async function loadPackSound(ctx: AudioContext, assetId: string) {
  // The decoded buffer is cached in `buffers`, so a warmed file is used once and let go.
  const file = packFiles.get(assetId) ?? fetchPackFile(assetId);
  packFiles.delete(assetId);
  return ctx.decodeAudioData(await file);
}

/**
 * A sound the library lacks: generate it with ElevenLabs when that's enabled, otherwise (or if
 * generation fails: no key, no credits, offline) play the closest pack sound so something still plays.
 */
async function loadGeneratedOrFallback(ctx: AudioContext, assetId: string): Promise<AudioBuffer | undefined> {
  const { kind, query } = parseGeneratedAssetId(assetId);
  if (!elevenLabsEnabled) return closestPackSound(ctx, kind, query, "live generation is off");
  try {
    return await loadGenerated(ctx, assetId);
  } catch (err) {
    console.warn(`audio: generating "${query}" failed`, err);
    return closestPackSound(ctx, kind, query, "generation failed");
  }
}

/** The Claude agent's chirp sound, or the closest pack sound if this page can't load it. */
async function loadManagedOrFallback(ctx: AudioContext, assetId: string): Promise<AudioBuffer | undefined> {
  try {
    return await loadManagedSound(ctx, assetId);
  } catch (err) {
    const { kind, query } = parseManagedAssetId(assetId);
    console.warn(`audio: the agent's sound for "${query}" is unavailable`, err);
    return closestPackSound(ctx, kind, query, "agent sound unavailable");
  }
}

async function closestPackSound(ctx: AudioContext, kind: Exclude<SoundObject["kind"], "live">, query: string, reason: string) {
  const fallback = matchSound(query, kind, (await loadManifest()).values());
  console.info(`audio: ${reason} for "${query}"; ${fallback ? `playing "${fallback.assetId}"` : "no close pack sound"}`);
  return fallback ? loadBuffer(ctx, fallback.assetId) : undefined;
}

/**
 * Runs the engine, the resolver and the room helper's live app audio after the user's first room
 * has been created.
 */
export function useAudioEngine(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const stopResolver = startResolver();
    const engine = new AudioEngine(getAudioContext());
    engine.start();
    const stopLive = startLiveAudio(getAudioContext());
    return () => {
      stopLive();
      engine.stop();
      stopResolver();
    };
  }, [enabled]);
}
