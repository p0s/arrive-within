import Foundation

public enum PracticeMode: String, Codable, CaseIterable, Hashable, Sendable {
  case guided
  case timer
  case stopwatch
}

public struct PracticeDayKey: Codable, Hashable, Sendable, Comparable {
  public let localDate: String
  public let calendarIdentifier: String
  public let timeZoneIdentifier: String
  public let intervalStartUTC: Date
  public let intervalEndUTC: Date

  public init(
    localDate: String,
    calendarIdentifier: String,
    timeZoneIdentifier: String,
    intervalStartUTC: Date,
    intervalEndUTC: Date
  ) throws {
    guard intervalEndUTC > intervalStartUTC else {
      throw PracticeEventError.invalidPracticeDayInterval
    }
    self.localDate = localDate
    self.calendarIdentifier = calendarIdentifier
    self.timeZoneIdentifier = timeZoneIdentifier
    self.intervalStartUTC = intervalStartUTC
    self.intervalEndUTC = intervalEndUTC
  }

  public static func containing(
    _ date: Date,
    calendarIdentifier: Calendar.Identifier = .gregorian,
    timeZone: TimeZone
  ) throws -> Self {
    var calendar = Calendar(identifier: calendarIdentifier)
    calendar.locale = Locale(identifier: "en_US_POSIX")
    calendar.timeZone = timeZone

    guard let interval = calendar.dateInterval(of: .day, for: date) else {
      throw PracticeEventError.invalidPracticeDayInterval
    }

    let components = calendar.dateComponents([.year, .month, .day], from: date)
    guard let year = components.year, let month = components.month, let day = components.day else {
      throw PracticeEventError.invalidPracticeDayInterval
    }

    return try Self(
      localDate: String(format: "%04d-%02d-%02d", year, month, day),
      calendarIdentifier: calendarIdentifier.stableName,
      timeZoneIdentifier: timeZone.identifier,
      intervalStartUTC: interval.start,
      intervalEndUTC: interval.end
    )
  }

  public var stableIdentifier: String {
    let seconds = Int64(intervalStartUTC.timeIntervalSince1970.rounded(.towardZero))
    return "\(calendarIdentifier)|\(timeZoneIdentifier)|\(localDate)|\(seconds)"
  }

  public static func < (lhs: Self, rhs: Self) -> Bool {
    if lhs.intervalStartUTC != rhs.intervalStartUTC {
      return lhs.intervalStartUTC < rhs.intervalStartUTC
    }
    return lhs.stableIdentifier < rhs.stableIdentifier
  }

  private enum CodingKeys: String, CodingKey {
    case localDate
    case calendarIdentifier
    case timeZoneIdentifier
    case intervalStartUTC
    case intervalEndUTC
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    try self.init(
      localDate: container.decode(String.self, forKey: .localDate),
      calendarIdentifier: container.decode(String.self, forKey: .calendarIdentifier),
      timeZoneIdentifier: container.decode(String.self, forKey: .timeZoneIdentifier),
      intervalStartUTC: container.decode(Date.self, forKey: .intervalStartUTC),
      intervalEndUTC: container.decode(Date.self, forKey: .intervalEndUTC)
    )
  }
}

public struct PracticeEvent: Codable, Hashable, Identifiable, Sendable {
  public static let qualificationMilliseconds: Int64 = 180_000
  public static let maximumGrowthCreditMilliseconds: Int64 = 3_600_000

  public let id: UUID
  public let sessionID: UUID
  public let profileGenerationID: UUID
  public let mode: PracticeMode
  public let guidedContentID: String?
  public let guidedContentVersion: Int?
  public let startedAt: Date
  public let endedAt: Date
  public let activeMilliseconds: Int64
  public let practiceDay: PracticeDayKey
  public let sourceInstallationID: UUID
  public let createdAt: Date

  public init(
    id: UUID,
    sessionID: UUID,
    profileGenerationID: UUID,
    mode: PracticeMode,
    guidedContentID: String? = nil,
    guidedContentVersion: Int? = nil,
    startedAt: Date,
    endedAt: Date,
    activeMilliseconds: Int64,
    practiceDay: PracticeDayKey,
    sourceInstallationID: UUID,
    createdAt: Date
  ) throws {
    guard endedAt >= startedAt else { throw PracticeEventError.endPrecedesStart }
    guard activeMilliseconds >= 0 else { throw PracticeEventError.negativeActiveDuration }
    guard activeMilliseconds <= Int64.max / 2 else {
      throw PracticeEventError.unreasonableActiveDuration
    }
    if mode == .guided {
      guard let guidedContentID, !guidedContentID.isEmpty, guidedContentVersion != nil else {
        throw PracticeEventError.missingGuidedIdentity
      }
    } else if guidedContentID != nil || guidedContentVersion != nil {
      throw PracticeEventError.unexpectedGuidedIdentity
    }

    self.id = id
    self.sessionID = sessionID
    self.profileGenerationID = profileGenerationID
    self.mode = mode
    self.guidedContentID = guidedContentID
    self.guidedContentVersion = guidedContentVersion
    self.startedAt = startedAt
    self.endedAt = endedAt
    self.activeMilliseconds = activeMilliseconds
    self.practiceDay = practiceDay
    self.sourceInstallationID = sourceInstallationID
    self.createdAt = createdAt
  }

  public var qualifiesForGrowth: Bool {
    activeMilliseconds >= Self.qualificationMilliseconds
  }

  public var growthCreditMilliseconds: Int64 {
    guard qualifiesForGrowth else { return 0 }
    return min(activeMilliseconds, Self.maximumGrowthCreditMilliseconds)
  }

  private enum CodingKeys: String, CodingKey {
    case id
    case sessionID
    case profileGenerationID
    case mode
    case guidedContentID
    case guidedContentVersion
    case startedAt
    case endedAt
    case activeMilliseconds
    case practiceDay
    case sourceInstallationID
    case createdAt
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    try self.init(
      id: container.decode(UUID.self, forKey: .id),
      sessionID: container.decode(UUID.self, forKey: .sessionID),
      profileGenerationID: container.decode(UUID.self, forKey: .profileGenerationID),
      mode: container.decode(PracticeMode.self, forKey: .mode),
      guidedContentID: container.decodeIfPresent(String.self, forKey: .guidedContentID),
      guidedContentVersion: container.decodeIfPresent(Int.self, forKey: .guidedContentVersion),
      startedAt: container.decode(Date.self, forKey: .startedAt),
      endedAt: container.decode(Date.self, forKey: .endedAt),
      activeMilliseconds: container.decode(Int64.self, forKey: .activeMilliseconds),
      practiceDay: container.decode(PracticeDayKey.self, forKey: .practiceDay),
      sourceInstallationID: container.decode(UUID.self, forKey: .sourceInstallationID),
      createdAt: container.decode(Date.self, forKey: .createdAt)
    )
  }
}

public enum PracticeEventError: Error, Equatable, Sendable {
  case endPrecedesStart
  case negativeActiveDuration
  case unreasonableActiveDuration
  case missingGuidedIdentity
  case unexpectedGuidedIdentity
  case invalidPracticeDayInterval
}

public protocol PracticeEventRepository: Sendable {
  func allEvents(profileGenerationID: UUID) async throws -> [PracticeEvent]
  func event(sessionID: UUID, profileGenerationID: UUID) async throws -> PracticeEvent?
  @discardableResult
  func insertIfAbsent(_ event: PracticeEvent) async throws -> PracticeEvent
  func deleteAll(profileGenerationID: UUID) async throws
}

extension Calendar.Identifier {
  fileprivate var stableName: String {
    switch self {
    case .gregorian: "gregorian"
    case .buddhist: "buddhist"
    case .chinese: "chinese"
    case .coptic: "coptic"
    case .ethiopicAmeteMihret: "ethiopic-amete-mihret"
    case .ethiopicAmeteAlem: "ethiopic-amete-alem"
    case .hebrew: "hebrew"
    case .iso8601: "iso8601"
    case .indian: "indian"
    case .islamic: "islamic"
    case .islamicCivil: "islamic-civil"
    case .japanese: "japanese"
    case .persian: "persian"
    case .republicOfChina: "republic-of-china"
    case .islamicTabular: "islamic-tabular"
    case .islamicUmmAlQura: "islamic-umm-al-qura"
    case .bangla: "bangla"
    case .gujarati: "gujarati"
    case .kannada: "kannada"
    case .malayalam: "malayalam"
    case .marathi: "marathi"
    case .odia: "odia"
    case .tamil: "tamil"
    case .telugu: "telugu"
    case .vikram: "vikram"
    case .dangi: "dangi"
    case .vietnamese: "vietnamese"
    @unknown default: "unknown"
    }
  }
}
