import { useState, type FormEvent } from "react";
import { requestScene } from "../ai/client.js";
import { useSceneStore } from "../scene/store.js";
import { DemoControls } from "./DemoControls.js";

// TODO(#18): stream objects in as the agent places them

export function PromptBar() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [demoMode, setDemoMode] = useState(false);
  const [notice, setNotice] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const { scene, setScene, applyOps } = useSceneStore.getState();
      const res = await requestScene(prompt, scene, demoMode);
      if (res.kind === "create") setScene(res.scene);
      else applyOps(res.ops);
      setNotice(res.notice);
      setPrompt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="prompt-bar" onSubmit={submit}>
      <DemoControls disabled={busy} demoMode={demoMode} onDemoModeChange={(enabled) => {
        setDemoMode(enabled);
        setError(undefined);
        setNotice(enabled ? "Offline demo uses saved responses and local sounds. No AI requests are sent." : "Live AI enabled.");
      }} onPreset={(scene, label) => {
        useSceneStore.getState().setScene(scene);
        setError(undefined);
        setNotice(`Loaded the ${label} local preset.`);
      }} />
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder='Try "rainy café, I&apos;m writing an essay"'
        disabled={busy}
        list={demoMode ? "demo-prompts" : undefined}
        aria-label="Describe or edit your room"
      />
      <button disabled={busy}>{busy ? "…" : "Go"}</button>
      {error && <p className="error">{error}</p>}
      {notice && <p className="demo-notice" role="status">{notice}</p>}
    </form>
  );
}
