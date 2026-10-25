import Foundation
import Network

/// A WebSocket server on the loopback interface for the web app (#26).
///
/// Browser -> helper (text): {"type":"subscribe"} once the room's audio runs.
/// Helper -> browser (text): {"type":"start","stream","channel","name","sampleRate"} and {"type":"stop","stream"}.
/// Helper -> browser (binary): a little-endian UInt32 channel, then mono float32 samples.
final class Server {
  final class Client {
    let connection: NWConnection
    /// The app this client's page runs in (its browser), which must never be tapped. Set on subscribe.
    var browser: pid_t?
    var subscribed: Bool { browser != nil }
    fileprivate var pendingAudio = 0
    init(connection: NWConnection) { self.connection = connection }
  }

  /// Called on the queue when a client subscribes (to catch it up) and when one leaves.
  var onSubscribe: (Client) -> Void = { _ in }
  var onDisconnect: () -> Void = {}
  var subscribers: [Client] { clients.values.filter(\.subscribed) }

  private let listener: NWListener
  private let queue: DispatchQueue
  private var clients: [ObjectIdentifier: Client] = [:]
  private static let maxPendingAudio = 32 // about 0.3 s; a stalled page drops audio instead of queueing it

  init(port: UInt16, queue: DispatchQueue) throws {
    self.queue = queue
    let webSocket = NWProtocolWebSocket.Options()
    webSocket.autoReplyPing = true
    // Only our own pages may listen: any other site could otherwise record your apps.
    webSocket.setClientRequestHandler(queue) { _, headers in
      let origin = headers.first { $0.name.lowercased() == "origin" }?.value ?? ""
      let allowed = Server.isAllowed(origin: origin)
      if !allowed { print("room-helper: refused a connection from \(origin.isEmpty ? "an unknown origin" : origin)") }
      return NWProtocolWebSocket.Response(status: allowed ? .accept : .reject, subprotocol: nil)
    }
    let parameters = NWParameters.tcp
    parameters.defaultProtocolStack.applicationProtocols.insert(webSocket, at: 0)
    parameters.requiredInterfaceType = .loopback
    parameters.allowLocalEndpointReuse = true
    listener = try NWListener(using: parameters, on: NWEndpoint.Port(rawValue: port)!)
  }

  static func isAllowed(origin: String) -> Bool {
    guard let url = URL(string: origin), let host = url.host else { return false }
    if url.scheme == "http" && (host == "localhost" || host == "127.0.0.1") { return true }
    guard url.scheme == "https" else { return false }
    // The roomto.study domain, production and Vercel previews
    if host == "roomto.study" || host.hasSuffix(".roomto.study") { return true }
    return host.hasPrefix("calhacks-2026") && host.hasSuffix(".vercel.app")
  }

  func start() {
    listener.stateUpdateHandler = { state in
      if case .failed(let error) = state {
        print("room-helper: could not listen: \(error)")
        exit(1)
      }
    }
    listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
    listener.start(queue: queue)
  }

  func send(_ message: [String: Any], to clients: [Client]) {
    guard let data = try? JSONSerialization.data(withJSONObject: message) else { return }
    let context = NWConnection.ContentContext(identifier: "text", metadata: [NWProtocolWebSocket.Metadata(opcode: .text)])
    for client in clients {
      client.connection.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { _ in })
    }
  }

  func sendAudio(_ data: Data, to clients: [Client]) {
    let context = NWConnection.ContentContext(identifier: "audio", metadata: [NWProtocolWebSocket.Metadata(opcode: .binary)])
    for client in clients where client.pendingAudio < Server.maxPendingAudio {
      client.pendingAudio += 1
      client.connection.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { _ in
        client.pendingAudio -= 1
      })
    }
  }

  private func accept(_ connection: NWConnection) {
    let client = Client(connection: connection)
    let id = ObjectIdentifier(client)
    clients[id] = client
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .failed, .cancelled: self?.remove(id)
      default: break
      }
    }
    connection.start(queue: queue)
    receive(client)
  }

  private func remove(_ id: ObjectIdentifier) {
    guard let client = clients.removeValue(forKey: id) else { return }
    client.connection.cancel()
    if client.subscribed { print("room-helper: browser disconnected") }
    onDisconnect()
  }

  private func receive(_ client: Client) {
    client.connection.receiveMessage { [weak self] data, context, _, error in
      guard let self else { return }
      if error != nil { return self.remove(ObjectIdentifier(client)) }
      let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
      if metadata?.opcode == .close { return self.remove(ObjectIdentifier(client)) }
      if metadata?.opcode == .text, let data,
         let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
         message["type"] as? String == "subscribe", !client.subscribed {
        self.subscribe(client)
      }
      self.receive(client)
    }
  }

  /// Finds the browser at the other end of the socket before streaming anything to it.
  private func subscribe(_ client: Client) {
    guard case .hostPort(_, let port) = client.connection.endpoint else { return }
    DispatchQueue.global().async {
      let browser = peerPid(localPort: port.rawValue).map(responsiblePid)
      self.queue.async {
        guard self.clients[ObjectIdentifier(client)] != nil else { return }
        guard let browser else {
          print("room-helper: could not tell which browser connected, so not capturing for it")
          return
        }
        client.browser = browser
        print("room-helper: browser connected (\(appName(browser)))")
        self.onSubscribe(client)
      }
    }
  }
}

/// The process that owns the other end of a loopback TCP connection, from its port.
private func peerPid(localPort port: UInt16) -> pid_t? {
  let lsof = Process()
  lsof.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
  lsof.arguments = ["-t", "-nP", "-iTCP:\(port)", "-sTCP:ESTABLISHED"]
  let output = Pipe()
  lsof.standardOutput = output
  lsof.standardError = FileHandle.nullDevice
  guard (try? lsof.run()) != nil else { return nil }
  let data = output.fileHandleForReading.readDataToEndOfFile()
  lsof.waitUntilExit()
  // Both ends match the port; ours is the helper itself.
  return String(decoding: data, as: UTF8.self).split(separator: "\n").compactMap { pid_t($0) }.first { $0 != getpid() }
}
