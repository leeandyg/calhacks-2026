// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "RoomHelper",
  platforms: [.macOS("14.2")], // Core Audio process taps
  targets: [
    .executableTarget(
      name: "room-helper",
      path: "Sources",
      linkerSettings: [
        // Taps need NSAudioCaptureUsageDescription, and a command-line tool has no bundle, so embed
        // the Info.plist in the binary.
        .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist",
                      "-Xlinker", Context.packageDirectory + "/Info.plist"]),
      ]
    ),
  ]
)
