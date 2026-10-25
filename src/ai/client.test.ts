import { afterEach, expect, it, vi } from 'vitest';
import { requestScene } from './client.js';
import { cafe } from '../scene/fixtures.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps a cloud request alive when session startup takes longer than 15 seconds', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
    return controller.signal;
  });
  const fetch = vi.fn((_url: unknown, options?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(Response.json({ kind: 'create', scene: cafe })), 16_000);
    options?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal!.reason); }, { once: true });
  }));
  vi.stubGlobal('fetch', fetch);
  const result = requestScene('A quiet library', null).then(reply => reply, error => error);
  await vi.advanceTimersByTimeAsync(33_000);
  const reply = await result;
  expect(reply).not.toBeInstanceOf(Error);
  expect(reply.notice).toBeUndefined();
  expect(reply.kind).toBe('create');
  expect(fetch).toHaveBeenCalledTimes(1);
});
