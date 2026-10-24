import { useAuthToken } from "@convex-dev/auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { convex } from "../scene/convex.js";
import { useSceneStore } from "../scene/store.js";
import { memoryRequest, type AgentContext } from "./agent.js";
import { type Preference, type TimeBucket } from "./preferences.js";
import { speakReply, startVoice, type VoiceSession } from "./voice.js";

type Props = { disabled: boolean; demoMode: boolean; refresh: number;
  onContext: (context: AgentContext | undefined) => void;
  onCommand: (text: string, context: AgentContext) => Promise<string> };

export function AgentControls(props: Props) {
  if (!convex) return null;
  return <ConnectedAgentControls {...props} />;
}

function ConnectedAgentControls({ disabled, demoMode, refresh, onContext, onCommand }: Props) {
  const token = useAuthToken();
  const [task, setTask] = useState("");
  const [timeBucket, setTimeBucket] = useState<TimeBucket | "auto">("auto");
  const [summary, setSummary] = useState("");
  const [memories, setMemories] = useState<Preference[]>([]);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [voice, setVoice] = useState<"idle" | "starting" | "listening" | "finishing">("idle");
  const [availability, setAvailability] = useState({ configured: false, spokenReplies: false });
  const [spoken, setSpoken] = useState(false);
  const turns = useRef<string[]>([]);
  const capture = useRef<VoiceSession | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  const reply = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const held = useRef(false);
  const locked = disabled || pending || demoMode;
  const context = useCallback((): AgentContext => ({ token: token ?? "", task: (task.trim() || useSceneStore.getState().scene.session?.task || "").slice(0, 80),
    timeBucket, turns: turns.current }), [task, timeBucket, token]);

  useEffect(() => { onContext(token ? context() : undefined); }, [context, token, onContext, refresh]);
  useEffect(() => {
    mounted.current = true;
    fetch("/api/voice").then((response) => response.json()).then((value) => {
      if (mounted.current) setAvailability(value);
    }).catch(() => {});
    const stopReply = useSceneStore.subscribe(() => reply.current?.abort());
    return () => { mounted.current = false; controller.current?.abort(); reply.current?.abort(); stopReply(); };
  }, []);

  const load = useCallback(async () => {
    if (!token || !open || demoMode) return;
    try {
      const result = await memoryRequest({ token, task: "", timeBucket: "auto", turns: [] }, { action: "list" });
      if (mounted.current) setMemories(result.preferences ?? []);
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "Memory is unavailable."); }
  }, [token, open, demoMode]);
  useEffect(() => { void load(); }, [load, refresh]);

  async function remember() {
    if (locked || !token) return;
    setPending(true); setError("");
    try {
      const result = await memoryRequest(context(), { action: "remember", scene: useSceneStore.getState().scene, prompt: summary });
      if (mounted.current) { setNotice([result.message, result.notice].filter(Boolean).join(" ")); await load(); }
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "Save was not confirmed."); }
    finally { if (mounted.current) setPending(false); }
  }
  async function forget(id: string) {
    if (locked || !token) return;
    setPending(true); setError("");
    try {
      const result = await memoryRequest(context(), { action: "forget", id });
      if (mounted.current) { setNotice([result.message, result.notice].filter(Boolean).join(" ")); await load(); }
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "Delete was not confirmed."); }
    finally { if (mounted.current) setPending(false); }
  }

  const begin = useCallback(async () => {
    if (locked || !token || controller.current || !availability.configured) return;
    reply.current?.abort();
    const current = new AbortController(); controller.current = current;
    setError(""); setVoice("starting");
    try {
      const session = await startVoice(token, current.signal, (text) => {
        capture.current = undefined; controller.current = undefined;
        if (!mounted.current) return;
        setVoice("idle"); setNotice(`Heard: “${text}”`);
        const prior = context();
        turns.current = [...turns.current, text.slice(0, 600)].slice(-6);
        void onCommand(text, prior).then(async (message) => {
          if (!mounted.current || !spoken) return;
          const active = new AbortController(); reply.current = active;
          try { await speakReply(token, message, active.signal); }
          catch { if (!active.signal.aborted && mounted.current) setError("Room updated; the spoken reply was unavailable."); }
        }).catch((error) => { if (mounted.current) setError(error instanceof Error ? error.message : "The command failed."); });
      }, (message) => {
        controller.current = undefined; capture.current = undefined;
        if (mounted.current) { setError(message); setVoice("idle"); }
      }, () => { if (mounted.current) setVoice("finishing"); });
      if (controller.current !== current || current.signal.aborted) { session.cancel(); return; }
      capture.current = session;
      if (mounted.current) setVoice("listening");
    } catch (error) {
      if (controller.current !== current) return;
      controller.current = undefined; capture.current = undefined;
      if (mounted.current) {
        setVoice("idle");
        if (!current.signal.aborted) setError(error instanceof Error ? error.message : "Microphone access failed.");
      }
    }
  }, [locked, token, availability.configured, onCommand, context, spoken]);

  const end = useCallback((cancel = false) => {
    if (cancel || !capture.current) {
      controller.current?.abort(); controller.current = undefined; capture.current = undefined;
      if (mounted.current) setVoice("idle");
    } else { capture.current.stop(); setVoice("finishing"); }
  }, []);
  useEffect(() => {
    function down(event: KeyboardEvent) {
      if (event.key === "Escape") { end(true); reply.current?.abort(); return; }
      if (event.code !== "Space" || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.repeat) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault(); held.current = true; void begin();
    }
    function up(event: KeyboardEvent) {
      if (held.current && (event.code === "Space" || event.key === "Control" || event.key === "Shift")) {
        held.current = false; event.preventDefault(); end();
      }
    }
    const blur = () => { held.current = false; end(true); reply.current?.abort(); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, [begin, end]);
  useEffect(() => { if (demoMode) end(true); }, [demoMode, end]);

  return <div className="agent-controls">
    <div className="agent-activation">
      <button type="button" aria-pressed={voice === "listening"} aria-keyshortcuts="Control+Shift+Space"
        disabled={voice === "idle" && (locked || !token || !availability.configured)}
        onClick={() => voice === "idle" ? void begin() : end(voice === "finishing")}>
        {voice === "idle" ? "Talk to agent" : voice === "starting" ? "Cancel microphone" : voice === "listening" ? "Stop & send" : "Cancel transcription"}
      </button>
      <span role={voice === "idle" ? undefined : "status"}>{voice === "listening" ? "Mic listening · release shortcut or click Stop · Esc cancels"
        : voice === "starting" ? "Connecting microphone… wait for Listening before speaking."
        : voice === "finishing" ? "Mic off · finishing transcription…"
        : availability.configured ? "Hold Ctrl+Shift+Space · page focused, outside text fields" : "Voice needs a Cartesia API key. Typed commands still work."}</span>
      {availability.spokenReplies && <label><input type="checkbox" checked={spoken} onChange={(event) => {
        setSpoken(event.target.checked); if (!event.target.checked) reply.current?.abort();
      }} />Spoken replies</label>}
    </div>
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Environment memory</summary>
      <fieldset disabled={locked || !token} onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
      }}>
        <label>Task <input aria-label="Preference task" value={task} maxLength={80} placeholder="coding, reading, writing…"
          onChange={(event) => setTask(event.target.value)} /></label>
        <label>When <select aria-label="Preference time" value={timeBucket} onChange={(event) => setTimeBucket(event.target.value as TimeBucket | "auto")}>
          <option value="auto">Current local time</option><option value="any">Any time</option>
          {["morning", "afternoon", "evening", "night"].map((time) => <option key={time}>{time}</option>)}
        </select></label>
        <input aria-label="Preference notes" value={summary} maxLength={600} placeholder="What do you like about this room? (optional)"
          onChange={(event) => setSummary(event.target.value)} />
        <button type="button" onClick={() => void remember()}>Remember this room</button>
        <button type="button" disabled={!context().task} onClick={() => void onCommand(`Set up my usual ${context().task} environment.`, context()).catch(() => {})}>Use my usual setup</button>
      </fieldset>
      <p>Remembering the same task and time updates that preference. Unrelated edits preserve manual placements.</p>
      {memories.length ? <ul>{memories.map((memory) => <li key={memory._id}>
        <span><strong>{memory.task} · {memory.timeBucket}</strong> — {memory.summary}</span>
        <button type="button" disabled={locked} onClick={() => void forget(memory._id)}>Forget</button>
      </li>)}</ul> : <p>No preferences saved yet.</p>}
      {!token && <p>Connecting to your private saved-rooms session…</p>}
    </details>
    {notice && <p role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
