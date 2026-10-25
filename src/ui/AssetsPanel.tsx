import { useEffect, useState } from 'react';
import { BorderBeam } from 'border-beam';
import { PixelIcon } from './PixelIcon.js';
import { useSceneStore } from '../scene/store.js';
import { useRoomStore } from '../room/useRoomStore.js';
import { useArtStore, spriteKey } from '../art/store.js';
import { loadPaintImage } from '../art/images.js';
import type { SoundObject } from '../scene/scene.js';
import { BEAR_VIEWS, bearDirection } from '../room/bearDirections.js';

// The thumbnail box side in px; matches .asset-thumb in styles.css.
const THUMB = 44;
// The sprite PNG is a horizontal strip of frames (each art.w wide). Show only the first frame,
// scaled to fit the thumbnail box and centered. It is copied off-screen from the room's shared
// decoded image (src/art/images.ts), so a thumbnail never downloads the PNG a second time.
function useFirstFrame(art?: { png: string; w: number; h: number }) {
  const [thumb, setThumb] = useState<string>();
  useEffect(() => {
    setThumb(undefined);
    if (!art) return;
    let live = true;
    loadPaintImage(art.png).then(image => {
      const size = THUMB * 2, scale = Math.min(size / art.w, size / art.h);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, art.w, art.h, (size - art.w * scale) / 2, (size - art.h * scale) / 2, art.w * scale, art.h * scale);
      let url = art.png; // a non-CORS image can't be copied; show the original strip instead
      try { url = canvas.toDataURL(); } catch { /* keep the original URL */ }
      if (live) setThumb(url);
    }).catch(() => {});
    return () => { live = false; };
  }, [art?.png, art?.w, art?.h]);
  return thumb;
}

// A right-hand list of the scene's sound sources. Each row shows the source's generated sprite and
// label, and controls its volume, whether it is hidden from the environment (reversible) and removal.
function AssetRow({ object, envId }: { object: SoundObject; envId?: string }) {
  const sprite = useArtStore(state => (envId ? state.sprites[spriteKey(envId, object)] : undefined));
  const art = sprite?.status === 'ready' ? sprite : undefined;
  const thumb = useFirstFrame(art);
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
    <div className="asset-thumb" style={thumb ? { backgroundImage: `url(${thumb})`, backgroundSize: '100% 100%' } : undefined}>
      {art ? null : <PixelIcon name="sound"/>}
    </div>
    <div className="asset-body">
      <span className="asset-label" title={object.label}>{object.label}</span>
      <input className="asset-volume" type="range" min={0} max={1} step={0.01} value={object.volume}
        aria-label={`${object.label} volume`} onChange={event => setVolume(Number(event.target.value))}/>
    </div>
    <div className="asset-actions">
      <button type="button" className="asset-action" aria-pressed={hidden} title={hidden ? 'Show in environment' : 'Hide from environment'} aria-label={hidden ? `Show ${object.label} in the environment` : `Hide ${object.label} from the environment`} onClick={toggleHidden}>
        <PixelIcon name={hidden ? 'hidden' : 'eye'}/>
      </button>
      <button type="button" className="asset-action asset-delete" title="Delete" aria-label={`Delete ${object.label}`} onClick={remove}>
        <PixelIcon name="trash"/>
      </button>
    </div>
  </li>;
}

export function AssetsPanel() {
  const objects = useSceneStore(state => state.scene.objects);
  const envId = useSceneStore(state => state.scene.room.art);
  const direction = useRoomStore(state => bearDirection(state.viewAngle));
  return <BorderBeam size="md" colorVariant="mono" strength={0.7} theme="dark" borderRadius={0} className="assets-beam">
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
    </BorderBeam>;
}
