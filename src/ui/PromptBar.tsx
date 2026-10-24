import { useState, type FormEvent } from "react";
import { requestScene } from "../ai/client.js";
import { useSceneStore } from "../scene/store.js";

// TODO(#18): stream objects in as the agent places them

export function PromptBar() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const { scene, setScene, applyOps } = useSceneStore.getState();
      const res = await requestScene(prompt, scene);
      if (res.kind === "create") setScene(res.scene);
      else applyOps(res.ops);
      setPrompt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="prompt-bar" onSubmit={submit}>
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder='Try "rainy café, I&apos;m writing an essay"'
        disabled={busy}
      />
      <button disabled={busy}>{busy ? "…" : "Go"}</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
