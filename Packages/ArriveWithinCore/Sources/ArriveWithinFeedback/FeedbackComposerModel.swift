import Foundation
import Observation

public enum FeedbackComposerFailure: Equatable, Sendable {
  case notConfigured
  case offline
  case timedOut
  case rejected
  case invalidResponse
}

public enum FeedbackComposerPhase: Equatable, Sendable {
  case composing
  case previewing
  case sending
  case failed(FeedbackComposerFailure)
  case succeeded
}

@MainActor
@Observable
public final class FeedbackComposerModel {
  public var draft: FeedbackDraft
  public private(set) var phase: FeedbackComposerPhase = .composing
  public private(set) var previewReport: FeedbackReport?

  @ObservationIgnored private let submitter: any FeedbackSubmitting
  @ObservationIgnored private let makeReportID: @Sendable () -> UUID

  public init(
    submitter: any FeedbackSubmitting,
    draft: FeedbackDraft = FeedbackDraft(),
    makeReportID: @escaping @Sendable () -> UUID = UUID.init
  ) {
    self.submitter = submitter
    self.draft = draft
    self.makeReportID = makeReportID
  }

  public var isConfigured: Bool { submitter.isConfigured }
  public var validationIssue: FeedbackValidationIssue? { draft.validationIssue }
  public var canPreview: Bool { draft.validationIssue == nil && phase != .sending }
  public var isSending: Bool { phase == .sending }

  @discardableResult
  public func preparePreview(appContext: FeedbackAppContext) -> Bool {
    guard phase != .sending else { return false }
    do {
      previewReport = try draft.makeReport(
        reportID: makeReportID(),
        appContext: appContext
      )
      phase = .previewing
      return true
    } catch {
      previewReport = nil
      phase = .composing
      return false
    }
  }

  public func edit() {
    guard phase != .sending else { return }
    previewReport = nil
    phase = .composing
  }

  public func send() async {
    guard phase != .sending, let report = previewReport else { return }
    guard submitter.isConfigured else {
      phase = .failed(.notConfigured)
      return
    }
    phase = .sending
    do {
      _ = try await submitter.submit(report)
      phase = .succeeded
    } catch let error as FeedbackClientError {
      phase = .failed(Self.failure(for: error))
    } catch {
      phase = .failed(.invalidResponse)
    }
  }

  public func retry() async {
    guard case .failed = phase else { return }
    await send()
  }

  public func reset() {
    guard phase != .sending else { return }
    draft = FeedbackDraft()
    previewReport = nil
    phase = .composing
  }

  private static func failure(for error: FeedbackClientError) -> FeedbackComposerFailure {
    switch error {
    case .notConfigured:
      .notConfigured
    case .offline:
      .offline
    case .timedOut:
      .timedOut
    case .rejected:
      .rejected
    case .invalidReport, .requestTooLarge, .transportFailure, .invalidResponse, .mismatchedResponse:
      .invalidResponse
    }
  }
}
