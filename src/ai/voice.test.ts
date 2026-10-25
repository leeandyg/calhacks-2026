import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { soundscapeGain } from "../audio/ducking.js";
import { prepareVoice, speakReply, startVoice, type VoiceSession } from "./voice.js";

vi.mock("../audio/context.js", () => ({ getAudioContext: () => output }));
class Node {
  gain = { value: 1 }; positionZ = { value: 0 }; buffer?: ReturnType<Context["createBuffer"]>;
  disconnected = false; started?: number; stopped = false; onended?: () => void;
  connect(node: unknown) { return node; }
  disconnect() { this.disconnected = true; }
  start(at: number) { this.started = at; }
  stop() { this.stopped = true; this.end(); }
  end() { this.onended?.(); }
}
class Context {
  sampleRate = 16000; currentTime = 0; state = "running"; destination = {};
  audioWorklet = { addModule: vi.fn(async () => {}) };
  async resume() {} async close() { this.state = "closed"; }
  createMediaStreamSource() { return new Node(); }
  createGain() { return new Node(); }
  createPanner() { return new Node(); }
  createBufferSource() { const source = new Node(); speechSources.push(source); return source; }
  createBuffer(_channels: number, length: number, rate: number) {
    const samples = new Float32Array(length);
    return { duration: length / rate, getChannelData: () => samples };
  }
}
class Worklet extends Node {
  constructor() { super(); worklets.push(this); }
  port = { onmessage: (_event: { data: unknown }) => {}, postMessage: () => queueMicrotask(() => {
    this.port.onmessage({ data: new ArrayBuffer(2) }); this.port.onmessage({ data: { flushed: true } });
  }) };
}
class Socket {
  static OPEN = 1; readyState = 0; bufferedAmount = 0; sent: unknown[] = [];
  onopen?: () => void; onclose?: () => void; onerror?: () => void; onmessage?: (event: { data: string }) => void;
  constructor(readonly url: URL) { sockets.push(this); if (!holdSocket) queueMicrotask(() => this.open()); }
  open() { this.readyState = 1; this.onopen?.(); }
  close() { this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
  send(data: unknown) { this.sent.push(data); }
  event(type: string, fields: Record<string, unknown> = {}) { this.onmessage?.({ data: JSON.stringify({ type, ...fields }) }); }
}
let output: Context, sockets: Socket[], worklets: Worklet[], speechSources: Node[];
let holdSocket: boolean, owner = 0;
const sessions: VoiceSession[] = [], aborts: AbortController[] = [];
const tracks: { stopped: boolean; stop: () => void }[] = [];
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let getMic: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); output = new Context(); sockets = []; worklets = []; speechSources = []; holdSocket = false; tracks.length = 0;
  getMic = vi.fn(async () => {
    const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track);
    return { getTracks: () => [track] };
  });
  vi.stubGlobal("window", { AudioWorkletNode: Worklet }); vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: getMic } });
  vi.stubGlobal("AudioContext", Context); vi.stubGlobal("AudioWorkletNode", Worklet); vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("fetch", vi.fn(async (url) => url === "/voice-pcm.js" ? new Response("worklet") : Response.json({ token: "short-token", version: "2026-08-14" })));
});
afterEach(async () => {
  sessions.splice(0).forEach((session) => session.cancel()); aborts.splice(0).forEach((abort) => abort.abort());
  await flush(); expect(soundscapeGain()).toBe(1); vi.useRealTimers(); vi.unstubAllGlobals();
});
async function capture(automatic = false, token = `owner-${++owner}`) {
  const abort = new AbortController(); aborts.push(abort);
  const transcript = vi.fn(), error = vi.fn(), partial = vi.fn();
  const session = await startVoice(token, abort.signal, transcript, error, undefined, { automatic, onPartial: partial });
  sessions.push(session); await flush();
  return { session, abort, transcript, error, partial, socket: sockets.at(-1)! };
}

describe("voice turn lifecycle", () => {
  it('keeps the same microphone and socket through ignored and wake-only turns', async () => {
    const abort = new AbortController(); aborts.push(abort);
    const transcript = vi.fn(), error = vi.fn();
    let armed = false;
    const session = await startVoice(`wake-owner-${++owner}`, abort.signal, transcript, error, undefined, {
      automatic: true, duck: false,
      acceptTurn: text => {
        if (text === 'Hey agent') { armed = true; return false; }
        return armed && text.trim().length > 0;
      },
    });
    sessions.push(session); await flush();
    const socket = sockets.at(-1)!;
    socket.event('turn.end', { transcript: 'Background conversation' });
    socket.event('turn.end', { transcript: 'Hey agent' });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(socket.readyState).toBe(Socket.OPEN);
    expect(getMic).toHaveBeenCalledTimes(1);
    expect(tracks[0].stopped).toBe(false);
    expect(transcript).not.toHaveBeenCalled();
    socket.event('turn.start');
    socket.event('turn.end', { transcript: '' });
    expect(transcript).not.toHaveBeenCalled();
    socket.event('turn.end', { transcript: 'Mute rain' });
    expect(transcript).toHaveBeenCalledExactlyOnceWith('Mute rain');
    expect(tracks[0].stopped).toBe(true);
    expect(error).not.toHaveBeenCalled();
  });
  it('keeps room audio at its saved level while waiting for a wake phrase', async () => {
    const abort = new AbortController(); aborts.push(abort);
    const session = await startVoice(`standby-${++owner}`, abort.signal, vi.fn(), vi.fn(), undefined, { automatic: true, duck: false });
    sessions.push(session); await flush();
    expect(soundscapeGain()).toBe(1);
    session.cancel(); expect(tracks[0].stopped).toBe(true);
  });
  it("refreshes expired access and never reuses it across identities", async () => {
    const token = `owner-${++owner}`;
    await prepareVoice(token); await vi.advanceTimersByTimeAsync(46000); await prepareVoice(token);
    await prepareVoice(`owner-${++owner}`);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/voice")).toHaveLength(3);
    expect(getMic).not.toHaveBeenCalled();
  });
  it("prepares access without opening the mic and reuses the token for capture", async () => {
    const token = `owner-${++owner}`;
    await prepareVoice(token); await prepareVoice(token);
    expect(getMic).not.toHaveBeenCalled();
    const turn = await capture(false, token);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/voice")).toHaveLength(1);
    expect(soundscapeGain()).toBe(0.25); turn.session.cancel(); expect(tracks[0].stopped).toBe(true);
  });
  it("preserves first audio while connecting, paces it and flushes before finalizing", async () => {
    holdSocket = true;
    const turn = await capture();
    const first = new ArrayBuffer(3200), second = new ArrayBuffer(3200);
    worklets[0].port.onmessage({ data: first }); worklets[0].port.onmessage({ data: second });
    turn.session.stop(); await flush();
    expect(tracks[0].stopped).toBe(true); expect(soundscapeGain()).toBe(1); expect(turn.socket.sent).toEqual([]);
    turn.socket.open(); expect(turn.socket.sent).toEqual([first]);
    await vi.advanceTimersByTimeAsync(250);
    expect(turn.socket.sent[1]).toBe(second); expect(turn.socket.sent.at(-1)).toBe("finalize");
    turn.socket.event("transcript", { text: "make", is_final: true });
    turn.socket.event("transcript", { text: " it rainier", is_final: true });
    expect(turn.transcript).not.toHaveBeenCalled(); turn.socket.event("flush_done");
    expect(turn.transcript).toHaveBeenCalledExactlyOnceWith("make it rainier");
  });
  it("shows cumulative automatic captions and waits for confirmed turn.end", async () => {
    const turn = await capture(true);
    expect(turn.socket.url.pathname).toBe("/stt/turns/websocket");
    turn.socket.event("turn.update", { transcript: "mute" });
    turn.socket.event("turn.update", { transcript: "mute the rain" });
    turn.socket.event("turn.eager_end", { transcript: "mute the rain" }); turn.socket.event("turn.resume");
    expect(turn.partial).toHaveBeenLastCalledWith("mute the rain"); expect(turn.transcript).not.toHaveBeenCalled();
    turn.socket.event("turn.end", { transcript: "mute the rain" });
    expect(turn.transcript).toHaveBeenCalledExactlyOnceWith("mute the rain");
    expect(tracks[0].stopped).toBe(true); expect(soundscapeGain()).toBe(1);
  });
  it("drains a manually stopped automatic turn until the server closes", async () => {
    const turn = await capture(true); turn.session.stop(); await flush();
    expect(turn.socket.sent.at(-1)).toBe('{"type":"close"}');
    turn.socket.event("turn.end", { transcript: "quiet rain" });
    expect(turn.transcript).not.toHaveBeenCalled(); turn.socket.close(); await flush();
    expect(turn.transcript).toHaveBeenCalledExactlyOnceWith("quiet rain");
  });
  it("cancellation and connection errors restore ducking without submitting text", async () => {
    const turn = await capture(); turn.abort.abort(); await flush();
    expect(turn.transcript).not.toHaveBeenCalled(); expect(turn.error).not.toHaveBeenCalled(); expect(tracks[0].stopped).toBe(true);
    const other = await capture(); other.socket.onerror?.();
    expect(other.error).toHaveBeenCalledTimes(1); expect(other.transcript).not.toHaveBeenCalled(); expect(soundscapeGain()).toBe(1);
  });
  it("bounds initial audio buffering and stops the mic when the connection cannot keep up", async () => {
    holdSocket = true; const turn = await capture();
    worklets[0].port.onmessage({ data: new ArrayBuffer(128002) });
    expect(turn.error).toHaveBeenCalledTimes(1); expect(tracks[0].stopped).toBe(true); expect(turn.transcript).not.toHaveBeenCalled();
  });
});

describe("streamed spoken replies", () => {
  it("plays before EOF, carries odd byte boundaries and restores audio after playback", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers: { "Content-Type": "audio/pcm" } }));
    const abort = new AbortController(); aborts.push(abort);
    const speaking = speakReply("auth", "Rain turned up.", abort.signal); await flush();
    stream.enqueue(new Uint8Array([0, 64, 0])); await flush();
    expect(speechSources).toHaveLength(1); expect(speechSources[0].started).toBeDefined(); expect(soundscapeGain()).toBe(0.25);
    stream.enqueue(new Uint8Array([192, 0, 0])); stream.close(); await flush();
    expect([...speechSources[0].buffer!.getChannelData()]).toEqual([0.5]);
    expect([...speechSources[1].buffer!.getChannelData()]).toEqual([-0.5, 0]);
    speechSources.forEach((source) => source.end()); await speaking;
    expect(soundscapeGain()).toBe(1); expect(speechSources.every((source) => source.disconnected)).toBe(true);
  });
  it("interrupts scheduled speech and cancels the pending stream read", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>; const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ start(controller) { stream = controller; }, cancel }), { headers: { "Content-Type": "audio/pcm" } }));
    const abort = new AbortController(); aborts.push(abort);
    const speaking = speakReply("auth", "Room updated.", abort.signal); await flush();
    stream.enqueue(new Uint8Array([0, 64])); await flush(); abort.abort();
    await expect(speaking).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalled(); expect(speechSources.every((source) => source.stopped && source.disconnected)).toBe(true);
    expect(soundscapeGain()).toBe(1);
  });
  it("rejects truncated PCM instead of claiming a successful reply", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([1]), { headers: { "Content-Type": "audio/pcm" } }));
    await expect(speakReply("auth", "Done.", new AbortController().signal)).rejects.toThrow(/incomplete/);
  });
});
