import { useEffect, useState, type FormEvent } from 'react';
import { BorderBeam } from 'border-beam';
import { requestScene } from '../ai/client.js';
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
  const busy = status?.tone === 'busy';
  useEffect(() => {
    if (status?.tone !== 'notice') return;
    const timer = setTimeout(() => setStatus(undefined), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [status]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = value.trim();
    if (!prompt || busy) return;
    setStatus({ tone: 'busy', text: 'Building your room…' });
    try {
      const response = await requestScene(prompt, useSceneStore.getState().scene, demoMode);
      // Read the store again: the user may have dragged or muted something while the agent worked.
      const store = useSceneStore.getState();
      const result = response.kind === 'create' ? store.setScene(response.scene)
        : response.ops.length ? store.applyOps(response.ops) : { ok: true as const };
      if (!result.ok) throw new Error(`The room could not apply that change: ${result.error}`);
      setValue('');
      setStatus(response.notice ? { tone: 'notice', text: response.notice } : undefined);
    } catch (error) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    }
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
