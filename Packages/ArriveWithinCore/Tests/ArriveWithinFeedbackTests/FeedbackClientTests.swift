import Foundation
import XCTest
@testable import ArriveWithinFeedback

final class FeedbackClientTests: XCTestCase {
  func testProductionEndpointRejectsUnsafeAndPlaceholderValues() {
    let rejected = [
      nil,
      "",
      "$(ARRIVE_WITHIN_FEEDBACK_ENDPOINT_URL)",
      "http://feedback.arrivewithin.org/v1/reports",
      "https://localhost/v1/reports",
      "https://127.0.0.1/v1/reports",
      "https://127.1/v1/reports",
      "https://0177.0.0.1/v1/reports",
      "https://10.0.0.8/v1/reports",
      "https://feedback_arrivewithin.org/v1/reports",
      "https://feedback.arrivewithin.org/v1/other",
      "https://feedback.arrivewithin.org/v1/reports/",
      "https://feedback.example/v1/reports",
      "https://feedback.arrivewithin.org/",
      "https://feedback.arrivewithin.org/v1/reports?token=secret",
    ]
    for value in rejected {
      XCTAssertNil(
        FeedbackEndpointConfiguration.productionEndpointURL(from: value),
        "Unexpectedly accepted \(value ?? "nil")"
      )
    }
    XCTAssertEqual(
      FeedbackEndpointConfiguration.productionEndpointURL(
        from: "https://feedback.arrivewithin.org/v1/reports"
      )?.absoluteString,
      "https://feedback.arrivewithin.org/v1/reports"
    )
  }

  func testDraftValidatesMessageAndOptionalReplyEmail() throws {
    XCTAssertEqual(FeedbackDraft().validationIssue, .emptyMessage)
    XCTAssertEqual(
      FeedbackDraft(message: String(repeating: "a", count: 4_001)).validationIssue,
      .messageTooLong
    )
    XCTAssertEqual(
      FeedbackDraft(message: "A thought", replyEmail: "not-an-email").validationIssue,
      .invalidEmail
    )

    let report = try FeedbackDraft(
      message: "  A calm suggestion.  ",
      replyEmail: "  hello@example.org  ",
      includesAppContext: false
    ).makeReport(reportID: UUID(), appContext: Self.context)
    XCTAssertEqual(report.message, "A calm suggestion.")
    XCTAssertEqual(report.replyEmail, "hello@example.org")
    XCTAssertNil(report.appContext)
  }

  func testClientPostsOnlyAllowlistedFieldsAndNoStoreHeaders() async throws {
    let reportID = try XCTUnwrap(UUID(uuidString: "11111111-2222-4333-8444-555555555555"))
    let report = try FeedbackDraft(
      message: "The monthly view helped me notice a gentle rhythm.",
      replyEmail: "reply@example.org",
      includesAppContext: true
    ).makeReport(reportID: reportID, appContext: Self.context)
    let transport = RecordingTransport(
      response: FeedbackHTTPResponse(
        data: Data(#"{"reportId":"11111111-2222-4333-8444-555555555555","status":"accepted"}"#.utf8),
        statusCode: 202
      )
    )
    let client = FeedbackClient(
      configuration: FeedbackEndpointConfiguration(
        endpointURL: URL(string: "https://feedback.arrivewithin.org/v1/reports")
      ),
      transport: transport
    )

    let response = try await client.submit(report)
    XCTAssertEqual(response.reportID, report.reportID)
    let capturedRequest = await transport.firstRequest()
    let request = try XCTUnwrap(capturedRequest)
    XCTAssertEqual(request.httpMethod, "POST")
    XCTAssertEqual(request.value(forHTTPHeaderField: "Cache-Control"), "no-store")
    XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), report.reportID)

    let body = try XCTUnwrap(request.httpBody)
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
    XCTAssertEqual(Set(object.keys), ["app", "appContext", "category", "message", "replyEmail", "reportId"])
    XCTAssertEqual(object["app"] as? String, FeedbackContract.appName)
    XCTAssertEqual(object["category"] as? String, FeedbackContract.category)
    let context = try XCTUnwrap(object["appContext"] as? [String: Any])
    XCTAssertEqual(
      Set(context.keys),
      ["appVersion", "build", "locale", "operatingSystemVersion"]
    )
    let encoded = String(decoding: body, as: UTF8.self)
    for forbidden in [
      "journal", "transcript", "audio", "renderer", "screenshot", "clipboard", "deviceId",
      "userId", "cloudKit", "credential", "log",
    ] {
      XCTAssertFalse(encoded.localizedCaseInsensitiveContains(forbidden))
    }
  }

  func testOptionalFieldsAreOmittedRatherThanSentAsEmptyValues() async throws {
    let reportID = try XCTUnwrap(UUID(uuidString: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"))
    let report = try FeedbackDraft(message: "A small suggestion.").makeReport(
      reportID: reportID,
      appContext: Self.context
    )
    let transport = RecordingTransport(
      response: FeedbackHTTPResponse(
        data: Data(#"{"reportId":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","status":"accepted"}"#.utf8),
        statusCode: 200
      )
    )
    let client = FeedbackClient(
      configuration: FeedbackEndpointConfiguration(
        endpointURL: URL(string: "https://feedback.arrivewithin.org/v1/reports")
      ),
      transport: transport
    )

    _ = try await client.submit(report)
    let capturedRequest = await transport.firstRequest()
    let request = try XCTUnwrap(capturedRequest)
    let body = try XCTUnwrap(request.httpBody)
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
    XCTAssertNil(object["replyEmail"])
    XCTAssertNil(object["appContext"])
  }

  func testClientMapsOfflineTimeoutRejectionAndMismatchedResponses() async throws {
    let reportID = try XCTUnwrap(UUID(uuidString: "abcdefab-cdef-4abc-8def-abcdefabcdef"))
    let report = try FeedbackDraft(message: "A bounded report.").makeReport(
      reportID: reportID,
      appContext: Self.context
    )
    let endpoint = FeedbackEndpointConfiguration(
      endpointURL: URL(string: "https://feedback.arrivewithin.org/v1/reports")
    )

    for (failure, expected) in [
      (URLError(.notConnectedToInternet), FeedbackClientError.offline),
      (URLError(.timedOut), FeedbackClientError.timedOut),
    ] {
      let client = FeedbackClient(
        configuration: endpoint,
        transport: ThrowingTransport(error: failure)
      )
      do {
        _ = try await client.submit(report)
        XCTFail("Expected \(expected)")
      } catch let error as FeedbackClientError {
        XCTAssertEqual(error, expected)
      }
    }

    let rejected = FeedbackClient(
      configuration: endpoint,
      transport: RecordingTransport(
        response: FeedbackHTTPResponse(data: Data(), statusCode: 429)
      )
    )
    do {
      _ = try await rejected.submit(report)
      XCTFail("Expected rejection")
    } catch let error as FeedbackClientError {
      XCTAssertEqual(error, .rejected(statusCode: 429))
    }

    let mismatched = FeedbackClient(
      configuration: endpoint,
      transport: RecordingTransport(
        response: FeedbackHTTPResponse(
          data: Data(#"{"reportId":"ffffffff-ffff-4fff-8fff-ffffffffffff","status":"accepted"}"#.utf8),
          statusCode: 202
        )
      )
    )
    do {
      _ = try await mismatched.submit(report)
      XCTFail("Expected mismatched response")
    } catch let error as FeedbackClientError {
      XCTAssertEqual(error, .mismatchedResponse)
    }
  }

  private static let context = FeedbackAppContext(
    appVersion: "1.0",
    build: "1",
    operatingSystemVersion: "26.6",
    locale: "en_US"
  )
}

private actor RecordingTransport: FeedbackTransport {
  private let response: FeedbackHTTPResponse
  private var requests: [URLRequest] = []

  init(response: FeedbackHTTPResponse) {
    self.response = response
  }

  func send(_ request: URLRequest) async throws -> FeedbackHTTPResponse {
    requests.append(request)
    return response
  }

  func firstRequest() -> URLRequest? { requests.first }
}

private struct ThrowingTransport: FeedbackTransport {
  let error: URLError

  func send(_ request: URLRequest) async throws -> FeedbackHTTPResponse {
    throw error
  }
}
