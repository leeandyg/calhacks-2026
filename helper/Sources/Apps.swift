import AppKit

/// The app a process plays audio for. Browsers and Electron apps play through helper processes
/// (Chrome's audio service, Safari's WebKit GPU process), so processes are grouped by the app macOS
/// holds responsible for them, the same attribution privacy prompts use.
struct AudioApp {
  let pid: pid_t
  let bundleID: String
  let name: String
}

private typealias ResponsibleFunction = @convention(c) (pid_t) -> pid_t
// Not in the public headers, but exported by libsystem and stable for years.
private let responsibleFunction: ResponsibleFunction? =
  dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_get_pid_responsible_for_pid") // RTLD_DEFAULT
    .map { unsafeBitCast($0, to: ResponsibleFunction.self) }

func responsiblePid(_ pid: pid_t) -> pid_t {
  let owner = responsibleFunction?(pid) ?? -1
  return owner > 0 ? owner : pid
}

/// The regular (Dock) app responsible for a process, or nil for daemons and system sound services.
func audioApp(for pid: pid_t) -> AudioApp? {
  let owner = responsiblePid(pid)
  guard let app = NSRunningApplication(processIdentifier: owner), app.activationPolicy == .regular,
        let bundleID = app.bundleIdentifier else { return nil }
  return AudioApp(pid: owner, bundleID: bundleID, name: app.localizedName ?? bundleID)
}

func appName(_ pid: pid_t) -> String {
  NSRunningApplication(processIdentifier: pid)?.localizedName ?? "pid \(pid)"
}
