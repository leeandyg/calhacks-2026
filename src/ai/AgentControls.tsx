import { useAuthToken } from "@convex-dev/auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { convex } from "../scene/convex.js";
import { useSceneStore } from "../scene/store.js";
import { memoryRequest, type AgentContext, type CommandOptions } from "./agent.js";
import { type MemoryInfo, type Preference, type TimeBucket } from "./preferences.js";
import type { LearnedPreference } from './learnPreference.js';
import { playReadyCue, prepareVoice, speakReply, startVoice, type VoiceSession } from "./voice.js";
import { duckSoundscape } from '../audio/ducking.js';
import { FloatingVoice, useFloatingVoice } from './FloatingVoice.js';
import { wakeCommand } from './wakePhrase.js';

type Props = { disabled: boolean; demoMode: boolean; refresh: number; learnedPreference?: LearnedPreference;
  onContext: (context: AgentContext | undefined) => void;
  onCommand: (text: string, context: AgentContext, options?: CommandOptions) => Promise<string> };

export function AgentControls(props: Props) {
  if (!convex) return null;
  return <ConnectedAgentControls {...props} />;
}

function ConnectedAgentControls({ disabled, demoMode, refresh, learnedPreference, onContext, onCommand }: Props) {
  const token = useAuthToken() ?? undefined;
  return <VoiceAgentControls {...{ disabled, demoMode, refresh, learnedPreference, onContext, onCommand, token }}/>;
}

export function VoiceAgentControls({ disabled, demoMode, refresh, learnedPreference, onContext, onCommand, token }: Props & { token?: string }) {
  const [task, setTask] = useState("");
  const [timeBucket, setTimeBucket] = useState<TimeBucket | "auto">("any");
  const [memoryInfo, setMemoryInfo] = useState<MemoryInfo>();
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
  const [wake, setWake] = useState(false);
  const wakeEnabled = useRef(false);
  const [armed, setArmed] = useState(false);
  const wakeArmed = useRef(false);
  const activeWake = useRef(false);
  const wakeDuck = useRef<(() => void) | undefined>(undefined);
  const locked = disabled || pending || demoMode;
  const context = useCallback((): AgentContext => ({ token: token ?? "", task: (task.trim() || useSceneStore.getState().scene.session?.task || "").slice(0, 80),
    timeBucket, turns: turns.current }), [task, timeBucket, token]);
  useEffect(() => {
    if (!learnedPreference) return;
    setTask(learnedPreference.task); setTimeBucket(learnedPreference.timeBucket); setSummary(learnedPreference.summary);
    setNotice(learnedPreference.notice); setMemoryInfo(learnedPreference.memory);
  }, [learnedPreference]);

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
    return () => { mounted.current = false; controller.current?.abort(); reply.current?.abort(); wakeDuck.current?.(); stopReply(); };
  }, []);

  const load = useCallback(async () => {
    if (!token || !open || demoMode) return;
    try {
      const result = await memoryRequest({ token, task: "", timeBucket: "auto", turns: [] }, { action: "list" });
      if (mounted.current) { setMemories(result.preferences ?? []); setMemoryInfo(previous => previous && result.memory?.status === 'configured' ? previous : result.memory); }
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "Memory is unavailable."); }
  }, [token, open, demoMode]);
  useEffect(() => { void load(); }, [load, refresh]);

  async function remember() {
    if (locked || !token) return;
    setPending(true); setError("");
    try {
      const result = await memoryRequest(context(), { action: "remember", scene: useSceneStore.getState().scene, prompt: summary });
      if (mounted.current) {
        setNotice([result.message, result.notice].filter(Boolean).join(" ")); setMemoryInfo(result.memory);
        if (result.remembered) { setTask(result.remembered.task); setTimeBucket(result.remembered.timeBucket); }
        await load();
      }
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

  const executeLatest = useRef(execute); executeLatest.current = execute;
  const begin = useCallback(async (auto = false, fromWake = false) => {
    if (locked || !token || controller.current || !availability.configured) return;
    reply.current?.abort();
    const current = new AbortController(); controller.current = current;
    activeAutomatic.current = auto; finalHeard.current = "";
    activeWake.current = fromWake;
    if (!fromWake) { setError(""); setNotice(""); setHeard(""); }
    setEditing(false); setVoice("starting");
    let submitted = false;
    let detected = false;
    let releaseThisWake: (() => void) | undefined;
    const detectedWake = () => {
      if (detected) return;
      detected = true; setError(''); setNotice('');
      releaseThisWake = duckSoundscape(); wakeDuck.current = releaseThisWake;
      try { playReadyCue(); } catch { /* Text feedback remains available. */ }
    };
    const releaseWake = () => {
      releaseThisWake?.();
      if (wakeDuck.current === releaseThisWake) wakeDuck.current = undefined;
      releaseThisWake = undefined;
    };
    try {
      const session = await startVoice(token, current.signal, (text) => {
        submitted = true;
        releaseWake();
        if (controller.current !== current || current.signal.aborted) return;
        if (fromWake) {
          if (!wakeEnabled.current) return;
          const command = wakeCommand(text);
          if (!wakeArmed.current && command === undefined) {
            controller.current = undefined; capture.current = undefined; setVoice('idle'); return;
          }
          if (command !== undefined) detectedWake();
          text = command ?? text;
          if (!text.trim()) {
            releaseWake(); wakeArmed.current = true; setArmed(true);
            controller.current = undefined; capture.current = undefined; setVoice('idle'); return;
          }
          releaseWake(); wakeArmed.current = false; setArmed(false);
        }
        finalHeard.current = text;
        void executeLatest.current(text, current);
      }, (message) => {
        releaseWake();
        if (controller.current !== current) return;
        controller.current = undefined; capture.current = undefined;
        const quiet = fromWake && message.startsWith('No speech was detected');
        if (fromWake) {
          wakeArmed.current = false; setArmed(false);
          if (!quiet) { wakeEnabled.current = false; setWake(false); }
        }
        if (mounted.current) { if (!quiet) setError(message); setVoice("idle"); }
      }, () => { if (mounted.current && controller.current === current) setVoice("finishing"); }, {
        automatic: auto, duck: !fromWake || wakeArmed.current,
        acceptTurn: fromWake ? (text) => {
          if (!wakeEnabled.current || current.signal.aborted || controller.current !== current) return false;
          const command = wakeCommand(text);
          if (!wakeArmed.current && command === undefined) {
            releaseWake(); if (detected) setHeard(''); detected = false; return false;
          }
          if (command !== undefined) detectedWake();
          if (!(command ?? text).trim()) {
            wakeArmed.current = true; setArmed(true); setHeard('');
            return false;
          }
          return true;
        } : undefined,
        onPartial: (text) => {
          if (!mounted.current || controller.current !== current) return;
          if (!fromWake) { setHeard(text); return; }
          const command = wakeCommand(text);
          if (command !== undefined) detectedWake();
          if (wakeArmed.current || command !== undefined) setHeard(command ?? text);
        },
      });
      if (submitted) return;
      if (controller.current !== current || current.signal.aborted) { session.cancel(); return; }
      capture.current = session;
      if (mounted.current) {
        setVoice("listening");
        if (!fromWake) try { playReadyCue(); } catch { /* Ready text still works. */ }
      }
    } catch (error) {
      releaseWake();
      if (controller.current !== current) return;
      controller.current = undefined; capture.current = undefined;
      if (mounted.current) {
        if (fromWake) { wakeEnabled.current = false; setWake(false); wakeArmed.current = false; setArmed(false); }
        setVoice("idle");
        if (!current.signal.aborted) setError(error instanceof Error ? error.message : "Microphone access failed.");
      }
    }
  }, [locked, token, availability.configured]);

  const end = useCallback((cancel = false) => {
    wakeDuck.current?.(); wakeDuck.current = undefined;
    if (cancel || !capture.current) {
      controller.current?.abort(); controller.current = undefined; capture.current = undefined;
      if (mounted.current) setVoice("idle");
    } else { capture.current.stop(); setVoice("finishing"); }
  }, []);
  const stopVoice = useCallback(() => {
    wakeEnabled.current = false; setWake(false); wakeArmed.current = false; setArmed(false);
    held.current = false; end(true); reply.current?.abort();
  }, [end]);
  const { floating, open: openFloating } = useFloatingVoice(stopVoice);
  const toggleWake = (enabled: boolean) => {
    stopVoice();
    if (enabled) { wakeEnabled.current = true; setWake(true); }
  };
  useEffect(() => {
    if (!wake || locked || !token || !availability.configured || controller.current || (voice !== 'idle' && voice !== 'done')) return;
    const timer = setTimeout(() => { if (wakeEnabled.current) void begin(true, true); }, wakeArmed.current ? 0 : 250);
    return () => clearTimeout(timer);
  }, [wake, locked, token, availability.configured, voice, begin]);
  useEffect(() => {
    function down(event: KeyboardEvent) {
      if (event.key === "Escape") { stopVoice(); return; }
      if (event.code !== "Space" || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.nodeType === 1 && target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (locked || !token || controller.current || !availability.configured) return;
      event.preventDefault(); held.current = true; void begin(false);
    }
    function up(event: KeyboardEvent) {
      if (held.current && (event.code === "Space" || event.key === "Control" || event.key === "Shift")) {
        held.current = false; event.preventDefault(); end();
      }
    }
    const blur = () => { if (held.current) { held.current = false; end(true); } };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    floating?.addEventListener('keydown', down); floating?.addEventListener('keyup', up); floating?.addEventListener('blur', blur);
    return () => {
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur);
      floating?.removeEventListener('keydown', down); floating?.removeEventListener('keyup', up); floating?.removeEventListener('blur', blur);
    };
  }, [begin, end, stopVoice, locked, token, availability.configured, floating]);
  useEffect(() => { if (demoMode || !token) stopVoice(); }, [demoMode, token, stopVoice]);

  const capturing = voice === "starting" || voice === "listening" || voice === "finishing";
  const processing = voice === "understanding" || voice === "updating";
  const idle = voice === "idle" || voice === "done";
  const warm = () => { if (token && availability.configured && !demoMode) void prepareVoice(token).catch(() => {}); };
  function activate() {
    if (wakeEnabled.current && activeWake.current) { stopVoice(); return; }
    if (idle) void begin(automatic);
    else if (voice === "speaking") { reply.current?.abort(); setVoice("idle"); }
    else end(processing || voice !== "listening");
  }

  const voiceLabel = wake && activeWake.current && (capturing || idle) ? 'Stop listening' : idle ? 'Talk to agent' : voice === 'starting' ? 'Cancel microphone' : voice === 'listening' ? 'Stop & send' : voice === 'speaking' ? 'Stop reply' : 'Cancel command';
  const voiceStatus = voice === 'listening' && wake && activeWake.current ? (armed ? 'Listening for your command…' : 'Mic on · say “Hey agent” and your command')
    : voice === 'listening' ? (activeAutomatic.current ? 'Listening · finishes when your sentence ends · Esc cancels' : 'Listening · release shortcut or click Stop · Esc cancels')
    : voice === 'starting' ? 'Preparing microphone…' : voice === 'finishing' ? 'Mic off · finishing transcription…'
    : voice === 'understanding' ? 'Understanding your command…' : voice === 'updating' ? 'Updating your room…'
    : voice === 'speaking' ? 'Speaking · start a new turn to interrupt' : voice === 'done' ? 'Done · microphone off'
    : availability.configured ? 'Hold Ctrl+Shift+Space · page focused, outside text fields' : 'Voice needs a Cartesia API key. Typed commands still work.';
  const wakeToggle = <label><input type="checkbox" checked={wake} disabled={!wake && (locked || !token || !availability.configured)} onChange={event => toggleWake(event.target.checked)}/>Hey agent</label>;

  return <div className="agent-controls">
    <div className="agent-activation">
      <button type="button" aria-pressed={voice === "listening"} aria-keyshortcuts="Control+Shift+Space"
        disabled={idle && (locked || !token || !availability.configured)} onPointerEnter={warm} onFocus={warm}
        onClick={activate}>
        {voiceLabel}
      </button>
      <span role={idle ? undefined : "status"}>{voiceStatus}</span>
      <label><input type="checkbox" checked={automatic} disabled={!idle} onChange={(event) => setAutomatic(event.target.checked)} />Finish automatically</label>
      {availability.spokenReplies && <label><input type="checkbox" checked={spoken} onChange={(event) => {
        spokenRef.current = event.target.checked; setSpoken(event.target.checked); if (!event.target.checked) reply.current?.abort();
      }} />Spoken replies</label>}
      {wakeToggle}
      <button type="button" onClick={() => { void openFloating().catch(error => setError(error instanceof Error ? error.message : 'The floating window could not open.')); }}>Float controls</button>
    </div>
    {wake && <p>Microphone stays on for “Hey agent”. Audio is transcribed by Cartesia while enabled. Turn it off to stop listening.</p>}
    {floating && <FloatingVoice window={floating}>
      <button type="button" disabled={idle && (locked || !token || !availability.configured)} onClick={() => {
        if (idle) void begin(true); else activate();
      }}>{voiceLabel}</button>
      <button type="button" onClick={stopVoice}>Stop voice</button>
      <p role="status">{voiceStatus}</p>
      {wakeToggle}
      <p>{wake ? 'Mic stays on. Cartesia transcribes audio to detect the phrase.' : 'Mic is off between commands.'}</p>
      {heard && <p className="voice-transcript">Heard: {heard}</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </FloatingVoice>}
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
      <p>{!memoryInfo ? 'Checking memory connection…' : memoryInfo.status === 'configured' ? 'Moss configured · saving verifies memory sync' : memoryInfo.provider === 'moss' ? 'Moss semantic memory · preferences stored in Convex' : 'Convex memory · Moss is unavailable or not configured'}</p>
      <fieldset disabled={locked || !token} onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
      }}>
        <label>Task <input aria-label="Preference task" list="memory-task-options" value={task} maxLength={80} placeholder="coding, reading, writing…"
          onChange={(event) => setTask(event.target.value)} /></label>
        <datalist id="memory-task-options">{['coding', 'reading', 'studying', 'writing', 'sleeping', 'meditating'].map(value => <option key={value} value={value}/>)}</datalist>
        <label>When <select aria-label="Preference time" value={timeBucket} onChange={(event) => setTimeBucket(event.target.value as TimeBucket | "auto")}>
          <option value="auto">Current local time</option><option value="any">Any time</option>
          {["morning", "afternoon", "evening", "night"].map((time) => <option key={time}>{time}</option>)}
        </select></label>
        <input aria-label="Preference notes" value={summary} maxLength={600} placeholder="What do you like about this room? (optional)"
          onChange={(event) => setSummary(event.target.value)} />
        <button type="button" disabled={!context().task} onClick={() => void remember()}>{pending ? 'Saving memory…' : 'Remember this room'}</button>
        <button type="button" disabled={!context().task} onClick={() => void onCommand(`Set up my usual ${context().task} environment.`, context()).catch(() => {})}>Use my usual setup</button>
      </fieldset>
      <p>Choose a task and time, then remember the current room. “I’m going to code, bring me to the river” saves that association after the room is ready.</p>
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
