import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BorderBeam } from 'border-beam';
import { requestAgent, type AgentContext } from '../ai/agent.js';
import { AgentControls } from '../ai/AgentControls.js';
import { convex } from '../scene/convex.js';
import { SavedRooms } from '../scene/SavedRooms.js';
import { useSceneStore } from '../scene/store.js';
import { DemoControls } from './DemoControls.js';

type Status = { tone: 'busy' | 'notice' | 'error'; text: string };
const NOTICE_MS = 8000;

// TODO(#18): stream objects in as the agent places them

// Sends the prompt and current scene to POST /api/scene (Gemini) and applies the reply. Without AI,
// the client falls back to the local presets and recorded demo, and says so in the status line.
export function PromptBar() {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<Status>();
  const [demoMode, setDemoMode] = useState(false);
  const [agentContext, setAgentContext] = useState<AgentContext>();
  const [refresh, setRefresh] = useState(0);
  const working = useRef(false);
  const busy = status?.tone === 'busy';
  useEffect(() => {
    if (status?.tone !== 'notice') return;
    const timer = setTimeout(() => setStatus(undefined), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [status]);
  const submitPrompt = useCallback(async (text: string, override?: AgentContext): Promise<string> => {
    const prompt = text.trim();
    if (!prompt || working.current) return 'A command is already running.';
    working.current = true;
    setStatus({ tone: 'busy', text: 'Building your room…' });
    try {
      const before = useSceneStore.getState().scene;
      const reply = await requestAgent(prompt, before, override ?? agentContext, demoMode);
      // Read the store again: the user may have dragged or muted something while the agent worked.
      const store = useSceneStore.getState();
      const response = reply.response;
      if (response) {
        const changed = store.scene !== before;
        const replaced = store.scene.room !== before.room || store.scene.objects.length !== before.objects.length ||
          store.scene.objects.some((object, index) => object.id !== before.objects[index]?.id);
        const movedTarget = response.kind === 'edit' && response.ops.some((op) =>
          (op.op === 'move' || op.op === 'remove') && store.scene.objects.find((object) => object.id === op.id)?.position !==
            before.objects.find((object) => object.id === op.id)?.position);
        if (changed && (response.kind === 'create' || replaced || movedTarget))
          throw new Error('Your room changed while the agent was working. Please repeat the command for this room.');
        const result = response.kind === 'create' ? store.setScene(response.scene)
          : response.ops.length ? store.applyOps(response.ops) : { ok: true as const };
        if (!result.ok) throw new Error(`The room could not apply that change: ${result.error}`);
      }
      setValue('');
      const notice = [reply.message, reply.notice, reply.recalled?.length ? `Recalled: ${reply.recalled.join(', ')}.` : undefined].filter(Boolean).join(' ');
      setStatus(notice ? { tone: 'notice', text: notice } : undefined);
      setRefresh((value) => value + 1);
      return reply.message ?? 'Room updated.';
    } catch (error) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      working.current = false;
    }
  }, [agentContext, demoMode]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitPrompt(value).catch(() => {});
  };
  return <>
    {status && <p className={`prompt-status prompt-status-${status.tone}`} role={status.tone === 'error' ? 'alert' : 'status'}>{status.text}</p>}
    <DemoControls disabled={busy} demoMode={demoMode} onDemoModeChange={enabled => {
      setDemoMode(enabled);
      setStatus({ tone: 'notice', text: enabled ? 'Offline demo uses saved responses and local sounds. No AI requests are sent.' : 'Live AI enabled.' });
    }} onPreset={(scene, label) => {
      const result = useSceneStore.getState().setScene(scene);
      setStatus(result.ok ? { tone: 'notice', text: `Loaded the ${label} local preset.` } : { tone: 'error', text: result.error });
    }}/>
    {/* Hidden until Convex is deployed (#54), so the live room stays uncluttered. */}
    {convex && <SavedRooms disabled={busy} onLoad={name => setStatus({ tone: 'notice', text: `Loaded “${name}” from saved rooms.` })}/>}
    <AgentControls disabled={busy} demoMode={demoMode} refresh={refresh} onContext={setAgentContext} onCommand={submitPrompt}/>
    <BorderBeam size="md" colorVariant="mono" strength={0.7} theme="dark" borderRadius={38} className="prompt-beam">
      <form className="prompt-bar" onSubmit={submit} aria-busy={busy}>
        <input type="text" aria-label="Prompt" placeholder="Generate anything..." value={value} onChange={event => setValue(event.target.value)} autoComplete="off" list={demoMode ? 'demo-prompts' : undefined}/>
        <button type="submit" className="prompt-send" aria-label="Send" disabled={busy || !value.trim()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5"/><polyline points="5 12 12 5 19 12"/></svg>
        </button>
      </form>
    </BorderBeam>
  </>;
}
