import type { ManagedAssets } from './world.js';

// Pure helpers for keeping Claude agent worlds in Convex (convex/agentWorlds.ts, #112): which files a
// world references, whose session they belong to, and how an edit's assets merge into the kept world.

export type WorldFile = { url: string; fileId: string; token: string };

/** Every generated file a fresh world references through the /api/world proxy, with its signed token. */
export function worldFiles(assets: ManagedAssets): WorldFile[] {
  const urls = [
    ...Object.values(assets.environment?.textures ?? {}).map(image => image.url),
    ...assets.sprites.map(sprite => sprite.url),
    ...assets.sounds.map(sound => sound.url),
  ];
  return urls.flatMap(url => {
    if (!url.startsWith('/api/world?')) return [];
    const params = new URLSearchParams(url.slice('/api/world?'.length));
    const fileId = params.get('file'), token = params.get('token');
    return params.get('action') === 'asset' && fileId && token ? [{ url, fileId, token }] : [];
  });
}

/**
 * The session a world's signed token was issued for (server/managedAgent.ts). Anyone can read the
 * payload, but only our server can sign it, and /api/world serves files only for valid tokens.
 */
export function tokenSession(token: string): string | undefined {
  try {
    const payload = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const session = JSON.parse(atob(payload)).session;
    return typeof session === 'string' && /^sesn_[a-zA-Z0-9]+$/.test(session) ? session : undefined;
  } catch {
    return undefined;
  }
}

/** World ids are agent-<session> or agent-<session>-<turn> (server/managedAgent.ts). */
export function ownsWorld(token: string, envId: string): boolean {
  const session = tokenSession(token);
  return !!session && (envId === `agent-${session}` || envId.startsWith(`agent-${session}-`));
}

/** The same assets with each file URL replaced (by its kept Convex URL). */
export function rewriteUrls(assets: ManagedAssets, url: (old: string) => string): ManagedAssets {
  const textures = assets.environment?.textures;
  return {
    ...assets,
    environment: assets.environment && {
      ...assets.environment,
      textures: textures && Object.fromEntries(Object.entries(textures).map(([surface, image]) => [surface, { ...image, url: url(image.url) }])),
    },
    sprites: assets.sprites.map(sprite => ({ ...sprite, url: url(sprite.url) })),
    sounds: assets.sounds.map(sound => ({ ...sound, url: url(sound.url) })),
  };
}

/** An edit's assets on top of the kept world: its environment if it painted one, its objects replacing theirs. */
export function mergeWorld(kept: ManagedAssets | undefined, next: ManagedAssets): ManagedAssets {
  if (!kept) return next;
  const replaced = (objectId: string, list: { objectId: string }[]) => list.some(item => item.objectId === objectId);
  return {
    envId: next.envId,
    environment: next.environment ?? kept.environment,
    sprites: [...kept.sprites.filter(sprite => !replaced(sprite.objectId, next.sprites)), ...next.sprites],
    sounds: [...kept.sounds.filter(sound => !replaced(sound.objectId, next.sounds)), ...next.sounds],
  };
}
