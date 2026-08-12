@preconcurrency import AVFAudio
import ArriveWithinDomain
import CryptoKit
import Foundation

enum JournalAudioRecordingEvent: Equatable {
  case reachedMaximum(JournalAudioAttachment)
  case interrupted(JournalAudioAttachment?)
  case failed
}

enum JournalAudioRecordingError: Error, Equatable {
  case permissionDenied
  case alreadyRecording
  case couldNotCreateFile
  case emptyRecording
}

@MainActor
protocol JournalAudioRecordingControlling: AnyObject {
  var eventHandler: ((JournalAudioRecordingEvent) -> Void)? { get set }
  var isRecording: Bool { get }
  var elapsedMilliseconds: Int64 { get }

  func requestPermission() async -> Bool
  func start(fileURL: URL) throws
  func stop() throws -> JournalAudioAttachment
  func cancel()
}

@MainActor
final class NativeJournalAudioRecorder: NSObject, JournalAudioRecordingControlling {
  var eventHandler: ((JournalAudioRecordingEvent) -> Void)?

  private let audioSession: AVAudioSession
  private var recorder: AVAudioRecorder?
  private var outputURL: URL?
  private var recordedAt: Date?

  init(audioSession: AVAudioSession = .sharedInstance()) {
    self.audioSession = audioSession
    super.init()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleInterruption(_:)),
      name: AVAudioSession.interruptionNotification,
      object: audioSession
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  var isRecording: Bool { recorder?.isRecording == true }

  var elapsedMilliseconds: Int64 {
    Int64(((recorder?.currentTime ?? 0) * 1_000).rounded())
  }

  func requestPermission() async -> Bool {
    switch AVAudioApplication.shared.recordPermission {
    case .granted:
      return true
    case .denied:
      return false
    case .undetermined:
      return await withCheckedContinuation { continuation in
        AVAudioApplication.requestRecordPermission { granted in
          continuation.resume(returning: granted)
        }
      }
    @unknown default:
      return false
    }
  }

  func start(fileURL: URL) throws {
    guard recorder == nil else { throw JournalAudioRecordingError.alreadyRecording }
    guard AVAudioApplication.shared.recordPermission == .granted else {
      throw JournalAudioRecordingError.permissionDenied
    }
    try FileManager.default.createDirectory(
      at: fileURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try audioSession.setCategory(
      .record,
      mode: .measurement,
      options: [.allowBluetoothHFP]
    )
    try audioSession.setActive(true)
    let recorder = try AVAudioRecorder(
      url: fileURL,
      settings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 24_000,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 64_000,
        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
      ]
    )
    recorder.delegate = self
    recorder.isMeteringEnabled = true
    guard recorder.prepareToRecord(),
      recorder.record(forDuration: Double(JournalAudioAttachment.maximumDurationMilliseconds) / 1_000)
    else {
      try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)
      throw JournalAudioRecordingError.couldNotCreateFile
    }
    self.recorder = recorder
    outputURL = fileURL
    recordedAt = Date()
  }

  func stop() throws -> JournalAudioAttachment {
    guard let recorder else { throw JournalAudioRecordingError.emptyRecording }
    recorder.delegate = nil
    if recorder.isRecording { recorder.stop() }
    return try finalize(recorder: recorder)
  }

  func cancel() {
    let url = outputURL
    recorder?.delegate = nil
    recorder?.stop()
    recorder = nil
    outputURL = nil
    recordedAt = nil
    try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)
    if let url { try? FileManager.default.removeItem(at: url) }
  }

  private func finalize(recorder: AVAudioRecorder) throws -> JournalAudioAttachment {
    guard let outputURL, let recordedAt else {
      throw JournalAudioRecordingError.emptyRecording
    }
    let reportedDuration = max(0, recorder.currentTime)
    self.recorder = nil
    self.outputURL = nil
    self.recordedAt = nil
    try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)
    let data = try Data(contentsOf: outputURL)
    guard !data.isEmpty else {
      try? FileManager.default.removeItem(at: outputURL)
      throw JournalAudioRecordingError.emptyRecording
    }
    let audioFile = try AVAudioFile(forReading: outputURL)
    let fileDuration = Double(audioFile.length) / audioFile.processingFormat.sampleRate
    let duration = min(
      Double(JournalAudioAttachment.maximumDurationMilliseconds) / 1_000,
      max(reportedDuration, fileDuration)
    )
    guard duration > 0 else {
      try? FileManager.default.removeItem(at: outputURL)
      throw JournalAudioRecordingError.emptyRecording
    }
    let checksum = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    #if os(iOS)
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: outputURL.path
      )
    #endif
    return try JournalAudioAttachment(
      relativeFileName: outputURL.lastPathComponent,
      durationMilliseconds: max(1, Int64((duration * 1_000).rounded())),
      byteCount: Int64(data.count),
      checksumSHA256: checksum,
      recordedAt: recordedAt
    )
  }

  @objc private func handleInterruption(_ notification: Notification) {
    guard
      let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      AVAudioSession.InterruptionType(rawValue: rawType) == .began,
      let recorder
    else { return }
    recorder.delegate = nil
    if recorder.isRecording { recorder.stop() }
    do {
      eventHandler?(.interrupted(try finalize(recorder: recorder)))
    } catch {
      cancel()
      eventHandler?(.interrupted(nil))
    }
  }
}

extension NativeJournalAudioRecorder: AVAudioRecorderDelegate {
  nonisolated func audioRecorderDidFinishRecording(
    _ recorder: AVAudioRecorder,
    successfully flag: Bool
  ) {
    Task { @MainActor [weak self] in
      guard let self else { return }
      if flag {
        do {
          self.eventHandler?(.reachedMaximum(try self.finalize(recorder: recorder)))
        } catch {
          self.cancel()
          self.eventHandler?(.failed)
        }
      } else {
        self.cancel()
        self.eventHandler?(.failed)
      }
    }
  }

  nonisolated func audioRecorderEncodeErrorDidOccur(
    _ recorder: AVAudioRecorder,
    error: (any Error)?
  ) {
    Task { @MainActor [weak self] in
      self?.cancel()
      self?.eventHandler?(.failed)
    }
  }
}

@MainActor
final class UnavailableJournalAudioRecorder: JournalAudioRecordingControlling {
  var eventHandler: ((JournalAudioRecordingEvent) -> Void)?
  var isRecording: Bool { false }
  var elapsedMilliseconds: Int64 { 0 }
  func requestPermission() async -> Bool { false }
  func start(fileURL: URL) throws { throw JournalAudioRecordingError.permissionDenied }
  func stop() throws -> JournalAudioAttachment { throw JournalAudioRecordingError.emptyRecording }
  func cancel() {}
}

#if DEBUG
  @MainActor
  final class UITestJournalAudioRecorder: JournalAudioRecordingControlling {
    var eventHandler: ((JournalAudioRecordingEvent) -> Void)?
    private(set) var isRecording = false
    var elapsedMilliseconds: Int64 { isRecording ? 18_000 : 0 }

    func requestPermission() async -> Bool { true }

    func start(fileURL: URL) throws {
      _ = fileURL
      guard !isRecording else { throw JournalAudioRecordingError.alreadyRecording }
      isRecording = true
    }

    func stop() throws -> JournalAudioAttachment {
      guard isRecording else { throw JournalAudioRecordingError.emptyRecording }
      isRecording = false
      return try JournalAudioAttachment(
        relativeFileName: "synthetic-reflection.m4a",
        durationMilliseconds: 18_000,
        byteCount: 1_024,
        checksumSHA256: String(repeating: "0", count: 64),
        recordedAt: Date(timeIntervalSince1970: 1_786_320_000)
      )
    }

    func cancel() { isRecording = false }
  }
#endif
