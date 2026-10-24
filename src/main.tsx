import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import App from "./App.js";
import { convex } from "./scene/convex.js";
import { useSceneStore } from "./scene/store.js";
import "./styles.css";

// Dev only: poke the store from the browser console, e.g.
//   sceneStore.getState().applyOps([{ op: "set_volume", id: "rain-1", volume: 0.8 }])
if (import.meta.env.DEV) Object.assign(window, { sceneStore: useSceneStore });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {convex ? <ConvexAuthProvider client={convex}><App /></ConvexAuthProvider> : <App />}
  </StrictMode>,
);
