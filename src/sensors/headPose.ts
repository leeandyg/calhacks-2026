import { create } from "zustand";

// The listener's head pose from a sensor (webcam today, AirPods later in #24). It is input, not part
// of the room: it never goes into the scene store, so saved rooms don't capture your head angle and
// the room view doesn't re-render 30 times a second. The audio engine adds `yaw` to listener.yaw,
// and the room view's listener head (#72) can read it the same way.

/** searching: the camera is on but no face has been seen yet. lost: the face was seen, then lost. */
export type HeadTrackingStatus = "off" | "starting" | "searching" | "tracking" | "lost" | "error";

type HeadPose = {
  /** Radians turned to the left (positive) from straight ahead; 0 when tracking is off. */
  yaw: number;
  status: HeadTrackingStatus;
  error?: string;
};

export const useHeadPose = create<HeadPose>()(() => ({ yaw: 0, status: "off" }));
