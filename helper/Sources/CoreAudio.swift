import CoreAudio
import Foundation

// Small wrappers around the Core Audio hardware (HAL) property API.

func propertyAddress(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}

/// A fixed-size property value, or the fallback if the object doesn't have it (or is gone).
func readProperty<T>(_ id: AudioObjectID, _ selector: AudioObjectPropertySelector, default fallback: T) -> T {
  var address = propertyAddress(selector)
  var size = UInt32(MemoryLayout<T>.size)
  var value = fallback
  let status = withUnsafeMutableBytes(of: &value) { AudioObjectGetPropertyData(id, &address, 0, nil, &size, $0.baseAddress!) }
  return status == noErr ? value : fallback
}

/// One process that Core Audio knows about, i.e. one that plays or records audio.
struct AudioProcess {
  let objectID: AudioObjectID
  let pid: pid_t
  /// True while the process runs audio output. A ping sets it briefly; music keeps it on.
  let isRunningOutput: Bool
}

func audioProcesses() -> [AudioProcess] {
  let system = AudioObjectID(kAudioObjectSystemObject)
  var address = propertyAddress(kAudioHardwarePropertyProcessObjectList)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr else { return [] }
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(system, &address, 0, nil, &size, &ids) == noErr else { return [] }
  return ids.map { id in
    AudioProcess(
      objectID: id,
      pid: readProperty(id, kAudioProcessPropertyPID, default: pid_t(-1)),
      isRunningOutput: readProperty(id, kAudioProcessPropertyIsRunningOutput, default: UInt32(0)) != 0
    )
  }
}
