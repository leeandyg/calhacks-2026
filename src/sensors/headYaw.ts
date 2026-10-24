// Head yaw from the webcam, made steady enough to turn the listener (#21). Pure, so it can be tested
// without a camera: webcamHeadTracking.ts feeds it one value per video frame.

/** Smooth while the head is still, quick while it turns (One Euro filter, Casiez et al. 2012). */
const MIN_CUTOFF_HZ = 1;
const BETA = 2; // how fast the cutoff rises with turning speed (rad/s)
const DERIVATIVE_CUTOFF_HZ = 1;
/** Missing the face this long counts as lost; shorter gaps (a blink, a hand) just hold. */
export const LOST_SEC = 0.25;
/** After the face is found again, glide to where the head really is instead of jumping. */
export const GLIDE_SEC = 0.3;

/**
 * Radians the head is turned to the user's left (positive) from facing the camera.
 * MediaPipe's facial transformation matrix is column-major (drei reads it with Matrix4.fromArray).
 * Its third column is the face's forward axis in camera space (x to the right of the unmirrored
 * image, camera looking down -z), so a face turned to the user's left points toward +x.
 */
export function yawFromMatrix(data: ArrayLike<number>): number {
  return Math.atan2(data[8], data[10]);
}

class OneEuroFilter {
  private x?: number;
  private dx = 0;
  private t = 0;

  reset() {
    this.x = undefined;
  }

  filter(value: number, t: number): number {
    if (this.x === undefined) {
      this.x = value;
      this.dx = 0;
      this.t = t;
      return value;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.dx += alpha(DERIVATIVE_CUTOFF_HZ) * ((value - this.x) / dt - this.dx);
    this.x += alpha(MIN_CUTOFF_HZ + BETA * Math.abs(this.dx)) * (value - this.x);
    return this.x;
  }
}

/**
 * Turns raw per-frame yaw (or null: no face) into the yaw the listener uses:
 * - the first face sets "forward", so the direction you face when tracking starts is straight ahead;
 * - while the face is missing (turned away, covered, out of frame) the last yaw holds;
 * - when the face comes back, the yaw glides to the measured one over GLIDE_SEC;
 * - recenter() makes the current direction forward, also with a glide.
 */
export class HeadYawTracker {
  private filter = new OneEuroFilter();
  private center?: number;
  private smoothed?: number;
  private output = 0;
  private missingSince?: number;
  private glide?: { from: number; start: number };

  update(raw: number | null, t: number): number {
    if (raw === null) {
      this.missingSince ??= t;
      return this.output;
    }
    const reacquired = this.missingSince !== undefined && t - this.missingSince > LOST_SEC;
    this.missingSince = undefined;
    if (reacquired) {
      this.filter.reset(); // the old filter state is from before the head turned away
      this.glide = { from: this.output, start: t };
    }
    this.smoothed = this.filter.filter(raw, t);
    this.center ??= this.smoothed;
    const target = wrap(this.smoothed - this.center);
    if (this.glide) {
      const progress = (t - this.glide.start) / GLIDE_SEC;
      if (progress < 1) return (this.output = this.glide.from + (target - this.glide.from) * easeInOut(progress));
      this.glide = undefined;
    }
    return (this.output = target);
  }

  /** True once a face has been seen (and "forward" set). */
  get seen(): boolean {
    return this.center !== undefined;
  }

  /** True once the face has been missing for longer than LOST_SEC. */
  lost(t: number): boolean {
    return this.missingSince !== undefined && t - this.missingSince > LOST_SEC;
  }

  recenter(t: number) {
    if (this.smoothed === undefined) return;
    this.center = this.smoothed;
    this.glide = { from: this.output, start: t };
  }
}

function wrap(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function easeInOut(x: number) {
  return x * x * (3 - 2 * x);
}
