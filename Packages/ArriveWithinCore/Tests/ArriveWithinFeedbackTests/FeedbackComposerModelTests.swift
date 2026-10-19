import Foundation
import XCTest
@testable import ArriveWithinFeedback

@MainActor
final class FeedbackComposerModelTests: XCTestCase {
  func testPreviewIsAnImmutableExactReportAndEditingCreatesANewReportID() throws {
    let firstID = try XCTUnwrap(UUID(uuidString: "11111111-1111-4111-8111-111111111111"))
    let secondID = try XCTUnwrap(UUID(uuidString: "22222222-2222-4222-8222-222222222222"))
    let ids = LockedIDs([firstID, secondID])
    let model = FeedbackComposerModel(
      submitter: ImmediateSubmitter(),
      makeReportID: { ids.next() }
    )
    model.draft.message = "  Keep the preview exact.  "
    model.draft.replyEmail = "reply@example.org"
    model.draft.includesAppContext = true

    XCTAssertTrue(model.preparePreview(appContext: Self.context))
    XCTAssertEqual(model.previewReport?.reportID, firstID.uuidString.lowercased())
    XCTAssertEqual(model.previewReport?.message, "Keep the preview exact.")
    XCTAssertEqual(model.previewReport?.appContext, Self.context)

    model.edit()
    model.draft.message = "A revised report."
    XCTAssertTrue(model.preparePreview(appContext: Self.context))
    XCTAssertEqual(model.previewReport?.reportID, secondID.uuidString.lowercased())
    XCTAssertEqual(model.previewReport?.message, "A revised report.")
  }

  func testRetryReusesTheSameReportIDAndPayload() async throws {
    let submitter = FailOnceSubmitter()
    let fixedID = try XCTUnwrap(UUID(uuidString: "33333333-3333-4333-8333-333333333333"))
    let model = FeedbackComposerModel(submitter: submitter, makeReportID: { fixedID })
    model.draft.message = "Please retry this exact report."
    XCTAssertTrue(model.preparePreview(appContext: Self.context))

    await model.send()
    XCTAssertEqual(model.phase, .failed(.offline))
    await model.retry()
    XCTAssertEqual(model.phase, .succeeded)

    let reports = await submitter.submittedReports()
    XCTAssertEqual(reports.count, 2)
    XCTAssertEqual(reports[0], reports[1])
    XCTAssertEqual(reports[0].reportID, fixedID.uuidString.lowercased())
  }

  func testDuplicateSendWhileRequestIsInFlightIsIgnored() async throws {
    let submitter = SuspendedSubmitter()
    let model = FeedbackComposerModel(submitter: submitter)
    model.draft.message = "Only one request should be in flight."
    XCTAssertTrue(model.preparePreview(appContext: Self.context))

    let first = Task { await model.send() }
    await submitter.waitUntilStarted()
    XCTAssertEqual(model.phase, .sending)
    await model.send()
    let inFlightCallCount = await submitter.callCount()
    XCTAssertEqual(inFlightCallCount, 1)
    await submitter.release()
    await first.value
    XCTAssertEqual(model.phase, .succeeded)
  }

  func testUnconfiguredSubmissionFailsClosedWithoutCallingTransport() async {
    let submitter = UnconfiguredSubmitter()
    let model = FeedbackComposerModel(submitter: submitter)
    model.draft.message = "Keep this local when no endpoint exists."
    XCTAssertTrue(model.preparePreview(appContext: Self.context))

    await model.send()
    XCTAssertEqual(model.phase, .failed(.notConfigured))
    let callCount = await submitter.callCount()
    XCTAssertEqual(callCount, 0)
  }

  private static let context = FeedbackAppContext(
    appVersion: "1.0",
    build: "1",
    operatingSystemVersion: "26.6",
    locale: "de_DE"
  )
}

private final class LockedIDs: @unchecked Sendable {
  private let lock = NSLock()
  private var values: [UUID]

  init(_ values: [UUID]) { self.values = values }

  func next() -> UUID {
    lock.withLock { values.removeFirst() }
  }
}

private actor ImmediateSubmitter: FeedbackSubmitting {
  nonisolated let isConfigured = true

  func submit(_ report: FeedbackReport) async throws -> FeedbackSubmissionResponse {
    FeedbackSubmissionResponse(reportID: report.reportID, status: "accepted")
  }
}

private actor FailOnceSubmitter: FeedbackSubmitting {
  nonisolated let isConfigured = true
  private var reports: [FeedbackReport] = []

  func submit(_ report: FeedbackReport) async throws -> FeedbackSubmissionResponse {
    reports.append(report)
    if reports.count == 1 { throw FeedbackClientError.offline }
    return FeedbackSubmissionResponse(reportID: report.reportID, status: "accepted")
  }

  func submittedReports() -> [FeedbackReport] { reports }
}

private actor SuspendedSubmitter: FeedbackSubmitting {
  nonisolated let isConfigured = true
  private var calls = 0
  private var didStart = false
  private var startWaiters: [CheckedContinuation<Void, Never>] = []
  private var releaseContinuation: CheckedContinuation<Void, Never>?

  func submit(_ report: FeedbackReport) async throws -> FeedbackSubmissionResponse {
    calls += 1
    didStart = true
    let waiters = startWaiters
    startWaiters.removeAll()
    waiters.forEach { $0.resume() }
    await withCheckedContinuation { continuation in
      releaseContinuation = continuation
    }
    return FeedbackSubmissionResponse(reportID: report.reportID, status: "accepted")
  }

  func waitUntilStarted() async {
    if didStart { return }
    await withCheckedContinuation { continuation in
      startWaiters.append(continuation)
    }
  }

  func release() {
    releaseContinuation?.resume()
    releaseContinuation = nil
  }

  func callCount() -> Int { calls }
}

private actor UnconfiguredSubmitter: FeedbackSubmitting {
  nonisolated let isConfigured = false
  private var calls = 0

  func submit(_ report: FeedbackReport) async throws -> FeedbackSubmissionResponse {
    calls += 1
    throw FeedbackClientError.notConfigured
  }

  func callCount() -> Int { calls }
}
