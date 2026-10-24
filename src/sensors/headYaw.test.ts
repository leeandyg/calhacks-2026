import { describe, expect, it } from 'vitest';
import { Matrix4 } from 'three';
import { GLIDE_SEC, HeadYawTracker, LOST_SEC, yawFromMatrix } from './headYaw.js';

const FRAME = 1 / 30; // webcam frame rate
const CENTER = 0.3; // the camera sits a little off to one side of the screen

/** Feeds `raw(t)` (null: no face) for `seconds`, one camera frame at a time; returns the last output. */
function run(tracker: HeadYawTracker, clock: { t: number }, seconds: number, raw: (t: number) => number | null) {
  let output = 0;
  for (const end = clock.t + seconds; clock.t < end - 1e-9; clock.t += FRAME) output = tracker.update(raw(clock.t), clock.t);
  return output;
}

describe('webcam head yaw (#21)', () => {
  it('reads yaw from the column-major facial transformation matrix: positive is turned to the left', () => {
    // A face turned 0.5 rad to the user's left points its forward axis (+z) toward the camera's +x.
    expect(yawFromMatrix(new Matrix4().makeRotationY(0.5).toArray())).toBeCloseTo(0.5);
    expect(yawFromMatrix(new Matrix4().makeRotationY(-0.4).setPosition(0, 0, -40).toArray())).toBeCloseTo(-0.4);
  });

  it('treats the first face as forward, then follows a turn', () => {
    const tracker = new HeadYawTracker();
    const clock = { t: 0 };
    expect(run(tracker, clock, 0.5, () => CENTER)).toBeCloseTo(0);
    run(tracker, clock, 0.5, (t) => CENTER + 0.8 * Math.min(1, (t - 0.5) / 0.4));
    expect(run(tracker, clock, 0.5, () => CENTER + 0.8)).toBeCloseTo(0.8, 2);
  });

  it('smooths camera jitter while the head is still', () => {
    const tracker = new HeadYawTracker();
    const clock = { t: 0 };
    const noisy = (i: number) => CENTER + (i % 2 ? 0.02 : -0.02); // ±0.02 rad, frame to frame
    run(tracker, clock, 1, () => CENTER);
    for (let i = 0; i < 60; i++, clock.t += FRAME) tracker.update(noisy(i), clock.t);
    const outputs: number[] = [];
    for (let i = 0; i < 30; i++, clock.t += FRAME) outputs.push(tracker.update(noisy(i), clock.t));
    expect(Math.max(...outputs) - Math.min(...outputs)).toBeLessThan(0.04 / 2); // under half the raw swing
  });

  it('holds the last yaw while the face is lost, and glides back to the measured yaw', () => {
    const tracker = new HeadYawTracker();
    const clock = { t: 0 };
    run(tracker, clock, 0.5, () => CENTER);
    run(tracker, clock, 1, () => CENTER + 0.8);
    const held = run(tracker, clock, 0.1, () => null);
    expect(held).toBeCloseTo(0.8, 2);
    expect(tracker.lost(clock.t)).toBe(false); // a blink-length gap isn't "lost"
    expect(run(tracker, clock, 2, () => null)).toBe(held); // turned away: hold, don't snap to 0
    expect(tracker.lost(clock.t)).toBe(true);

    // The face is found again, now only 0.1 rad to the left.
    const first = tracker.update(CENTER + 0.1, clock.t);
    expect(tracker.lost(clock.t)).toBe(false);
    expect(first).toBeCloseTo(held, 1); // no jump
    clock.t += FRAME;
    const mid = run(tracker, clock, GLIDE_SEC / 2, () => CENTER + 0.1);
    expect(mid).toBeLessThan(held - 0.1);
    expect(mid).toBeGreaterThan(0.1 + 0.1);
    expect(run(tracker, clock, GLIDE_SEC, () => CENTER + 0.1)).toBeCloseTo(0.1, 3);
  });

  it('a gap shorter than LOST_SEC continues without a glide', () => {
    const tracker = new HeadYawTracker();
    const clock = { t: 0 };
    run(tracker, clock, 0.5, () => CENTER);
    run(tracker, clock, 1, () => CENTER + 0.5);
    run(tracker, clock, LOST_SEC / 2, () => null);
    expect(run(tracker, clock, 0.2, () => CENTER + 0.5)).toBeCloseTo(0.5, 2);
  });

  it('recenter makes the current direction forward, with a glide', () => {
    const tracker = new HeadYawTracker();
    const clock = { t: 0 };
    run(tracker, clock, 0.5, () => CENTER);
    run(tracker, clock, 1, () => CENTER + 0.6);
    tracker.recenter(clock.t);
    expect(tracker.update(CENTER + 0.6, clock.t)).toBeCloseTo(0.6, 1);
    clock.t += FRAME;
    expect(run(tracker, clock, GLIDE_SEC + 0.1, () => CENTER + 0.6)).toBeCloseTo(0, 3);
    expect(run(tracker, clock, 1, () => CENTER + 0.9)).toBeCloseTo(0.3, 2); // turns are now from the new forward
  });
});
