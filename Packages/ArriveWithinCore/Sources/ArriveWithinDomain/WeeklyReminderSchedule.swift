import Foundation

public enum Weekday: Int, Codable, CaseIterable, Equatable, Hashable, Sendable {
  case sunday = 1
  case monday
  case tuesday
  case wednesday
  case thursday
  case friday
  case saturday
}

public struct WeeklyReminderSchedule: Codable, Equatable, Hashable, Identifiable, Sendable {
  public static let currentSchemaVersion = 1

  public let schemaVersion: Int
  public let id: UUID
  public let weekday: Weekday
  public let hour: Int
  public let minute: Int
  public let isEnabled: Bool
  public let createdAt: Date
  public let modifiedAt: Date

  public init(
    schemaVersion: Int = Self.currentSchemaVersion,
    id: UUID,
    weekday: Weekday,
    hour: Int,
    minute: Int,
    isEnabled: Bool = true,
    createdAt: Date,
    modifiedAt: Date
  ) throws {
    guard schemaVersion == Self.currentSchemaVersion else {
      throw WeeklyReminderScheduleError.unsupportedSchema(schemaVersion)
    }
    guard (0...23).contains(hour), (0...59).contains(minute) else {
      throw WeeklyReminderScheduleError.invalidLocalTime
    }
    guard modifiedAt >= createdAt else {
      throw WeeklyReminderScheduleError.invalidModificationDate
    }
    self.schemaVersion = schemaVersion
    self.id = id
    self.weekday = weekday
    self.hour = hour
    self.minute = minute
    self.isEnabled = isEnabled
    self.createdAt = createdAt
    self.modifiedAt = modifiedAt
  }

  public func replacing(
    weekday: Weekday? = nil,
    hour: Int? = nil,
    minute: Int? = nil,
    isEnabled: Bool? = nil,
    modifiedAt: Date
  ) throws -> Self {
    try Self(
      id: id,
      weekday: weekday ?? self.weekday,
      hour: hour ?? self.hour,
      minute: minute ?? self.minute,
      isEnabled: isEnabled ?? self.isEnabled,
      createdAt: createdAt,
      modifiedAt: max(modifiedAt, self.modifiedAt)
    )
  }

  public static func sorted(_ schedules: [Self]) -> [Self] {
    schedules.sorted { lhs, rhs in
      if lhs.weekday.rawValue != rhs.weekday.rawValue {
        return lhs.weekday.rawValue < rhs.weekday.rawValue
      }
      if lhs.hour != rhs.hour { return lhs.hour < rhs.hour }
      if lhs.minute != rhs.minute { return lhs.minute < rhs.minute }
      return lhs.id.uuidString < rhs.id.uuidString
    }
  }

  private enum CodingKeys: String, CodingKey {
    case schemaVersion
    case id
    case weekday
    case hour
    case minute
    case isEnabled
    case createdAt
    case modifiedAt
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    try self.init(
      schemaVersion: container.decode(Int.self, forKey: .schemaVersion),
      id: container.decode(UUID.self, forKey: .id),
      weekday: container.decode(Weekday.self, forKey: .weekday),
      hour: container.decode(Int.self, forKey: .hour),
      minute: container.decode(Int.self, forKey: .minute),
      isEnabled: container.decode(Bool.self, forKey: .isEnabled),
      createdAt: container.decode(Date.self, forKey: .createdAt),
      modifiedAt: container.decode(Date.self, forKey: .modifiedAt)
    )
  }
}

public protocol WeeklyReminderScheduleRepository: Sendable {
  func loadWeeklyReminderSchedules() async throws -> [WeeklyReminderSchedule]
  func saveWeeklyReminderSchedules(_ schedules: [WeeklyReminderSchedule]) async throws
  func deleteAllWeeklyReminderSchedules() async throws
}

public enum WeeklyReminderScheduleError: Error, Equatable, Sendable {
  case unsupportedSchema(Int)
  case invalidLocalTime
  case invalidModificationDate
  case duplicateIdentifier(UUID)
  case duplicateLocalTime(weekday: Weekday, hour: Int, minute: Int)
}
