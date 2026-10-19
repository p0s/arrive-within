import Foundation

public enum FeedbackContract {
  public static let appName = "Arrive Within"
  public static let category = "product-feedback"
  public static let maximumMessageLength = 4_000
  public static let maximumEmailLength = 254
  public static let maximumRequestBytes = 32 * 1_024
}

public enum FeedbackValidationIssue: Error, Equatable, Sendable {
  case emptyMessage
  case messageTooLong
  case emailTooLong
  case invalidEmail
}

public struct FeedbackDraft: Equatable, Sendable {
  public var message: String
  public var replyEmail: String
  public var includesAppContext: Bool

  public init(
    message: String = "",
    replyEmail: String = "",
    includesAppContext: Bool = false
  ) {
    self.message = message
    self.replyEmail = replyEmail
    self.includesAppContext = includesAppContext
  }

  public var trimmedMessage: String {
    message.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  public var normalizedReplyEmail: String? {
    let value = replyEmail.trimmingCharacters(in: .whitespacesAndNewlines)
    return value.isEmpty ? nil : value
  }

  public var validationIssue: FeedbackValidationIssue? {
    if trimmedMessage.isEmpty { return .emptyMessage }
    if trimmedMessage.count > FeedbackContract.maximumMessageLength { return .messageTooLong }
    guard let email = normalizedReplyEmail else { return nil }
    if email.count > FeedbackContract.maximumEmailLength { return .emailTooLong }
    if !Self.isValidEmail(email) { return .invalidEmail }
    return nil
  }

  public func makeReport(
    reportID: UUID,
    appContext: FeedbackAppContext
  ) throws -> FeedbackReport {
    if let validationIssue { throw validationIssue }
    return FeedbackReport(
      reportID: reportID.uuidString.lowercased(),
      app: FeedbackContract.appName,
      category: FeedbackContract.category,
      message: trimmedMessage,
      replyEmail: normalizedReplyEmail,
      appContext: includesAppContext ? appContext : nil
    )
  }

  private static func isValidEmail(_ value: String) -> Bool {
    guard value.unicodeScalars.allSatisfy({ scalar in
      !CharacterSet.whitespacesAndNewlines.contains(scalar)
        && !CharacterSet.controlCharacters.contains(scalar)
    })
    else { return false }
    let parts = value.split(separator: "@", omittingEmptySubsequences: false)
    guard parts.count == 2 else { return false }
    let local = String(parts[0])
    let domain = String(parts[1]).lowercased()
    guard !local.isEmpty, local.count <= 64, !domain.isEmpty, domain.contains(".") else {
      return false
    }
    guard !local.hasPrefix("."), !local.hasSuffix("."), !local.contains("..") else {
      return false
    }
    let labels = domain.split(separator: ".", omittingEmptySubsequences: false)
    guard labels.count >= 2 else { return false }
    return labels.allSatisfy { label in
      guard !label.isEmpty, label.count <= 63, label.first != "-", label.last != "-" else {
        return false
      }
      return label.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
    }
  }
}

public struct FeedbackAppContext: Codable, Equatable, Sendable {
  public let appVersion: String
  public let build: String
  public let operatingSystemVersion: String
  public let locale: String

  public init(
    appVersion: String,
    build: String,
    operatingSystemVersion: String,
    locale: String
  ) {
    self.appVersion = appVersion
    self.build = build
    self.operatingSystemVersion = operatingSystemVersion
    self.locale = locale
  }
}

public struct FeedbackReport: Encodable, Equatable, Sendable {
  public let reportID: String
  public let app: String
  public let category: String
  public let message: String
  public let replyEmail: String?
  public let appContext: FeedbackAppContext?

  public init(
    reportID: String,
    app: String,
    category: String,
    message: String,
    replyEmail: String?,
    appContext: FeedbackAppContext?
  ) {
    self.reportID = reportID
    self.app = app
    self.category = category
    self.message = message
    self.replyEmail = replyEmail
    self.appContext = appContext
  }

  enum CodingKeys: String, CodingKey {
    case reportID = "reportId"
    case app
    case category
    case message
    case replyEmail
    case appContext
  }
}

public struct FeedbackSubmissionResponse: Decodable, Equatable, Sendable {
  public let reportID: String
  public let status: String

  public init(reportID: String, status: String) {
    self.reportID = reportID
    self.status = status
  }

  enum CodingKeys: String, CodingKey {
    case reportID = "reportId"
    case status
  }
}
