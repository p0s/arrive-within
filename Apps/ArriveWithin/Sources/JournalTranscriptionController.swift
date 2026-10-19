@preconcurrency import Speech
import ArriveWithinDomain
import Foundation

enum JournalTranscriptionError: Error, Equatable {
  case permissionDenied
  case recognizerUnavailable
  case onDeviceRecognitionUnavailable
  case emptyResult
  case recognitionFailed
}

@MainActor
protocol JournalTranscribing: AnyObject {
  func transcribe(audioURL: URL, localeIdentifier: String) async throws -> JournalTranscript
}

@MainActor
final class NativeOnDeviceJournalTranscriber: JournalTranscribing {
  func transcribe(audioURL: URL, localeIdentifier: String) async throws -> JournalTranscript {
    guard await requestPermission() else { throw JournalTranscriptionError.permissionDenied }
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier)) else {
      throw JournalTranscriptionError.recognizerUnavailable
    }
    guard recognizer.isAvailable else { throw JournalTranscriptionError.recognizerUnavailable }
    guard recognizer.supportsOnDeviceRecognition else {
      throw JournalTranscriptionError.onDeviceRecognitionUnavailable
    }

    let request = SFSpeechURLRecognitionRequest(url: audioURL)
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = false
    request.taskHint = .dictation
    let text: String = try await withCheckedThrowingContinuation { continuation in
      let gate = SpeechContinuationGate(continuation: continuation)
      recognizer.recognitionTask(with: request) { result, error in
        if let error {
          gate.finish(.failure(error))
        } else if let result, result.isFinal {
          gate.finish(.success(result.bestTranscription.formattedString))
        }
      }
    }
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw JournalTranscriptionError.emptyResult
    }
    return try JournalTranscript(
      text: text,
      localeIdentifier: localeIdentifier,
      generatedAt: Date()
    )
  }

  private func requestPermission() async -> Bool {
    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized:
      return true
    case .denied, .restricted:
      return false
    case .notDetermined:
      return await withCheckedContinuation { continuation in
        SFSpeechRecognizer.requestAuthorization { status in
          continuation.resume(returning: status == .authorized)
        }
      }
    @unknown default:
      return false
    }
  }
}

private final class SpeechContinuationGate: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<String, any Error>?

  init(continuation: CheckedContinuation<String, any Error>) {
    self.continuation = continuation
  }

  func finish(_ result: Result<String, any Error>) {
    let continuation = lock.withLock {
      defer { self.continuation = nil }
      return self.continuation
    }
    continuation?.resume(with: result)
  }
}

@MainActor
final class UnavailableJournalTranscriber: JournalTranscribing {
  func transcribe(audioURL: URL, localeIdentifier: String) async throws -> JournalTranscript {
    throw JournalTranscriptionError.onDeviceRecognitionUnavailable
  }
}
