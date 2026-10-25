import { getAudioContext } from "../audio/context.js";
import { duckSoundscape } from "../audio/ducking.js";

async function voiceRequest(token: string, body: unknown, signal?: AbortSignal) {
  const response = await fetch("/api/voice", { method: "POST", headers: {
    Authorization: `Bearer ${token}`, "Content-Type": "application/json",
  }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Voice is unavailable. Type your command instead.");
  return response;
}

type Access = { token: string; version: string };
let prepared: { owner: string; expires: number; access: Promise<Access> } | undefined;
function voiceAccess(token: string): Promise<Access> {
  if (prepared?.owner === token && prepared.expires > Date.now()) return prepared.access;
  const access = voiceRequest(token, { action: "token" }).then((response) => response.json() as Promise<Access>);
  const entry = { owner: token, expires: Date.now() + 45_000, access };
  prepared = entry;
  void access.catch(() => { if (prepared === entry) prepared = undefined; });
  return access;
}
/** Prepares network assets only; never opens the microphone. Tokens expire after 60 s. */
export async function prepareVoice(token: string) {
  await Promise.all([voiceAccess(token), fetch("/voice-pcm.js")]);
}

export type VoiceSession = { stop: () => void; cancel: () => void };
export type VoiceOptions = { automatic?: boolean; onPartial?: (text: string) => void; duck?: boolean };
export async function startVoice(token: string, signal: AbortSignal,
  onTranscript: (text: string) => void, onError: (error: string) => void,
  onStopped?: () => void, options: VoiceOptions = {}): Promise<VoiceSession> {
  let stream: MediaStream | undefined, context: AudioContext | undefined, socket: WebSocket | undefined;
  let source: MediaStreamAudioSourceNode | undefined, processor: AudioWorkletNode | undefined;
  let captureTimer: ReturnType<typeof setTimeout> | undefined, connectionTimer: ReturnType<typeof setTimeout> | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined, releaseDuck: (() => void) | undefined;
  let sendTimer: ReturnType<typeof setTimeout> | undefined, nextSendAt = 0, finalizeSent = false;
  let finished = false, stopping = false, flushed = false, transcript = "", partial = "";
  const buffered: ArrayBuffer[] = [];
  let bufferedBytes = 0;
  function stopMic() {
    source?.disconnect(); processor?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== "closed") void context.close();
    releaseDuck?.(); releaseDuck = undefined;
  }
  function cleanup() {
    finished = true; clearTimeout(captureTimer); clearTimeout(connectionTimer); clearTimeout(finishTimer); clearTimeout(sendTimer);
    stopMic(); buffered.length = 0; socket?.close();
    signal.removeEventListener("abort", cancel);
  }
  function cancel() { cleanup(); }
  function fail(message: string) { if (!finished) { cleanup(); onError(message); } }
  function complete(text: string) {
    if (finished) return;
    cleanup(); onStopped?.();
    if (text.trim()) onTranscript(text.trim()); else onError("No speech was detected. Try again or type your command.");
  }
  function sendBuffered() {
    if (finished || socket?.readyState !== WebSocket.OPEN || sendTimer) return;
    if (socket.bufferedAmount > 128_000) return fail("Voice connection is too slow. Please try again.");
    const delay = nextSendAt - performance.now();
    if (delay > 1 && (buffered.length || flushed)) {
      sendTimer = setTimeout(() => { sendTimer = undefined; sendBuffered(); }, delay);
      return;
    }
    const chunk = buffered.shift();
    if (chunk) {
      bufferedBytes -= chunk.byteLength; socket.send(chunk);
      // Pace initial buffered words too; Ink expects audio at real-time speed.
      nextSendAt = Math.max(nextSendAt, performance.now()) + chunk.byteLength / (2 * (context?.sampleRate ?? 16000)) * 1000;
      sendBuffered();
    } else if (flushed && !finalizeSent) {
      finalizeSent = true; socket.send(options.automatic ? JSON.stringify({ type: "close" }) : "finalize");
    }
  }
  function stop() {
    if (finished || stopping) return;
    stopping = true; source?.disconnect(); clearTimeout(captureTimer); onStopped?.();
    processor?.port.postMessage("flush");
    finishTimer = setTimeout(() => fail("Transcription took too long. Please type your command."), 8_000);
  }
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error("This browser needs HTTPS or localhost and microphone support for voice.");
    // Access, mic permission and worklet setup overlap. Capture needn't wait for the socket.
    const access = voiceAccess(token);
    void access.then((access) => {
      if (finished || signal.aborted) return;
      const url = new URL(`wss://api.cartesia.ai/stt/${options.automatic ? "turns/" : ""}websocket`);
      for (const [key, value] of Object.entries({ access_token: access.token, cartesia_version: access.version,
        model: "ink-2", encoding: "pcm_s16le", sample_rate: String(context?.sampleRate ?? 16000) })) url.searchParams.set(key, value);
      socket = new WebSocket(url);
      connectionTimer = setTimeout(() => fail("Voice connection timed out. Please try again."), 8_000);
      socket.onopen = () => { clearTimeout(connectionTimer); sendBuffered(); };
      socket.onerror = () => fail("Voice connection failed. Please type your command.");
      socket.onclose = () => { if (stopping && options.automatic) complete(transcript);
        else fail("Voice connection closed before transcription finished."); };
      socket.onmessage = (event) => {
        if (finished) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return fail("Invalid voice response. Please try again."); }
        if (message.type === "error") return fail("Cartesia could not transcribe this turn. Please try again or type.");
        if (options.automatic) {
          // Turn updates are cumulative, not deltas. Never execute an eager end.
          if (typeof message.transcript === "string") { partial = message.transcript; options.onPartial?.(partial); }
          if (message.type === "turn.end") {
            const text = typeof message.transcript === "string" && message.transcript ? message.transcript : partial;
            if (stopping) transcript += (transcript ? " " : "") + text;
            else complete(text); // one explicitly activated turn; mic off afterwards
          }
        } else {
          if (message.type === "transcript" && typeof message.text === "string") {
            if (message.is_final) transcript += message.text;
            options.onPartial?.(message.is_final ? transcript : transcript + message.text);
          }
          if (message.type === "flush_done" && stopping) complete(transcript);
        }
      };
    }).catch(() => fail("Could not prepare voice access. Please try again."));
    const microphone = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    // A late permission grant must not leave a microphone running after Esc/unmount.
    void microphone.then((value) => { if (finished || signal.aborted) value.getTracks().forEach((track) => track.stop()); }).catch(() => {});
    context = new AudioContext({ sampleRate: 16000 });
    const [mic] = await Promise.all([microphone, context.audioWorklet.addModule("/voice-pcm.js"), context.resume()]);
    stream = mic;
    signal.throwIfAborted();
    if (finished) throw new Error("Voice connection could not start.");
    source = context.createMediaStreamSource(stream);
    processor = new AudioWorkletNode(context, "voice-pcm");
    processor.port.onmessage = ({ data }) => {
      if (finished) return;
      if (data?.flushed && stopping) { flushed = true; stopMic(); sendBuffered(); return; }
      if (!(data instanceof ArrayBuffer)) return;
      bufferedBytes += data.byteLength;
      if (bufferedBytes > 128_000) return fail("Voice connection is taking too long. Please try again.");
      buffered.push(data); sendBuffered();
    };
    if (options.duck !== false) releaseDuck = duckSoundscape();
    source.connect(processor); processor.connect(context.destination); // Worklet outputs silence.
    captureTimer = setTimeout(stop, 30_000);
    return { stop, cancel };
  } catch (error) { cleanup(); throw error; }
}

export function playReadyCue() {
  const context = getAudioContext();
  const tone = context.createOscillator(), gain = context.createGain();
  const now = context.currentTime;
  tone.frequency.value = 880; gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.025, now + 0.008);
  gain.gain.linearRampToValueAtTime(0, now + 0.06);
  tone.connect(gain).connect(context.destination);
  tone.onended = () => { tone.disconnect(); gain.disconnect(); };
  tone.start(now); tone.stop(now + 0.065);
}

/** Schedule PCM chunks as they arrive instead of waiting for a complete WAV. */
export async function speakReply(token: string, text: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const response = await voiceRequest(token, { action: "speak", text: text.slice(0, 120) }, signal);
  if (!response.headers.get("Content-Type")?.startsWith("audio/pcm")) throw new Error("Spoken audio used an unsupported format.");
  if (!response.body) throw new Error("No spoken audio was returned.");
  const reader = response.body.getReader();
  const context = getAudioContext();
  const gain = context.createGain(); gain.gain.value = 0.5;
  const panner = context.createPanner(); panner.panningModel = "HRTF"; panner.positionZ.value = -1.5;
  gain.connect(panner).connect(context.destination);
  const sources = new Set<AudioBufferSourceNode>();
  let next = context.currentTime + 0.06, carry = new Uint8Array(0), releaseDuck: (() => void) | undefined;
  let wake: (() => void) | undefined, received = false;
  const stop = () => {
    void reader.cancel().catch(() => {});
    for (const source of sources) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    sources.clear();
    wake?.();
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      const bytes = new Uint8Array(carry.length + value.length);
      bytes.set(carry); bytes.set(value, carry.length);
      const count = Math.floor(bytes.length / 2);
      carry = bytes.slice(count * 2);
      if (!count) continue;
      const buffer = context.createBuffer(1, count, 24000), samples = buffer.getChannelData(0);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
      const source = context.createBufferSource(); source.buffer = buffer;
      source.connect(gain); sources.add(source);
      source.onended = () => { sources.delete(source); source.disconnect(); if (!sources.size) wake?.(); };
      releaseDuck ??= duckSoundscape(); received = true;
      next = Math.max(next, context.currentTime + 0.025);
      source.start(next); next += buffer.duration;
    }
    if (carry.length || !received) throw new Error("The spoken audio was incomplete.");
    if (sources.size) await new Promise<void>((resolve) => { wake = resolve; if (signal.aborted || !sources.size) resolve(); });
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", stop); stop();
    gain.disconnect(); panner.disconnect(); releaseDuck?.(); reader.releaseLock();
  }
}
