import { useAuthToken } from "@convex-dev/auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { convex } from "../scene/convex.js";
import { useSceneStore } from "../scene/store.js";
import { memoryRequest, type AgentContext, type CommandOptions } from "./agent.js";
import { type Preference, type TimeBucket } from "./preferences.js";
import { playReadyCue, prepareVoice, speakReply, startVoice, type VoiceSession } from "./voice.js";

type Props = { disabled: boolean; demoMode: boolean; refresh: number;
  onContext: (context: AgentContext | undefined) => void;
  onCommand: (text: string, context: AgentContext, options?: CommandOptions) => Promise<string> };

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
  const [voice, setVoice] = useState<"idle" | "starting" | "listening" | "finishing" | "understanding" | "updating" | "speaking" | "done">("idle");
  const [automatic, setAutomatic] = useState(false);
  const [heard, setHeard] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const finalHeard = useRef("");
  const activeAutomatic = useRef(false);
  const [availability, setAvailability] = useState({ configured: false, spokenReplies: false });
  const [spoken, setSpoken] = useState(false);
  const spokenRef = useRef(false);
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
    if (token && availability.configured && !demoMode) void prepareVoice(token).catch(() => {});
  }, [token, availability.configured, demoMode]);
  useEffect(() => {
    if (voice !== "done") return;
    const timer = setTimeout(() => setVoice("idle"), 2500);
    return () => clearTimeout(timer);
  }, [voice]);
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

  const execute = useCallback(async (text: string, current: AbortController, correction?: string) => {
    if (!mounted.current || current.signal.aborted) return;
    capture.current = undefined;
    setHeard(text); setEditing(false); setNotice(""); setVoice("understanding");
    const prior = context();
    turns.current = [...turns.current, text.slice(0, 600)].slice(-6);
    try {
      const message = await onCommand(text, prior, { signal: current.signal, correction,
        onProgress: (phase, message) => { if (mounted.current && controller.current === current) { setVoice(phase); setNotice(message ?? ""); } } });
      if (!mounted.current || current.signal.aborted || controller.current !== current) return;
      controller.current = undefined; finalHeard.current = text;
      setNotice(message);
      if (!spokenRef.current || !token) { setVoice("done"); return; }
      const active = new AbortController(); reply.current = active; setVoice("speaking");
      try { await speakReply(token, message, active.signal); }
      catch { if (!active.signal.aborted && mounted.current) setError("Room updated; the spoken reply was unavailable."); }
      finally {
        if (reply.current === active) {
          reply.current = undefined;
          if (mounted.current && !controller.current) setVoice(active.signal.aborted ? "idle" : "done");
        }
      }
    } catch (error) {
      if (mounted.current && controller.current === current) {
        if (!current.signal.aborted) setError(error instanceof Error ? error.message : "The command failed.");
        setVoice("idle");
      }
    } finally { if (controller.current === current) controller.current = undefined; }
  }, [context, onCommand, token]);

  const begin = useCallback(async (auto = false) => {
    if (locked || !token || controller.current || !availability.configured) return;
    reply.current?.abort();
    const current = new AbortController(); controller.current = current;
    activeAutomatic.current = auto; finalHeard.current = "";
    setError(""); setNotice(""); setHeard(""); setEditing(false); setVoice("starting");
    let submitted = false;
    try {
      const session = await startVoice(token, current.signal, (text) => {
        submitted = true;
        finalHeard.current = text;
        void execute(text, current);
      }, (message) => {
        controller.current = undefined; capture.current = undefined;
        if (mounted.current) { setError(message); setVoice("idle"); }
      }, () => { if (mounted.current && controller.current === current) setVoice("finishing"); }, {
        automatic: auto, onPartial: (text) => { if (mounted.current && controller.current === current) setHeard(text); },
      });
      if (submitted) return;
      if (controller.current !== current || current.signal.aborted) { session.cancel(); return; }
      capture.current = session;
      if (mounted.current) { setVoice("listening"); try { playReadyCue(); } catch { /* Ready text still works. */ } }
    } catch (error) {
      if (controller.current !== current) return;
      controller.current = undefined; capture.current = undefined;
      if (mounted.current) {
        setVoice("idle");
        if (!current.signal.aborted) setError(error instanceof Error ? error.message : "Microphone access failed.");
      }
    }
  }, [locked, token, availability.configured, execute]);

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
      if (locked || !token || controller.current || !availability.configured) return;
      event.preventDefault(); held.current = true; void begin(false);
    }
    function up(event: KeyboardEvent) {
      if (held.current && (event.code === "Space" || event.key === "Control" || event.key === "Shift")) {
        held.current = false; event.preventDefault(); end();
      }
    }
    const blur = () => { held.current = false; end(true); reply.current?.abort(); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, [begin, end, locked, token, availability.configured]);
  useEffect(() => { if (demoMode) end(true); }, [demoMode, end]);

  const capturing = voice === "starting" || voice === "listening" || voice === "finishing";
  const processing = voice === "understanding" || voice === "updating";
  const idle = voice === "idle" || voice === "done";
  const warm = () => { if (token && availability.configured && !demoMode) void prepareVoice(token).catch(() => {}); };
  function activate() {
    if (idle) void begin(automatic);
    else if (voice === "speaking") { reply.current?.abort(); setVoice("idle"); }
    else end(processing || voice !== "listening");
  }

  return <div className="agent-controls">
    <div className="agent-activation">
      <button type="button" aria-pressed={voice === "listening"} aria-keyshortcuts="Control+Shift+Space"
        disabled={idle && (locked || !token || !availability.configured)} onPointerEnter={warm} onFocus={warm}
        onClick={activate}>
        {idle ? "Talk to agent" : voice === "starting" ? "Cancel microphone" : voice === "listening" ? "Stop & send" : voice === "speaking" ? "Stop reply" : "Cancel command"}
      </button>
      <span role={idle ? undefined : "status"}>{voice === "listening" ? (activeAutomatic.current ? "Listening · finishes when your sentence ends · Esc cancels" : "Listening · release shortcut or click Stop · Esc cancels")
        : voice === "starting" ? "Preparing microphone…"
        : voice === "finishing" ? "Mic off · finishing transcription…"
        : voice === "understanding" ? "Understanding your command…"
        : voice === "updating" ? "Updating your room…"
        : voice === "speaking" ? "Speaking · start a new turn to interrupt"
        : voice === "done" ? "Done · microphone off"
        : availability.configured ? "Hold Ctrl+Shift+Space · page focused, outside text fields" : "Voice needs a Cartesia API key. Typed commands still work."}</span>
      <label><input type="checkbox" checked={automatic} disabled={!idle} onChange={(event) => setAutomatic(event.target.checked)} />Finish automatically</label>
      {availability.spokenReplies && <label><input type="checkbox" checked={spoken} onChange={(event) => {
        spokenRef.current = event.target.checked; setSpoken(event.target.checked); if (!event.target.checked) reply.current?.abort();
      }} />Spoken replies</label>}
    </div>
    {heard && <div className="voice-transcript">
      {editing ? <form onSubmit={(event) => {
        event.preventDefault(); if (!draft.trim() || locked || !token) return;
        setError(""); const current = new AbortController(); controller.current = current;
        void execute(draft.trim(), current, finalHeard.current || undefined);
      }}>
        <input aria-label="Corrected voice command" value={draft} maxLength={600} onChange={(event) => setDraft(event.target.value)} />
        <button type="submit" disabled={locked || !draft.trim()}>Apply correction</button>
        <button type="button" onClick={() => setEditing(false)}>Cancel edit</button>
      </form> : <p><span aria-live={capturing ? "polite" : "off"}>Heard: {heard}</span>{!capturing && !processing && <button type="button" disabled={locked} onClick={() => {
        reply.current?.abort(); setDraft(heard); setEditing(true);
      }}>Edit transcript</button>}</p>}
    </div>}
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
