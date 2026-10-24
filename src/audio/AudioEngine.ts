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
      const voice = this.voices.get(object.id);
      if (!voice) this.voices.set(object.id, new Voice(this.ctx, this.master, object));
      else if (voice.object !== object) voice.update(object);
    }
    for (const [id, voice] of this.voices) {
      if (!seen.has(id)) {
        voice.dispose();
        this.voices.delete(id);
      }
    }
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

/** One sound object: source -> gain -> HRTF panner -> master. */
class Voice {
  private gain: GainNode;
  private panner: PannerNode;
  private source?: AudioBufferSourceNode;
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
    void this.play();
  }

  update(object: SoundObject) {
    // TODO(#11): reload the buffer if object.sound.assetId changed
    this.object = object;
    const now = this.ctx.currentTime;
    const [x, y, z] = object.position;
    this.panner.positionX.setTargetAtTime(x, now, RAMP_SEC);
    this.panner.positionY.setTargetAtTime(y, now, RAMP_SEC);
    this.panner.positionZ.setTargetAtTime(z, now, RAMP_SEC);
    this.gain.gain.setTargetAtTime(object.volume, now, RAMP_SEC);
  }

  dispose() {
    this.disposed = true;
    this.source?.stop();
    this.panner.disconnect();
  }

  private async play() {
    // TODO(#11): events (kind "event") fire on a random timer within intervalSec
    if (this.object.kind !== "bed") return;
    const buffer = await loadBuffer(this.ctx, this.object.sound.assetId);
    if (!buffer || this.disposed) return;
    this.source = new AudioBufferSourceNode(this.ctx, { buffer, loop: true });
    this.source.connect(this.gain);
    // Random offset so two similar loops don't phase against each other
    this.source.start(0, Math.random() * buffer.duration);
  }
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
