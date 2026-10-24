import Foundation

// Room Helper (#26, #27): finds Mac apps playing sustained audio (Spotify, Music, a video in
// another browser), taps them and streams them to the web app, where each becomes a live sound
// object you can drag around the room (#28). See helper/README.md.

setvbuf(stdout, nil, _IOLBF, 0) // print each line, even into a log file
let port: UInt16 = 47800
let queue = DispatchQueue(label: "room-helper")
let server = try Server(port: port, queue: queue)
server.start()

print("room-helper: waiting for the room on ws://127.0.0.1:\(port)")
dispatchMain()
