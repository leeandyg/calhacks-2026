import { demoPrompts } from "../ai/offline.js";
import { presets } from "../scene/presets.js";
import type { Scene } from "../scene/scene.js";
import { HeadTrackingControl } from "../sensors/HeadTrackingControl.js";

export function DemoControls({ disabled, demoMode, onDemoModeChange, onPreset }: {
  disabled: boolean;
  demoMode: boolean;
  onDemoModeChange: (enabled: boolean) => void;
  onPreset: (scene: Scene, label: string) => void;
}) {
  return (
    <fieldset className="demo-controls" disabled={disabled}>
      <label>
        Local preset
        <select defaultValue="" onChange={(event) => {
          const preset = presets.find((entry) => entry.id === event.target.value);
          if (preset) onPreset(structuredClone(preset.scene), preset.label);
          event.currentTarget.value = "";
        }}>
          <option value="" disabled>Choose a room…</option>
          {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
        </select>
      </label>
      <label>
        <input type="checkbox" checked={demoMode} onChange={(event) => onDemoModeChange(event.target.checked)} />
        Offline demo
      </label>
      <HeadTrackingControl />
      <datalist id="demo-prompts">
        {demoPrompts.map((prompt) => <option key={prompt} value={prompt} />)}
      </datalist>
      {demoMode && <details>
        <summary>Recorded demo prompts</summary>
        <ol>{demoPrompts.map((prompt) => <li key={prompt}>{prompt}</li>)}</ol>
      </details>}
    </fieldset>
  );
}
