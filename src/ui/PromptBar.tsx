import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { HeadTrackingControl } from '../sensors/HeadTrackingControl.js';
import { BorderBeam } from 'border-beam';
import { requestScene } from '../ai/client.js';
import { requestAgent, type AgentContext } from '../ai/agent.js';
import { AgentControls } from '../ai/AgentControls.js';
import { convex } from '../scene/convex.js';
import { SavedRooms } from '../scene/SavedRooms.js';
import { useSceneStore } from '../scene/store.js';
import { paintEnvironment, paintSprites } from '../art/client.js';
import { applyManagedPartial, installManagedAssets } from '../ai/managedClient.js';
import { resumeAudio } from '../audio/context.js';

type Status = { tone: 'busy' | 'notice' | 'error'; text: string };
const NOTICE_MS = 8000;
// /?demo replays saved responses and local presets only, with no AI requests (README "Offline demo").
const DEMO_MODE = new URLSearchParams(window.location.search).has('demo');

// Sends the prompt and current scene to the server agent and applies the validated reply. Without AI,
// the client falls back to the local presets and recorded demo, and says so in the status line.
export function PromptBar({ hasScene, onSceneReady }: { hasScene: boolean; onSceneReady: () => void }) {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<Status>();
  const demoMode = DEMO_MODE;
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
    void resumeAudio().catch(error => console.warn('Audio could not be enabled.', error));
    setStatus({ tone: 'busy', text: 'Building your room…' });
    let partialApplied = false;
    try {
      const before = useSceneStore.getState().scene;
      const reply = await requestAgent(prompt, hasScene ? before : null, override ?? agentContext, demoMode, text => setStatus({ tone: 'busy', text }), (result, part) => {
        applyManagedPartial(result, part, !partialApplied);
        partialApplied = true;
        onSceneReady();
      });
      const initialResponse = reply.response;
      if (initialResponse) {
        const store = useSceneStore.getState();
        const response = initialResponse;
        const changed = store.scene !== before;
        const replaced = store.scene.room !== before.room || store.scene.objects.length !== before.objects.length ||
          store.scene.objects.some((object, index) => object.id !== before.objects[index]?.id);
        const movedTarget = response.kind === 'edit' && response.ops.some((op) =>
          (op.op === 'move' || op.op === 'remove') && store.scene.objects.find((object) => object.id === op.id)?.position !==
            before.objects.find((object) => object.id === op.id)?.position);
        if (!partialApplied && changed && (response.kind === 'create' || replaced || movedTarget))
          throw new Error('Your room changed while the agent was working. Please repeat the command for this room.');
      }
      let artNotice: string | undefined;
      if (initialResponse) {
        const response = initialResponse;
        if (!hasScene && response.kind !== 'create') throw new Error('Describe a place to create your first room.');
        if (response.managed && !partialApplied) installManagedAssets(response.managed, response.kind === 'create' ? response.scene : useSceneStore.getState().scene);
        if (response.kind === 'create' && !response.managed && !DEMO_MODE && !response.notice) {
          setStatus({ tone: 'busy', text: 'Imagining the ground and surroundings…' });
          try {
            const { env, painted } = await paintEnvironment(prompt, response.scene);
            const result = useSceneStore.getState().setScene({ ...response.scene, room: { ...response.scene.room, art: env.id, terrain: env.terrain }, objects: [] });
            if (!result.ok) throw new Error(result.error);
            setStatus({ tone: 'busy', text: 'Painting the floor and four surroundings…' });
            try { await painted; } catch { artNotice = 'Some surfaces could not be painted. Showing the available artwork.'; }
            setStatus({ tone: 'busy', text: 'Placing sound sources in the environment…' });
            const placement = await requestScene(`${prompt}\n\nThe environment is already painted. Place physical sound sources that belong in it: ${env.concept}. Use the current terrain to choose positions; branches and birds can grow out of the surrounding walls.`, useSceneStore.getState().scene);
            if (placement.notice) artNotice = `${artNotice ? artNotice + ' ' : ''}Source planning unavailable; using the initial sound plan.`;
            const objects = placement.kind === 'create' && !placement.notice ? placement.scene.objects : response.scene.objects;
            // The environment is visible before sound generation or source portals begin.
            if (placement.kind === 'edit' && !placement.notice) {
              const applied = useSceneStore.getState().applyOps(placement.ops.filter(op => op.op !== 'set_room'));
              if (!applied.ok) throw new Error(applied.error);
              paintSprites(env.id, useSceneStore.getState().scene.objects);
            } else {
              paintSprites(env.id, objects);
              const added = useSceneStore.getState().applyOps(objects.map(object => ({ op: 'add' as const, object })));
              if (!added.ok) throw new Error(added.error);
            }
            setValue('');
            setStatus(artNotice ? { tone: 'notice', text: artNotice } : undefined);
            setRefresh(value => value + 1);
            onSceneReady();
            return 'Room created.';
          } catch (error) {
            console.warn('environment: using the standard room', error);
            artNotice = 'Environment art is unavailable. Using the standard room.';
          }
        }
      }
      // Read the store again: the user may have dragged or muted something while the agent worked.
      const store = useSceneStore.getState();
      const response = reply.response;
      if (response) {
        const result = partialApplied ? { ok: true as const } : response.kind === 'create' ? store.setScene(response.scene)
          : response.ops.length ? store.applyOps(response.ops) : { ok: true as const };
        if (!result.ok) throw new Error(`The room could not apply that change: ${result.error}`);
        if (!response.managed && !DEMO_MODE && !reply.notice && store.scene.room.art) paintSprites(store.scene.room.art, useSceneStore.getState().scene.objects);
      }
      if (response) onSceneReady();
      setValue('');
      const notice = [reply.message, reply.notice, artNotice, reply.recalled?.length ? `Recalled: ${reply.recalled.join(', ')}.` : undefined].filter(Boolean).join(' ');
      setStatus(notice ? { tone: 'notice', text: notice } : undefined);
      setRefresh((value) => value + 1);
      return reply.message ?? 'Room updated.';
    } catch (error) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      working.current = false;
    }
  }, [agentContext, demoMode, hasScene, onSceneReady]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitPrompt(value).catch(() => {});
  };
  return <>
    {status && <p className={`prompt-status prompt-status-${status.tone}`} role={status.tone === 'error' ? 'alert' : 'status'}>{status.text}</p>}
    {/* Hidden until Convex is deployed (#54). */}
    {hasScene && convex && <SavedRooms disabled={busy} onLoad={name => setStatus({ tone: 'notice', text: `Loaded “${name}” from saved rooms.` })}/>}
    {hasScene && <HeadTrackingControl/>}
    {hasScene && <AgentControls disabled={busy} demoMode={demoMode} refresh={refresh} onContext={setAgentContext} onCommand={submitPrompt}/>}
    <BorderBeam size="md" colorVariant="mono" strength={0.7} theme="dark" borderRadius={38} className="prompt-beam">
      <form className="prompt-bar" onSubmit={submit} aria-busy={busy}>
        <input type="text" aria-label="Prompt" placeholder="Generate anything..." value={value} onChange={event => setValue(event.target.value)} autoComplete="off"/>
        <button type="submit" className="prompt-send" aria-label="Send" disabled={busy || !value.trim()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5"/><polyline points="5 12 12 5 19 12"/></svg>
        </button>
      </form>
    </BorderBeam>
  </>;
}
