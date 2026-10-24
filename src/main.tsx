import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { useSceneStore } from "./scene/store.js";
import "./styles.css";

// Dev only: poke the store from the browser console, e.g.
//   sceneStore.getState().applyOps([{ op: "move", id: "rain-1", position: [3, 1.5, 0] }])
if (import.meta.env.DEV) Object.assign(window, { sceneStore: useSceneStore });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
