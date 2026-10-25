# Room Helper (macOS)

A small command-line helper that brings audio from other Mac apps into the room. When Spotify,
Music or a video in another browser plays, it shows up in the room as a live speaker you can drag,
and the app's own output is muted so you hear it only from that spot. Optional: the web app
works without it.

Needs macOS 14.2 or later and the Swift toolchain (the Xcode command-line tools are enough).

## Build and run

```sh
cd helper
swift build -c release
.build/release/room-helper
```

Leave it running, then open the room (`npm run dev`, or the live site) in Chrome and create a
room. The helper prints `browser connected`, and an app joins about 3 s after it starts playing.
Stop it with Ctrl+C; any tapped app plays normally again.

**Live site:** Chrome asks once to let the page reach this device's local network; allow it (site
settings, left of the URL). uBlock Origin's "Block Outsider Intrusion into LAN" list also blocks the
connection, so turn uBlock off for the site. Pages on `localhost` need neither.

**Permission:** the first capture asks to record system audio, attributed to the app you
launched the helper from (Terminal, iTerm or VS Code). Allow it, or turn it on later in System
Settings → Privacy & Security → Screen & System Audio Recording → System Audio Recording Only. Until
then, the helper waits at its first capture.

## Which apps join the room

- An app joins after playing real sound for about 3 of the last 4 seconds, so notification pings
  never do. Chat and mail apps (Slack, Messages, Mail, FaceTime) are ignored.
- A paused app keeps its spot. It leaves after 60 s of silence, when it quits, or when the room's
  browser disconnects.
- The browser the room runs in is never captured: Chrome plays all tabs through one process, so
  a video in the *same* browser can't be separated. Play it in another browser or app.
- Only regular apps count, not command-line tools or system sounds.

## Protocol

`ws://127.0.0.1:47800`, loopback only. Only pages from `localhost`, `127.0.0.1` or the project's
Vercel domains may connect.

| Direction | Message |
| --- | --- |
| browser → helper | `{"type":"subscribe"}` once the room's audio runs |
| helper → browser | `{"type":"start","stream":"app:com.spotify.client","channel":1,"name":"Spotify","sampleRate":48000}` |
| helper → browser | `{"type":"stop","stream":"app:com.spotify.client"}` |
| helper → browser | binary: a little-endian `UInt32` channel, then mono float32 samples (512 per frame at 48 kHz) |

The browser side is `src/audio/live.ts`: each stream becomes a `live` sound object in the scene.
