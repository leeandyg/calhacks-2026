import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Warm-instance cache, shared by matching concurrent requests. /tmp also survives module reloads
// in local dev. Vercel instances don't share it; cross-instance persistence needs external storage.
const directory = join(tmpdir(), 'soundscape-art-v1');
const pending = new Map<string, Promise<unknown>>();
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function cachedArt<T>(key: unknown, generate: () => Promise<T>): Promise<T> {
  const digest = createHash('sha256').update(JSON.stringify(key)).digest('hex');
  const active = pending.get(digest);
  if (active) return active as Promise<T>;
  const task = (async () => {
    const path = join(directory, `${digest}.json`);
    try {
      const cached = JSON.parse(await readFile(path, 'utf8'));
      if (cached.created > Date.now() - TTL_MS) return cached.value as T;
    } catch { /* cache miss */ }
    const value = await generate();
    try {
      await mkdir(directory, { recursive: true });
      const files = (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
      // Keep disk use bounded; eviction only changes how soon art must be regenerated.
      if (files.length >= 128) await Promise.all(files.slice(0, files.length - 127).map(name => rm(join(directory, name), { force: true })));
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify({ created: Date.now(), value }));
      await rename(temp, path);
    } catch { /* caching is optional; the generated art can still be shown */ }
    return value;
  })();
  pending.set(digest, task);
  try { return await task; } finally { pending.delete(digest); }
}
