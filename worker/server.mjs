import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sessionPattern = /^sesn_[a-zA-Z0-9]+$/;
const filenamePattern = /^[a-zA-Z0-9_-]+\.(json|png|wav|mp3|ogg)$/;
const maxFile = 4 * 1024 * 1024;
const digest = value => createHash('sha256').update(value).digest();
class HttpError extends Error { constructor(status) { super(); this.status = status; } }

// SDK and generated tool code run only inside the worker container, never in the app server.
async function* runClaude(input) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  yield* query(input);
}

export async function createWorker({ key, root, run = runClaude, model = 'claude-opus-5-5' }) {
  if (!key?.trim()) throw new Error('Set WORLD_AGENT_API_KEY before starting the worker.');
  root = resolve(root);
  await mkdir(root, { recursive: true });
  const sessions = new Map();
  const subscribers = new Map();
  const active = new Set();
  const save = async state => {
    const path = join(root, state.id, 'state.json');
    await writeFile(`${path}.tmp`, JSON.stringify(state), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  };
  // Completed assets and SDK transcripts survive a restart. Interrupted builds fail visibly.
  for (const id of await readdir(root)) {
    if (!sessionPattern.test(id)) continue;
    let state;
    try { state = JSON.parse(await readFile(join(root, id, 'state.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (state.status !== 'idle') {
      state.status = 'idle';
      state.events.push({ id: `ev_${randomBytes(12).toString('hex')}`, type: 'session.error' });
      await save(state);
    }
    sessions.set(id, state);
  }
  function emit(state, event) {
    const value = { ...event, id: `ev_${randomBytes(12).toString('hex')}` };
    state.events.push(value);
    for (const subscriber of subscribers.get(state.id) ?? []) subscriber.write(`data: ${JSON.stringify(value)}\n\n`);
  }
  async function execute(state, text) {
    const cwd = join(root, state.id, 'work');
    try {
      const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'ANTHROPIC_API_KEY', 'CLAUDE_CONFIG_DIR'].filter(name => process.env[name]).map(name => [name, process.env[name]]));
      let success = false;
      for await (const message of run({
        prompt: text.replaceAll('/mnt/session/outputs/', `${cwd}/outputs/`),
        options: {
          cwd, model, systemPrompt: `${state.system}\n\nThe pxl and chirp tools are already installed at /opt/pxl and /opt/chirp. Read their SKILL.md and reference.md; use their real CLI builds. Do not clone or install them again. Build with the actual CLIs, then copy the compiled PNG/WAV/OGG files from their nested output folders into the flat outputs directory specified in the turn brief. Publish the turn manifest last. Skip artwork review, lint, image inspection, and preview generation; use pxl build --no-preview and publish the first valid build. Repair compilation failures only.`,
          ...(state.sdkSession ? { resume: state.sdkSession } : {}),
          env, settingSources: [], tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
          permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, effort: 'low',
          maxTurns: 80,
        },
      })) {
        if (message.type === 'system' && message.subtype === 'init') {
          state.sdkSession = message.session_id;
          await save(state);
        } else if (message.type === 'assistant') {
          for (const item of message.message?.content ?? []) if (item.type === 'tool_use') emit(state, { type: 'agent.tool_use', name: item.name?.toLowerCase() });
        } else if (message.type === 'result') success = message.subtype === 'success';
      }
      if (!success) throw new Error('Agent run failed');
      state.status = 'idle';
      const turn = text.match(/^Turn: (r_[a-f0-9]{16})\n/)?.[1];
      state.files = [...new Set([...(state.files ?? []), ...(await catalog(state, true)).filter(file => turn && file.filename.startsWith(`${turn}_`)).map(file => file.filename)])];
      emit(state, { type: 'session.status_idle', stop_reason: { type: 'end_turn' } });
    } catch {
      state.status = 'idle';
      emit(state, { type: 'session.error' });
    } finally {
      try { await save(state); } finally { active.delete(state.id); }
    }
  }
  async function start(state, text) {
    if (active.size) throw new HttpError(409); // One build at a time in this demo worker.
    state.status = 'running';
    emit(state, { type: 'user.message', content: [{ type: 'text', text }] });
    active.add(state.id);
    try { await save(state); } catch (error) { active.delete(state.id); throw error; }
    void execute(state, text).catch(() => { active.delete(state.id); });
  }
  function getSession(id) {
    if (!sessionPattern.test(id ?? '') || !sessions.has(id)) throw new HttpError(404);
    return sessions.get(id);
  }
  async function catalog(state, publishAll = false) {
    const dir = join(root, state.id, 'work', 'outputs');
    const files = [];
    for (const name of await readdir(dir)) {
      if (!filenamePattern.test(name) || (!publishAll && !(state.files ?? []).includes(name))) continue;
      let handle;
      try {
        handle = await open(join(dir, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = await handle.stat();
        if (stat.isFile() && stat.size <= maxFile) files.push({ id: `file_${Buffer.from(JSON.stringify([state.id, name])).toString('base64url')}`, filename: name, size_bytes: stat.size, downloadable: true, scope: { type: 'session', id: state.id } });
      } catch { /* Non-regular files and symlinks are never published. */ }
      finally { await handle?.close(); }
    }
    return files;
  }
  async function body(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 512 * 1024) throw new HttpError(413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new HttpError(400); }
  }
  return createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      if (!timingSafeEqual(digest(String(req.headers['x-api-key'] ?? '')), digest(key))) throw new HttpError(401);
      const url = new URL(req.url, 'http://worker');
      if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true });
      if (req.method === 'POST' && url.pathname === '/v1/sessions') {
        if (active.size) throw new HttpError(409);
        const input = await body(req);
        const text = input.initial_events?.[0]?.content?.[0]?.text;
        const system = input.agent?.system;
        if (typeof text !== 'string' || typeof system !== 'string') throw new HttpError(400);
        const id = `sesn_${randomBytes(16).toString('hex')}`;
        await mkdir(join(root, id, 'work', 'outputs'), { recursive: true });
        const state = { id, system, status: 'idle', events: [] };
        sessions.set(id, state);
        await start(state, text);
        return json(200, { id });
      }
      const match = url.pathname.match(/^\/v1\/sessions\/(sesn_[a-zA-Z0-9]+)(?:\/(events)(\/stream)?)?$/);
      if (match) {
        const state = getSession(match[1]);
        if (req.method === 'GET' && !match[2]) return json(200, { id: state.id, status: active.has(state.id) ? 'running' : state.status });
        if (req.method === 'POST' && match[2] && !match[3]) {
          const input = await body(req), text = input.events?.[0]?.content?.[0]?.text;
          if (typeof text !== 'string') throw new HttpError(400);
          if (state.status !== 'idle') throw new HttpError(409);
          await start(state, text);
          return json(200, { ok: true });
        }
        if (req.method === 'GET' && match[3]) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
          res.flushHeaders();
          const listeners = subscribers.get(state.id) ?? new Set(); listeners.add(res); subscribers.set(state.id, listeners);
          const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 10_000);
          const timer = setTimeout(() => res.end(), 40_000);
          res.on('close', () => { clearInterval(heartbeat); clearTimeout(timer); listeners.delete(res); });
          return;
        }
        if (req.method === 'GET' && match[2]) {
          const page = Number(url.searchParams.get('page') ?? 0);
          if (!Number.isSafeInteger(page) || page < 0) throw new HttpError(400);
          return json(200, { data: state.events.slice(page, page + 100), ...(page + 100 < state.events.length ? { next_page: String(page + 100) } : {}) });
        }
      }
      if (req.method === 'GET' && url.pathname === '/v1/files') return json(200, { data: await catalog(getSession(url.searchParams.get('scope_id'))) });
      const fileMatch = url.pathname.match(/^\/v1\/files\/(file_[A-Za-z0-9_-]+)\/content$/);
      if (req.method === 'GET' && fileMatch) {
        let id, name;
        try { [id, name] = JSON.parse(Buffer.from(fileMatch[1].slice(5), 'base64url').toString()); } catch { throw new HttpError(404); }
        if (typeof name !== 'string' || !filenamePattern.test(name)) throw new HttpError(404);
        const state = getSession(id);
        if (!(await catalog(state)).some(file => file.id === fileMatch[1])) throw new HttpError(404);
        const handle = await open(join(root, id, 'work', 'outputs', name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > maxFile) throw new HttpError(404);
          const bytes = await handle.readFile();
          if (bytes.length > maxFile) throw new HttpError(413);
          res.writeHead(200, { 'Content-Type': name.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes);
        } finally { await handle.close(); }
        return;
      }
      throw new HttpError(404);
    } catch (error) { if (!res.headersSent) json(error instanceof HttpError ? error.status : 500, { error: 'The worker could not complete this request.' }); else res.end(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await createWorker({ key: process.env.WORLD_AGENT_API_KEY, root: '/data/sessions', model: process.env.WORLD_AGENT_MODEL || 'claude-opus-5-5' });
  server.listen(8787, '0.0.0.0', () => console.log('World agent worker listening on :8787'));
}
