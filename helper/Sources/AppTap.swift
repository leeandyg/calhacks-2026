import CoreAudio
import Foundation

/// A Core Audio process tap on one app's processes, mixed to mono and read through a private
/// aggregate device. It starts listen-only (the app still plays normally); setMuted(true) silences
/// the app's own output while the room plays it instead. Private taps and devices end with this
/// process, so a crashed helper never leaves an app muted.
final class AppTap {
  private(set) var sampleRate: Double = 48_000
  /// Each callback's samples (about 10 ms), on the queue given to init.
  var onSamples: (UnsafeBufferPointer<Float>) -> Void = { _ in }

  private let description: CATapDescription
  private var tapID = AudioObjectID(kAudioObjectUnknown)
  private var deviceID = AudioObjectID(kAudioObjectUnknown)
  private var procID: AudioDeviceIOProcID?
  private var sumOfSquares = 0.0
  private var sampleCount = 0

  init?(processes: [AudioObjectID], name: String, queue: DispatchQueue) {
    description = CATapDescription(monoMixdownOfProcesses: processes)
    description.uuid = UUID()
    description.isPrivate = true
    description.muteBehavior = .unmuted
    description.name = "Room Helper: \(name)"
    guard AudioHardwareCreateProcessTap(description, &tapID) == noErr else { return nil }
    var unknownFormat = AudioStreamBasicDescription()
    unknownFormat.mSampleRate = sampleRate
    sampleRate = readProperty(tapID, kAudioTapPropertyFormat, default: unknownFormat).mSampleRate

    let aggregate: [String: Any] = [
      kAudioAggregateDeviceNameKey: "Room Helper",
      kAudioAggregateDeviceUIDKey: UUID().uuidString,
      kAudioAggregateDeviceIsPrivateKey: true,
      kAudioAggregateDeviceTapAutoStartKey: true,
      kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: description.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]],
    ]
    guard AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &deviceID) == noErr,
          AudioDeviceCreateIOProcIDWithBlock(&procID, deviceID, queue, { [weak self] _, input, _, _, _ in self?.receive(input) }) == noErr,
          AudioDeviceStart(deviceID, procID) == noErr // the first run waits here for the permission prompt
    else {
      stop()
      return nil
    }
  }

  deinit { stop() }

  /// The level since the last call, in dBFS (-infinity if nothing arrived).
  func takeLevel() -> Double {
    defer { sumOfSquares = 0; sampleCount = 0 }
    return sampleCount > 0 ? 10 * log10(sumOfSquares / Double(sampleCount) + 1e-12) : -.infinity
  }

  /// Switches the existing tap between listen-only and muted, without a gap in the samples.
  func setMuted(_ muted: Bool) {
    description.muteBehavior = muted ? .muted : .unmuted
    var address = propertyAddress(kAudioTapPropertyDescription)
    var reference = description
    let status = withUnsafePointer(to: &reference) {
      AudioObjectSetPropertyData(tapID, &address, 0, nil, UInt32(MemoryLayout<CATapDescription>.size), $0)
    }
    if status != noErr { print("room-helper: could not \(muted ? "mute" : "unmute") a tapped app (\(status))") }
  }

  func stop() {
    if let procID {
      AudioDeviceStop(deviceID, procID)
      AudioDeviceDestroyIOProcID(deviceID, procID)
      self.procID = nil
    }
    if deviceID != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(deviceID) }
    if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
    deviceID = AudioObjectID(kAudioObjectUnknown)
    tapID = AudioObjectID(kAudioObjectUnknown)
  }

  private func receive(_ input: UnsafePointer<AudioBufferList>) {
    let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
    guard let buffer = buffers.first, let data = buffer.mData else { return }
    let samples = UnsafeBufferPointer(start: data.assumingMemoryBound(to: Float.self),
                                      count: Int(buffer.mDataByteSize) / MemoryLayout<Float>.size)
    for sample in samples { sumOfSquares += Double(sample * sample) }
    sampleCount += samples.count
    onSamples(samples)
  }
}
