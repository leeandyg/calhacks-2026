import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { createFixtureRoom } from './create-fixture-room.mjs';

process.env.VITE_CONVEX_URL = '';
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
await server.listen();
const channel = process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
const browser = await chromium.launch({ headless: !channel, ...(channel ? { channel } : {}), args: ['--window-position=-32000,-32000', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const sockets = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.voiceTracks = [];
  const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (...args) => {
    const stream = await getMedia(...args); window.voiceTracks.push(...stream.getTracks()); return stream;
  };
  const pip = window.documentPictureInPicture;
  if (pip) {
    const open = pip.requestWindow.bind(pip);
    pip.requestWindow = async (...args) => { const result = await open(...args); window.voiceWindow = result; return result; };
  }
  const open = window.open.bind(window);
  window.open = (...args) => { const result = open(...args); window.voiceWindow = result; return result; };
});
await page.route('**/api/voice', route => {
  if (route.request().method() === 'GET') return route.fulfill({ json: { configured: true, spokenReplies: false } });
  return route.fulfill({ json: { token: 'test-only', version: '2026-08-14' } });
});
await page.route('**/api/agent', route => route.fulfill({ json: { preferences: [] } }));
await page.routeWebSocket(/api\.cartesia\.ai\/stt\//, socket => {
  const record = { socket, closed: false }; sockets.push(record);
  socket.onClose(() => { record.closed = true; });
  socket.onMessage(data => {
    if (data === 'finalize') {
      socket.send(JSON.stringify({ type: 'transcript', is_final: true, text: 'Unmute rain' }));
      socket.send(JSON.stringify({ type: 'flush_done' }));
    } else if (typeof data === 'string' && JSON.parse(data).type === 'close') socket.close();
  });
});
const fixture = () => page.locator('#voice-fixture');
const activeTracks = () => page.evaluate(() => window.voiceTracks.filter(track => track.readyState !== 'ended').length);
const commands = () => page.evaluate(() => window.voiceCommands);
async function listening() {
  await expect(fixture().getByText('Mic on · say “Hey agent” and your command', { exact: true })).toBeVisible();
  await expect.poll(activeTracks).toBe(1);
  return sockets.at(-1).socket;
}
async function nextSocket(previous) {
  await expect.poll(() => sockets.at(-1)?.socket !== previous && sockets.at(-1)?.socket.url().includes('/turns/')).toBe(true);
  return sockets.at(-1).socket;
}
const turn = (socket, text, type = 'turn.end') => socket.send(JSON.stringify({ type, transcript: text }));
try {
  await mkdir('test-results', { recursive: true });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.evaluate(async () => {
    const react = await import('/node_modules/.vite/deps/react.js');
    const client = await import('/node_modules/.vite/deps/react-dom_client.js');
    const React = react.default ?? react;
    const { createRoot } = client.default ?? client;
    const { VoiceAgentControls } = await import('/src/ai/AgentControls.tsx');
    const { starter } = await import('/src/scene/fixtures.ts');
    const { quickCommand } = await import('/src/ai/quickCommands.ts');
    const { soundscapeGain } = await import('/src/audio/ducking.ts');
    window.voiceGain = soundscapeGain; window.voiceCommands = []; window.voiceContexts = [];
    window.sceneStore.getState().setScene(starter);
    const host = document.createElement('div'); host.id = 'voice-fixture';
    host.style.cssText = 'position:fixed;inset:30px 15%;z-index:20;padding:24px;background:#11171e;overflow:auto';
    document.body.append(host);
    window.voiceRoot = createRoot(host);
    window.voiceRoot.render(React.createElement(VoiceAgentControls, {
      token: 'test-only', disabled: false, demoMode: false, refresh: 0, onContext: () => {},
      onCommand: async (text, commandContext, options) => {
        window.voiceCommands.push(text);
        window.voiceContexts.push(commandContext.task);
        if (text === 'wait for update') await new Promise((resolve, reject) => {
          window.finishVoiceCommand = resolve;
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        });
        options.signal.throwIfAborted();
        const result = quickCommand(text, window.sceneStore.getState().scene);
        if (result?.ops) window.sceneStore.getState().applyOps(result.ops);
        return 'Room updated.';
      },
    }));
  });
  await expect(fixture().getByRole('button', { name: 'Talk to agent', exact: true })).toBeEnabled();
  await fixture().getByLabel('Hey agent', { exact: true }).check();
  let socket = await listening();
  await page.evaluate(() => {
    const state = window.sceneStore.getState();
    state.setScene({ ...state.scene, session: { ...state.scene.session, task: 'homework' } });
  });
  assert.equal(await page.evaluate(() => window.voiceGain()), 1, 'standby never ducks room audio');
  const homework = await context.newPage(); await homework.goto('data:text/html,<title>Homework</title><textarea>Homework notes</textarea>');
  // Restore native focus behavior; Playwright normally forces every tab focused.
  await (await context.newCDPSession(page)).send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await (await context.newCDPSession(homework)).send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await homework.bringToFront();
  if (channel) await page.waitForFunction(() => !document.hasFocus());
  else await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  turn(socket, 'I need to finish question three.');
  await expect.poll(() => sockets.at(-1).socket).toBe(socket);
  assert.deepEqual(await commands(), []);
  assert.equal(await fixture().getByText(/question three/).count(), 0, 'unaddressed transcripts stay out of the UI');
  turn(socket, 'Hey agent, mute rain', 'turn.update');
  turn(socket, 'Hey agent, mute rain', 'turn.eager_end');
  assert.deepEqual(await commands(), [], 'eager partials never execute');
  turn(socket, 'Hey agent, mute rain');
  await expect.poll(commands).toEqual(['mute rain']);
  assert.equal(await page.evaluate(() => window.voiceContexts[0]), 'homework', 'wake commands use task edits made during standby');
  await expect.poll(() => page.evaluate(() => window.sceneStore.getState().scene.objects.find(object => object.id === 'rain-1').muted)).toBe(true);
  socket = await nextSocket(socket);
  await listening();
  const wakeSocketCount = sockets.length;
  const wakeTrackCount = await page.evaluate(() => window.voiceTracks.length);
  turn(socket, 'Hey agent!');
  await expect(fixture().getByText('Listening for your command…', { exact: true })).toBeVisible();
  assert.equal(sockets.length, wakeSocketCount, 'a wake-only turn keeps the same connection for the command');
  assert.equal(await page.evaluate(() => window.voiceTracks.length), wakeTrackCount, 'the command cannot fall into a microphone restart gap');
  assert.equal(await activeTracks(), 1);
  assert.deepEqual(await commands(), ['mute rain']);
  turn(socket, 'Unmute rain');
  await expect.poll(commands).toEqual(['mute rain', 'Unmute rain']);
  socket = await nextSocket(socket);
  await listening();
  console.log('PASS background activation, same-sentence and separate-sentence commands, no eager execution or ambient commands, and one microphone');

  await page.bringToFront();
  await fixture().getByRole('button', { name: 'Float controls', exact: true }).click();
  await page.waitForFunction(() => window.voiceWindow?.document.querySelector('[aria-label="Floating voice controls"]'));
  const floating = context.pages().find(candidate => candidate !== page && candidate !== homework);
  assert.ok(floating, 'a real floating browser window opens');
  await floating.setViewportSize({ width: 360, height: 300 });
  await expect(floating.getByLabel('Hey agent', { exact: true })).toBeChecked();
  await floating.screenshot({ path: 'test-results/floating-voice.png' });
  await floating.getByRole('button', { name: 'Stop voice', exact: true }).click();
  await expect.poll(activeTracks).toBe(0);
  await expect(fixture().getByLabel('Hey agent', { exact: true })).not.toBeChecked();
  await floating.getByRole('button', { name: 'Talk to agent', exact: true }).click();
  await expect(floating.getByText(/^Listening ·/)).toBeVisible();
  await homework.bringToFront();
  if (!channel) await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  socket = sockets.at(-1).socket;
  turn(socket, 'mute rain');
  await expect.poll(commands).toEqual(['mute rain', 'Unmute rain', 'mute rain']);
  await expect.poll(activeTracks).toBe(0);
  console.log('PASS real floating window, shared mic controls and manual Talk continues while homework has focus');

  await floating.getByRole('button', { name: 'Talk to agent', exact: true }).click();
  await expect(floating.getByText(/^Listening ·/)).toBeVisible();
  turn(sockets.at(-1).socket, 'wait for update');
  await expect(floating.getByText('Understanding your command…', { exact: true })).toBeVisible();
  await floating.getByRole('button', { name: 'Close controls', exact: true }).click();
  await expect.poll(activeTracks).toBe(0);
  await expect(fixture().getByRole('button', { name: 'Talk to agent', exact: true })).toBeEnabled();
  await page.bringToFront();
  await fixture().getByLabel('Hey agent', { exact: true }).check(); socket = await listening();
  socket.send(JSON.stringify({ type: 'error' }));
  await expect(fixture().getByRole('alert')).toContainText('Cartesia');
  await expect(fixture().getByLabel('Hey agent', { exact: true })).not.toBeChecked();
  await expect.poll(activeTracks).toBe(0);

  await page.mouse.click(10, 10);
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.down('Space');
  await expect(fixture().getByText('Listening · release shortcut or click Stop · Esc cancels', { exact: true })).toBeVisible();
  await homework.bringToFront();
  if (!channel) await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(activeTracks).toBe(0);
  await page.keyboard.up('Space'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  await page.bringToFront();
  // Browsers without Document PiP retain a usable separate controller window.
  await page.evaluate(() => Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined }));
  await fixture().getByRole('button', { name: 'Float controls', exact: true }).click();
  await page.waitForFunction(() => window.voiceWindow?.document.querySelector('[aria-label="Floating voice controls"]'));
  const popup = context.pages().find(candidate => candidate !== page && candidate !== homework);
  assert.ok(popup);
  await popup.setViewportSize({ width: 360, height: 300 });
  await expect(popup.getByText('This window stays separate. Keep it beside your homework.', { exact: true })).toBeVisible();
  await popup.getByRole('button', { name: 'Close controls', exact: true }).click();
  await page.bringToFront();
  await page.evaluate(() => { window.open = () => null; });
  await fixture().getByRole('button', { name: 'Float controls', exact: true }).click();
  await expect(fixture().getByRole('alert')).toContainText('Allow the floating voice window');
  await fixture().getByLabel('Hey agent', { exact: true }).check(); await listening();
  await page.evaluate(() => window.voiceRoot.unmount());
  await expect.poll(activeTracks).toBe(0);
  assert.equal(await page.evaluate(() => window.voiceGain()), 1);
  await page.locator('#voice-fixture').evaluate(element => element.remove());
  await createFixtureRoom(page);
  await page.evaluate(() => {
    const controls = document.createElement('div'); controls.className = 'agent-controls';
    controls.style.height = '600px'; controls.textContent = 'Expanded voice controls';
    document.querySelector('.prompt-tools').append(controls);
  });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => window.__pixelRoom().bounds.bottom < document.querySelector('.room-controls').getBoundingClientRect().top - 4)).toBe(true);
  }
  assert.deepEqual(errors, []);
  console.log('PASS close/cancel/error/unmount cleanup and expanded voice controls fit mobile portrait and landscape');
} finally { await context.close(); await browser.close(); await server.close(); }
