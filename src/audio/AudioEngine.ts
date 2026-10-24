import { useEffect } from "react";
import type { Listener, Scene, SoundObject } from "../scene/scene.js";
import { useSceneStore } from "../scene/store.js";
import { getAudioContext } from "./context.js";
import { loadManifest } from "./manifest.js";

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

export class AudioEngine {
  private voices = new Map<string, Voice>();
  private master: GainNode;
  private unsubscribe?: () => void;

  constructor(private ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    // TODO(#12): route master through a ConvolverNode per room.reverb
  }

  start() {
    this.sync(useSceneStore.getState().scene, undefined);
    this.unsubscribe = useSceneStore.subscribe((state, prev) => this.sync(state.scene, prev.scene));
  }

  stop() {
    this.unsubscribe?.();
    for (const voice of this.voices.values()) voice.dispose();
    this.voices.clear();
    this.master.disconnect();
  }

  private sync(scene: Scene, prev: Scene | undefined) {
    if (scene.listener !== prev?.listener) this.setListener(scene.listener);

    const seen = new Set<string>();
    for (const object of scene.objects) {
      seen.add(object.id);
      let voice = this.voices.get(object.id);
      if (voice && voice.object.kind !== object.kind) {
        // bed <-> event plays completely differently; start over
        voice.dispose();
        voice = undefined;
      }
      if (!voice) this.voices.set(object.id, new Voice(this.ctx, this.master, object));
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
    const loudness = (v: Voice) => v.object.volume / Math.max(1, distance(v.object.position, listener.position));
    const ranked = [...this.voices.values()].sort((a, b) => loudness(b) - loudness(a));
    ranked.forEach((voice, i) => voice.setPanningModel(i < MAX_HRTF ? "HRTF" : "equalpower"));
  }

  private setListener({ position: [x, y, z], yaw }: Listener) {
    const l = this.ctx.listener;
    const now = this.ctx.currentTime;
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
 * One sound object: source(s) -> gain -> HRTF panner -> master.
 * Beds loop one source (with its own fade gain so sound swaps crossfade).
 * Events start a fresh one-shot source on a random timer within intervalSec.
 */
class Voice {
  private gain: GainNode;
  private panner: PannerNode;
  private bed?: { source: AudioBufferSourceNode; fade: GainNode };
  private timer?: ReturnType<typeof setTimeout>;
  private loadedAssetId?: string;
  private disposed = false;

  constructor(
    private ctx: AudioContext,
    output: AudioNode,
    public object: SoundObject,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.panner = new PannerNode(ctx, {
      panningModel: "HRTF",
      distanceModel: "inverse",
      refDistance: 1,
      rolloffFactor: 1,
    });
    this.gain.connect(this.panner).connect(output);
    this.update(object);
    if (object.kind === "event") this.scheduleEvent();
  }

  update(object: SoundObject) {
    this.object = object;
    const now = this.ctx.currentTime;
    const [x, y, z] = object.position;
    this.panner.positionX.setTargetAtTime(x, now, RAMP_SEC);
    this.panner.positionY.setTargetAtTime(y, now, RAMP_SEC);
    this.panner.positionZ.setTargetAtTime(z, now, RAMP_SEC);
    this.gain.gain.setTargetAtTime(object.volume, now, RAMP_SEC);
    // Events load their buffer on each play, so only beds need to swap here
    if (object.kind === "bed" && object.sound.assetId !== this.loadedAssetId) void this.playBed();
  }

  setPanningModel(model: PanningModelType) {
    if (this.panner.panningModel !== model) this.panner.panningModel = model;
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, RAMP_SEC);
    this.stopBed();
    // Disconnect after the fade so removing a sound never clicks
    setTimeout(() => this.panner.disconnect(), FADE_SEC * 1000 * 2);
  }

  /** Starts (or crossfades to) the bed loop for the current assetId. */
  private async playBed() {
    const assetId = this.object.sound.assetId;
    this.loadedAssetId = assetId;
    const buffer = await loadBuffer(this.ctx, assetId);
    // Ignore if disposed or the asset changed again while loading
    if (!buffer || this.disposed || this.loadedAssetId !== assetId) return;

    this.stopBed();
    const loopStart = buffer.duration > 1 ? LOOP_TRIM_SEC : 0;
    const loopEnd = buffer.duration - loopStart;
    const source = new AudioBufferSourceNode(this.ctx, { buffer, loop: true, loopStart, loopEnd });
    const fade = new GainNode(this.ctx, { gain: 0 });
    source.connect(fade).connect(this.gain);
    // Random offset so two similar loops don't phase against each other
    source.start(0, loopStart + Math.random() * (loopEnd - loopStart));
    fade.gain.setTargetAtTime(1, this.ctx.currentTime, FADE_SEC / 3);
    this.bed = { source, fade };
  }

  private stopBed() {
    if (!this.bed) return;
    const { source, fade } = this.bed;
    const now = this.ctx.currentTime;
    fade.gain.setTargetAtTime(0, now, FADE_SEC / 3);
    source.stop(now + FADE_SEC);
    this.bed = undefined;
  }

  private scheduleEvent() {
    if (this.object.kind !== "event" || this.disposed) return;
    const [a, b] = this.object.intervalSec;
    const delaySec = randomBetween(Math.min(a, b), Math.max(a, b));
    this.timer = setTimeout(() => {
      void this.playEvent();
      this.scheduleEvent();
    }, delaySec * 1000);
  }

  private async playEvent() {
    const buffer = await loadBuffer(this.ctx, this.object.sound.assetId);
    if (!buffer || this.disposed) return;
    const detune = randomBetween(-EVENT_DETUNE_CENTS, EVENT_DETUNE_CENTS);
    const source = new AudioBufferSourceNode(this.ctx, { buffer, detune });
    source.connect(this.gain);
    source.start();
  }
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function distance([ax, ay, az]: readonly number[], [bx, by, bz]: readonly number[]) {
  return Math.hypot(ax - bx, ay - by, az - bz);
}

const buffers = new Map<string, Promise<AudioBuffer | undefined>>();

function loadBuffer(ctx: AudioContext, assetId: string | undefined) {
  if (!assetId) return Promise.resolve(undefined); // not resolved yet (#17)
  let buffer = buffers.get(assetId);
  if (!buffer) {
    buffer = loadManifest()
      .then((manifest) => {
        const entry = manifest.get(assetId);
        if (!entry) throw new Error(`no manifest entry "${assetId}"`);
        return fetch(`/sounds/${entry.file}`);
      })
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .catch((err) => {
        console.warn(`audio: could not load "${assetId}"`, err);
        return undefined;
      });
    buffers.set(assetId, buffer);
  }
  return buffer;
}

/** Runs the engine while `enabled` (after the "Enter room" click). */
export function useAudioEngine(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const engine = new AudioEngine(getAudioContext());
    engine.start();
    return () => engine.stop();
  }, [enabled]);
}
