import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import { useSceneStore } from './scene/store.js';
import './styles.css';

// Dev only: poke the store from the browser console, e.g.
//   sceneStore.getState().applyOps([{ op: "set_volume", id: "rain-1", volume: 0.8 }])
if (import.meta.env.DEV) Object.assign(window, { sceneStore: useSceneStore });

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
