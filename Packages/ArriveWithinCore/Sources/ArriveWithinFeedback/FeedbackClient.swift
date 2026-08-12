import Foundation

public struct FeedbackEndpointConfiguration: Equatable, Sendable {
  public static let infoKey = "ArriveWithinFeedbackEndpointURL"

  public let endpointURL: URL?

  public init(endpointURL: URL?) {
    self.endpointURL = endpointURL
  }

  public static func bundled(bundle: Bundle = .main) -> Self {
    let rawValue = bundle.object(forInfoDictionaryKey: infoKey) as? String
    return Self(endpointURL: productionEndpointURL(from: rawValue))
  }

  public static func productionEndpointURL(from rawValue: String?) -> URL? {
    guard let rawValue else { return nil }
    let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard
      !trimmed.isEmpty,
      !trimmed.contains("$("),
      !trimmed.contains("${"),
      let components = URLComponents(string: trimmed),
      components.scheme?.lowercased() == "https",
      components.user == nil,
      components.password == nil,
      components.query == nil,
      components.fragment == nil,
      components.port == nil || components.port == 443,
      let host = components.host?.lowercased(),
      isPublicHost(host),
      components.percentEncodedPath == "/v1/reports",
      let url = components.url
    else {
      return nil
    }
    return url
  }

  private static func isPublicHost(_ host: String) -> Bool {
    let reservedHosts = ["localhost", "example.com", "example.net", "example.org"]
    guard !reservedHosts.contains(host), !host.hasSuffix(".local"), !host.hasSuffix(".localhost")
    else { return false }
    let reservedSuffixes = [".example", ".invalid", ".test"]
    guard !reservedSuffixes.contains(where: host.hasSuffix) else { return false }

    guard host.count <= 253, !host.contains(":") else { return false }
    let labels = host.split(separator: ".", omittingEmptySubsequences: false)
    guard labels.count >= 2,
      labels.allSatisfy({ label in
        (1...63).contains(label.count)
          && label.first != "-"
          && label.last != "-"
          && label.allSatisfy { character in
            character.isASCII && (character.isLetter || character.isNumber || character == "-")
          }
      }),
      let topLevelLabel = labels.last,
      topLevelLabel.count >= 2,
      topLevelLabel.contains(where: { $0.isASCII && $0.isLetter })
    else { return false }

    let components = host.split(separator: ".").compactMap { Int($0) }
    if components.count == 4, components.allSatisfy({ (0...255).contains($0) }) {
      let a = components[0]
      let b = components[1]
      if a == 0 || a == 10 || a == 127 || a >= 224 { return false }
      if a == 100 && (64...127).contains(b) { return false }
      if a == 169 && b == 254 { return false }
      if a == 172 && (16...31).contains(b) { return false }
      if a == 192 && b == 168 { return false }
    }
    return true
  }
}

public struct FeedbackHTTPResponse: Equatable, Sendable {
  public let data: Data
  public let statusCode: Int

  public init(data: Data, statusCode: Int) {
    self.data = data
    self.statusCode = statusCode
  }
}

public protocol FeedbackTransport: Sendable {
  func send(_ request: URLRequest) async throws -> FeedbackHTTPResponse
}

public struct URLSessionFeedbackTransport: FeedbackTransport {
  public init() {}

  public func send(_ request: URLRequest) async throws -> FeedbackHTTPResponse {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.urlCache = nil
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.timeoutIntervalForRequest = 15
    configuration.timeoutIntervalForResource = 20
    configuration.waitsForConnectivity = false
    let session = URLSession(
      configuration: configuration,
      delegate: NoRedirectSessionDelegate(),
      delegateQueue: nil
    )
    defer { session.finishTasksAndInvalidate() }
    let (data, response) = try await session.data(for: request)
    guard let response = response as? HTTPURLResponse else {
      throw FeedbackClientError.invalidResponse
    }
    return FeedbackHTTPResponse(data: data, statusCode: response.statusCode)
  }
}

private final class NoRedirectSessionDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}

public enum FeedbackClientError: Error, Equatable, Sendable {
  case notConfigured
  case invalidReport(FeedbackValidationIssue)
  case requestTooLarge
  case offline
  case timedOut
  case transportFailure
  case rejected(statusCode: Int)
  case invalidResponse
  case mismatchedResponse
}

public protocol FeedbackSubmitting: Sendable {
  var isConfigured: Bool { get }
  func submit(_ report: FeedbackReport) async throws -> FeedbackSubmissionResponse
}

public struct FeedbackClient: FeedbackSubmitting, Sendable {
  public let isConfigured: Bool

  private let configuration: FeedbackEndpointConfiguration
  private let transport: any FeedbackTransport

  public init(
    configuration: FeedbackEndpointConfiguration = .bundled(),
    transport: any FeedbackTransport = URLSessionFeedbackTransport()
  ) {
    self.configuration = configuration
    self.transport = transport
    isConfigured = configuration.endpointURL != nil
  }

  public func submit(_ report: FeedbackReport) async throws -> FeedbackSubmissionResponse {
    guard let endpointURL = configuration.endpointURL else {
      throw FeedbackClientError.notConfigured
    }
    try validate(report)

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let body = try encoder.encode(report)
    guard body.count <= FeedbackContract.maximumRequestBytes else {
      throw FeedbackClientError.requestTooLarge
    }

    var request = URLRequest(url: endpointURL)
    request.httpMethod = "POST"
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.timeoutInterval = 15
    request.httpBody = body
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
    request.setValue(report.reportID, forHTTPHeaderField: "Idempotency-Key")

    let result: FeedbackHTTPResponse
    do {
      result = try await transport.send(request)
    } catch let error as URLError {
      switch error.code {
      case .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost:
        throw FeedbackClientError.offline
      case .timedOut:
        throw FeedbackClientError.timedOut
      default:
        throw FeedbackClientError.transportFailure
      }
    } catch let error as FeedbackClientError {
      throw error
    } catch {
      throw FeedbackClientError.transportFailure
    }

    guard (200...299).contains(result.statusCode) else {
      throw FeedbackClientError.rejected(statusCode: result.statusCode)
    }
    guard result.data.count <= 4_096 else { throw FeedbackClientError.invalidResponse }

    let response: FeedbackSubmissionResponse
    do {
      response = try JSONDecoder().decode(FeedbackSubmissionResponse.self, from: result.data)
    } catch {
      throw FeedbackClientError.invalidResponse
    }
    guard response.reportID == report.reportID, response.status == "accepted" else {
      throw FeedbackClientError.mismatchedResponse
    }
    return response
  }

  private func validate(_ report: FeedbackReport) throws {
    guard UUID(uuidString: report.reportID) != nil else {
      throw FeedbackClientError.invalidResponse
    }
    guard report.app == FeedbackContract.appName, report.category == FeedbackContract.category else {
      throw FeedbackClientError.invalidResponse
    }
    let draft = FeedbackDraft(
      message: report.message,
      replyEmail: report.replyEmail ?? "",
      includesAppContext: report.appContext != nil
    )
    if let issue = draft.validationIssue {
      throw FeedbackClientError.invalidReport(issue)
    }
    if let context = report.appContext {
      let values = [
        context.appVersion,
        context.build,
        context.operatingSystemVersion,
        context.locale,
      ]
      guard values.allSatisfy({ !$0.isEmpty && $0.count <= 128 && !$0.contains(where: \.isNewline) })
      else { throw FeedbackClientError.invalidResponse }
    }
  }
}
