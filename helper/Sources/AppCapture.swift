import CoreAudio
import Foundation

/// Decides which apps are in the room (#27), polled every half second.
///
/// - listening: an app runs audio output, so a listen-only tap measures how loud it is.
/// - live: it played real sound for about 3 of the last 4 s. The tap mutes the app and its audio
///   streams to the browser, which places it in the room. A ping or alert never lasts that long.
/// - ended: a listening app stops its output for 2 s, a live app stays silent for 60 s (a paused
///   song keeps its spot until then), the app quits, or no browser is connected.
///
/// Only regular apps count, never the browser the room plays in (tapping it would capture and mute
/// the soundscape itself), and never chat apps whose sounds are notifications.
final class AppCapture {
  static let pollSec = 0.5
  private static let loudDBFS = -50.0
  private static let promoteWindow = 8 // polls: the last 4 s
  private static let promoteLoud = 6 // of them loud: about 3 s of sound
  private static let listenIdlePolls = 4 // 2 s with output stopped
  private static let liveSilentPolls = 120 // 60 s of silence
  private static let ignored: Set<String> = [
    "com.tinyspeck.slackmacgap", "com.apple.MobileSMS", "com.apple.mail", "com.apple.FaceTime",
  ]

  private struct Tracked {
    let app: AudioApp
    let tap: AppTap
    var loud: [Bool] = []
    var idlePolls = 0
    var silentPolls = 0
    /// Set once live: the channel its audio frames carry.
    var channel: UInt32?
    var stream: String { "app:\(app.bundleID)" }
  }

  private let server: Server
  private let queue: DispatchQueue
  private var tracked: [String: Tracked] = [:] // by bundle ID
  private var apps: [pid_t: AudioApp?] = [:] // lookups by process, refreshed as processes come and go
  private var nextChannel: UInt32 = 1

  init(server: Server, queue: DispatchQueue) {
    self.server = server
    self.queue = queue
  }

  /// Tells a newly connected browser about the apps already in the room.
  func catchUp(_ client: Server.Client) {
    for entry in tracked.values where entry.channel != nil { server.send(startMessage(entry), to: [client]) }
  }

  func poll() {
    let subscribers = server.subscribers
    guard !subscribers.isEmpty else {
      for id in tracked.keys { end(id) }
      return
    }
    let browsers = Set(subscribers.compactMap(\.browser))

    var present = Set<String>()
    var playing: [String: (app: AudioApp, processes: [AudioObjectID])] = [:]
    var seen = Set<pid_t>()
    for process in audioProcesses() {
      seen.insert(process.pid)
      if apps[process.pid] == nil { apps[process.pid] = audioApp(for: process.pid) }
      guard let app = apps[process.pid] ?? nil else { continue }
      present.insert(app.bundleID)
      guard process.isRunningOutput, !browsers.contains(app.pid), !Self.ignored.contains(app.bundleID) else { continue }
      playing[app.bundleID, default: (app, [])].processes.append(process.objectID)
    }
    apps = apps.filter { seen.contains($0.key) }

    for (id, entry) in playing where tracked[id] == nil {
      guard let tap = AppTap(processes: entry.processes, name: entry.app.name, queue: queue) else {
        print("room-helper: could not tap \(entry.app.name)")
        continue
      }
      tap.onSamples = { [weak self] samples in self?.forward(id, samples) }
      tracked[id] = Tracked(app: entry.app, tap: tap)
    }

    for (id, var entry) in tracked {
      guard present.contains(id), !browsers.contains(entry.app.pid) else {
        end(id)
        continue
      }
      let loud = entry.tap.takeLevel() > Self.loudDBFS
      entry.loud = Array((entry.loud + [loud]).suffix(Self.promoteWindow))
      if entry.channel == nil {
        entry.idlePolls = playing[id] == nil ? entry.idlePolls + 1 : 0
        if entry.idlePolls >= Self.listenIdlePolls {
          end(id)
          continue
        }
        if entry.loud.filter({ $0 }).count >= Self.promoteLoud {
          entry.channel = nextChannel
          nextChannel += 1
          entry.tap.setMuted(true)
          server.send(startMessage(entry), to: subscribers)
          print("room-helper: \(entry.app.name) is in the room")
        }
      } else {
        entry.silentPolls = loud ? 0 : entry.silentPolls + 1
        if entry.silentPolls >= Self.liveSilentPolls {
          end(id)
          continue
        }
      }
      tracked[id] = entry
    }
  }

  private func startMessage(_ entry: Tracked) -> [String: Any] {
    ["type": "start", "stream": entry.stream, "channel": entry.channel ?? 0, "name": entry.app.name, "sampleRate": entry.tap.sampleRate]
  }

  private func end(_ id: String) {
    guard let entry = tracked.removeValue(forKey: id) else { return }
    entry.tap.stop() // unmutes the app
    if entry.channel != nil {
      server.send(["type": "stop", "stream": entry.stream], to: server.subscribers)
      print("room-helper: \(entry.app.name) left the room")
    }
  }

  private func forward(_ id: String, _ samples: UnsafeBufferPointer<Float>) {
    guard var channel = tracked[id]?.channel else { return }
    var frame = Data(bytes: &channel, count: MemoryLayout<UInt32>.size) // little-endian on every Mac
    frame.append(UnsafeBufferPointer(start: UnsafeRawPointer(samples.baseAddress!).assumingMemoryBound(to: UInt8.self),
                                     count: samples.count * MemoryLayout<Float>.size))
    server.sendAudio(frame, to: server.subscribers)
  }
}
