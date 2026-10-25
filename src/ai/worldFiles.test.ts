import { describe, expect, it } from 'vitest';
import { mergeWorld, ownsWorld, rewriteUrls, tokenSession, worldFiles } from './worldFiles.js';
import type { ManagedAssets } from './world.js';

const token = (session: string) => `${btoa(JSON.stringify({ session, turn: 'r_0123456789abcdef', context: 'x', expires: 1 })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
const url = (file: string, t = token('sesn_mine')) => `/api/world?${new URLSearchParams({ action: 'asset', token: t, file })}`;
const image = (file: string) => ({ url: url(file), w: 16, h: 16, frames: 1, fps: 10 });
const world = (): ManagedAssets => ({
  envId: 'agent-sesn_mine-r_0123456789abcdef',
  environment: { concept: 'A forest', shell: '#324d35', colors: ['#324d35', '#91a56c'], openAir: false, textures: { floor: image('file_floor') } },
  sprites: [{ ...image('file_oak'), objectId: 'oak', label: 'Old oak', query: 'wind in oak leaves', wall: null }],
  sounds: [{ objectId: 'woodpecker', query: 'a woodpecker tapping', kind: 'event', fileId: 'file_peck', url: url('file_peck') }],
});

describe('keeping Claude agent worlds (#112)', () => {
  it('finds every proxied file with its token', () => {
    expect(worldFiles(world()).map(file => file.fileId)).toEqual(['file_floor', 'file_oak', 'file_peck']);
    expect(worldFiles(world()).every(file => tokenSession(file.token) === 'sesn_mine')).toBe(true);
    const kept = rewriteUrls(world(), () => 'https://example.convex.cloud/api/storage/abc');
    expect(worldFiles(kept)).toEqual([]); // already-kept URLs are not files to fetch
  });
  it('accepts a world id only for the token\'s own session', () => {
    expect(ownsWorld(token('sesn_mine'), 'agent-sesn_mine-r_0123456789abcdef')).toBe(true);
    expect(ownsWorld(token('sesn_mine'), 'agent-sesn_mine')).toBe(true);
    expect(ownsWorld(token('sesn_other'), 'agent-sesn_mine-r_0123456789abcdef')).toBe(false);
    expect(ownsWorld(token('sesn_mine'), 'agent-sesn_mine2')).toBe(false);
    expect(ownsWorld('not-a-token', 'agent-sesn_mine')).toBe(false);
  });
  it('rewrites every file URL', () => {
    const kept = rewriteUrls(world(), old => `kept:${new URLSearchParams(old.split('?')[1]).get('file')}`);
    expect([kept.environment!.textures!.floor!.url, kept.sprites[0].url, kept.sounds[0].url]).toEqual(['kept:file_floor', 'kept:file_oak', 'kept:file_peck']);
  });
  it('merges an edit into the kept world: new objects added, replaced ones swapped, the environment kept', () => {
    const edit: ManagedAssets = { envId: world().envId, environment: undefined,
      sprites: [{ ...image('file_oak2'), objectId: 'oak', label: 'Old oak', query: 'wind in oak leaves', wall: null }, { ...image('file_cat'), objectId: 'cat', label: 'Cat', query: 'a cat purring', wall: null }],
      sounds: [{ objectId: 'cat', query: 'a cat purring', kind: 'bed', fileId: 'file_purr', url: url('file_purr') }] };
    const merged = mergeWorld(world(), edit);
    expect(merged.environment).toEqual(world().environment);
    expect(merged.sprites.map(sprite => [sprite.objectId, new URLSearchParams(sprite.url.split('?')[1]).get('file')])).toEqual([['oak', 'file_oak2'], ['cat', 'file_cat']]);
    expect(merged.sounds.map(sound => sound.objectId)).toEqual(['woodpecker', 'cat']);
    expect(mergeWorld(undefined, edit)).toBe(edit);
  });
});
