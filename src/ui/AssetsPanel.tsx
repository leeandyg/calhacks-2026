import { BorderBeam } from 'border-beam';
import { useSceneStore } from '../scene/store.js';
import { useRoomStore } from '../room/useRoomStore.js';
import { useArtStore, spriteKey } from '../art/store.js';
import type { SoundObject } from '../scene/scene.js';
import { BEAR_VIEWS, bearDirection } from '../room/bearDirections.js';

// The thumbnail box side in px; matches .asset-thumb in styles.css.
const THUMB = 44;
// The sprite PNG is a horizontal strip of `frames` frames (each art.w wide). Show only the first
// frame, scaled to fit the thumbnail box and centered, instead of the whole stretched strip.
function thumbStyle(art: { png: string; w: number; h: number; frames?: number }) {
  const scale = Math.min(THUMB / art.w, THUMB / art.h);
  const frameWidth = art.w * scale;
  return {
    backgroundImage: `url(${art.png})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${frameWidth * (art.frames ?? 1)}px ${art.h * scale}px`,
    backgroundPosition: `${(THUMB - frameWidth) / 2}px center`,
  } as const;
}

// A right-hand list of the scene's sound sources. Each row shows the source's generated sprite and
// label, and controls its volume, whether it is hidden from the environment (reversible) and removal.
function AssetRow({ object, envId }: { object: SoundObject; envId?: string }) {
  const sprite = useArtStore(state => (envId ? state.sprites[spriteKey(envId, object)] : undefined));
  const art = sprite?.status === 'ready' ? sprite : undefined;
  const hidden = useRoomStore(state => state.hiddenObjectIds.includes(object.id));
  const setVolume = (volume: number) => useSceneStore.getState().applyOps([{ op: 'set_volume', id: object.id, volume }]);
  // Hiding removes the source from the environment: its prop/portal stop rendering (view-only state)
  // and it goes silent through the scene store. Showing restores both. Delete drops it entirely.
  const toggleHidden = () => {
    const next = !hidden;
    useRoomStore.getState().setHidden(object.id, next);
    useSceneStore.getState().applyOps([{ op: 'set_muted', id: object.id, muted: next }]);
  };
  const remove = () => { useRoomStore.getState().setHidden(object.id, false); useSceneStore.getState().applyOps([{ op: 'remove', id: object.id }]); };
  return <li className="asset-row" data-hidden={hidden || undefined}>
    <div className="asset-thumb" style={art ? thumbStyle(art) : undefined}>
      {art ? null : <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>}
    </div>
    <div className="asset-body">
      <span className="asset-label" title={object.label}>{object.label}</span>
      <input className="asset-volume" type="range" min={0} max={1} step={0.01} value={object.volume}
        aria-label={`${object.label} volume`} onChange={event => setVolume(Number(event.target.value))}/>
    </div>
    <div className="asset-actions">
      <button type="button" className="asset-action" aria-pressed={hidden} title={hidden ? 'Show in environment' : 'Hide from environment'} aria-label={hidden ? `Show ${object.label} in the environment` : `Hide ${object.label} from the environment`} onClick={toggleHidden}>
        {hidden
          ? <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          : <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
      </button>
      <button type="button" className="asset-action asset-delete" title="Delete" aria-label={`Delete ${object.label}`} onClick={remove}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      </button>
    </div>
  </li>;
}

export function AssetsPanel() {
  const objects = useSceneStore(state => state.scene.objects);
  const envId = useSceneStore(state => state.scene.room.art);
  const direction = useRoomStore(state => bearDirection(state.viewAngle));
  return <div className="assets-dock">
    <BorderBeam size="md" colorVariant="mono" strength={0.7} theme="dark" borderRadius={24} className="assets-beam">
      <section className="assets-panel" aria-label="Assets">
        <h2 className="assets-title">Assets</h2>
        <ul className="assets-list">
          <li className="asset-row" data-avatar="user">
            <div className="asset-thumb"><img src={BEAR_VIEWS[direction].image} alt="Berkeley bear wearing silver headphones" style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' }}/></div>
            <div className="asset-body"><span className="asset-label">You</span><span className="asset-user-note">Berkeley bear</span></div>
          </li>
          {objects.map(object => <AssetRow key={object.id} object={object} envId={envId}/>)}
        </ul>
      </section>
    </BorderBeam>
  </div>;
}
