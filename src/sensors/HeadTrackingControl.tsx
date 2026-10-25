import { useHeadPose } from "./headPose.js";
import { useEffect } from "react";
import { prefetchHeadTracking, recenterHeadTracking, startHeadTracking, stopHeadTracking } from "./webcamHeadTracking.js";

// Head tracking toggle, recenter and status. Self-contained, so it can sit in any controls row.
export function HeadTrackingControl() {
  useEffect(prefetchHeadTracking, []);
  const status = useHeadPose((s) => s.status);
  const error = useHeadPose((s) => s.error);
  // Re-render on 5° steps only; the audio reads the exact yaw from the store.
  const degrees = useHeadPose((s) => Math.round((s.yaw * 180) / Math.PI / 5) * 5);
  const on = status !== "off" && status !== "error";
  const text = status === "starting" ? "Starting head tracking…"
    : status === "searching" ? "Looking for your face…"
    : status === "lost" ? "Face lost, holding"
    : status === "tracking" ? (degrees === 0 ? "Facing forward" : `${Math.abs(degrees)}° ${degrees > 0 ? "left" : "right"}`)
    : status === "error" ? error : undefined;
  return (
    <div className="head-tracking">
      <label className="switch-row">
        <span className="switch">
          <input type="checkbox" checked={on} onChange={(event) => (event.target.checked ? startHeadTracking() : stopHeadTracking())} />
          <span className="switch-track"><span className="switch-knob" /></span>
        </span>
        <span className="switch-label">Head tracking</span>
      </label>
      {on && <button type="button" className="head-recenter" onClick={recenterHeadTracking} disabled={status !== "tracking" && status !== "lost"}>Recenter</button>}
      {text && <span className="head-status" role={status === "error" ? "alert" : "status"}>{text}</span>}
    </div>
  );
}
