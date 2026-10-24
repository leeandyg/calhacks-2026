import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { useHeadPose } from "./headPose.js";
import { HeadYawTracker, yawFromMatrix } from "./headYaw.js";

// Webcam head tracking (#21): MediaPipe Face Landmarker runs in the browser on each new video frame,
// and the face's yaw turns the listener. Camera frames never leave the browser.
// The model and its wasm load only when tracking is switched on. Versions match drei's copy.
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let session: { stop: () => void; recenter: () => void } | undefined;
let prefetched = false;

/**
 * Downloads the wasm (~10 MB) and the face model (~3.6 MB) in the background at idle priority, so
 * switching tracking on takes about a second instead of ~10 s. Once per page; MediaPipe's own fetches
 * then come from the browser cache.
 */
export function prefetchHeadTracking() {
  if (prefetched) return;
  prefetched = true;
  for (const href of [`${WASM_URL}/vision_wasm_internal.wasm`, MODEL_URL]) {
    const link = Object.assign(document.createElement("link"), { rel: "prefetch", href, crossOrigin: "anonymous" });
    document.head.append(link);
  }
}

export function startHeadTracking() {
  if (session) return;
  let stopped = false;
  let stream: MediaStream | undefined;
  let landmarker: FaceLandmarker | undefined;
  let frame: number | undefined;
  const video = document.createElement("video");
  const tracker = new HeadYawTracker();
  const set = useHeadPose.setState;

  const stop = () => {
    stopped = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    stream?.getTracks().forEach((track) => track.stop());
    landmarker?.close();
    landmarker = undefined;
    video.srcObject = null;
    if (session === mine) session = undefined; // a quick off-and-on may already have a new session
  };
  const mine = {
    stop: () => {
      stop();
      set({ yaw: 0, status: "off", error: undefined });
    },
    recenter: () => tracker.recenter(performance.now() / 1000),
  };
  session = mine;
  set({ status: "starting", error: undefined });

  void (async () => {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    if (stopped) return stop();
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    const create = (delegate: "GPU" | "CPU") => FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
    });
    landmarker = await create("GPU").catch(() => create("CPU"));
    if (stopped) return stop();
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    if (stopped) return stop();

    let lastVideoTime = -1;
    const tick = () => {
      if (stopped || !landmarker) return;
      frame = requestAnimationFrame(tick);
      if (video.currentTime === lastVideoTime) return; // no new camera frame yet
      lastVideoTime = video.currentTime;
      const now = performance.now();
      const matrix = landmarker.detectForVideo(video, now).facialTransformationMatrixes?.[0];
      const t = now / 1000;
      const yaw = tracker.update(matrix ? yawFromMatrix(matrix.data) : null, t);
      const status = !tracker.seen ? "searching" : tracker.lost(t) ? "lost" : "tracking";
      const current = useHeadPose.getState();
      if (current.yaw !== yaw || current.status !== status) set({ yaw, status });
    };
    tick();
  })().catch((error: unknown) => {
    if (stopped) return;
    stop();
    set({ yaw: 0, status: "error", error: cameraError(error) });
  });
}

export function stopHeadTracking() {
  session?.stop();
}

/** Makes the direction you face now straight ahead. */
export function recenterHeadTracking() {
  session?.recenter();
}

function cameraError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") return "Camera permission was denied.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found.";
  if (name === "NotReadableError") return "The camera is in use by another app.";
  return "Head tracking couldn't start. Check your connection and try again.";
}
