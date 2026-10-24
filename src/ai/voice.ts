import { getAudioContext } from "../audio/context.js";

async function voiceRequest(token: string, body: unknown, signal?: AbortSignal) {
  const response = await fetch("/api/voice", { method: "POST", headers: {
    Authorization: `Bearer ${token}`, "Content-Type": "application/json",
  }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Voice is unavailable. Type your command instead.");
  return response;
}

export type VoiceSession = { stop: () => void; cancel: () => void };
export async function startVoice(token: string, signal: AbortSignal,
  onTranscript: (text: string) => void, onError: (error: string) => void,
  onStopped?: () => void): Promise<VoiceSession> {
  let stream: MediaStream | undefined, context: AudioContext | undefined, socket: WebSocket | undefined;
  let source: MediaStreamAudioSourceNode | undefined, processor: AudioWorkletNode | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, finished = false, stopping = false, transcript = "";
  function stopMic() {
    source?.disconnect(); processor?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== "closed") void context.close();
  }
  function cleanup() {
    finished = true; clearTimeout(timer); stopMic(); socket?.close();
    signal.removeEventListener("abort", cancel);
  }
  function cancel() { cleanup(); }
  function fail(message: string) { if (!finished) { cleanup(); onError(message); } }
  function stop() {
    if (finished || stopping) return;
    stopping = true; source?.disconnect(); clearTimeout(timer); onStopped?.();
    if (socket?.readyState !== WebSocket.OPEN) return fail("Voice connection was lost. Please try again.");
    processor?.port.postMessage("flush");
    timer = setTimeout(() => fail("Transcription took too long. Please type your command."), 8_000);
  }
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error("This browser needs HTTPS or localhost and microphone support for voice.");
    const access = await (await voiceRequest(token, { action: "token" }, signal)).json();
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    context = new AudioContext({ sampleRate: 16000 });
    await context.resume();
    await context.audioWorklet.addModule("/voice-pcm.js");
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const url = new URL("wss://api.cartesia.ai/stt/websocket");
    for (const [key, value] of Object.entries({ access_token: access.token, cartesia_version: access.version,
      model: "ink-2", encoding: "pcm_s16le", sample_rate: String(context.sampleRate) })) url.searchParams.set(key, value);
    socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { signal.removeEventListener("abort", abort); reject(new Error("Voice connection timed out.")); }, 8_000);
      const abort = () => { clearTimeout(timeout); reject(new DOMException("Cancelled", "AbortError")); };
      signal.addEventListener("abort", abort, { once: true });
      socket!.onopen = () => { clearTimeout(timeout); signal.removeEventListener("abort", abort); resolve(); };
      socket!.onerror = () => { clearTimeout(timeout); signal.removeEventListener("abort", abort); reject(new Error("Could not connect to Cartesia.")); };
      socket!.onclose = () => { clearTimeout(timeout); signal.removeEventListener("abort", abort); reject(new Error("Voice connection closed.")); };
    });
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    socket.onmessage = (event) => {
      if (finished) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return fail("Invalid voice response. Please try again."); }
      if (message.type === "error") return fail("Cartesia could not transcribe this turn. Please try again or type.");
      if (message.type === "transcript" && message.is_final && typeof message.text === "string") transcript += message.text;
      if (message.type === "flush_done" && stopping) {
        const text = transcript.trim(); cleanup();
        if (text) onTranscript(text); else onError("No speech was detected. Try again or type your command.");
      }
    };
    socket.onerror = () => fail("Voice connection failed. Please type your command.");
    socket.onclose = () => fail("Voice connection closed before transcription finished.");
    source = context.createMediaStreamSource(stream);
    processor = new AudioWorkletNode(context, "voice-pcm");
    processor.port.onmessage = ({ data }) => {
      if (!finished && socket?.readyState === WebSocket.OPEN) {
        if (data?.flushed && stopping) { stopMic(); socket.send("finalize"); return; }
        if (!(data instanceof ArrayBuffer)) return;
        if (socket.bufferedAmount > 128_000) return fail("Voice connection is too slow. Please try again.");
        socket.send(data);
      }
    };
    source.connect(processor); processor.connect(context.destination); // Worklet outputs silence.
    timer = setTimeout(stop, 30_000);
    return { stop, cancel };
  } catch (error) { cleanup(); throw error; }
}

export async function speakReply(token: string, text: string, signal: AbortSignal) {
  const response = await voiceRequest(token, { action: "speak", text: text.slice(0, 200) }, signal);
  const context = getAudioContext();
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  if (signal.aborted) return;
  const source = context.createBufferSource(); source.buffer = buffer;
  const gain = context.createGain(); gain.gain.value = 0.5;
  const panner = context.createPanner(); panner.panningModel = "HRTF"; panner.positionZ.value = -1.5;
  source.connect(gain).connect(panner).connect(context.destination);
  const stop = () => { try { source.stop(); } catch { /* Already ended. */ } };
  signal.addEventListener("abort", stop, { once: true });
  source.onended = () => { signal.removeEventListener("abort", stop); source.disconnect(); gain.disconnect(); panner.disconnect(); };
  source.start();
}
