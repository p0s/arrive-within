import ArriveWithinDomain
import Foundation

public actor FileWeeklyReminderScheduleRepository: WeeklyReminderScheduleRepository {
  private struct Envelope: Codable, Sendable {
    let schemaVersion: Int
    let schedules: [WeeklyReminderSchedule]
  }

  private let fileURL: URL
  private let fileManager: FileManager
  private let encoder: JSONEncoder
  private let decoder: JSONDecoder

  public init(fileURL: URL, fileManager: FileManager = .default) {
    self.fileURL = fileURL
    self.fileManager = fileManager
    self.encoder = Self.makeEncoder()
    self.decoder = Self.makeDecoder()
  }

  public func loadWeeklyReminderSchedules() throws -> [WeeklyReminderSchedule] {
    guard fileManager.fileExists(atPath: fileURL.path) else { return [] }
    do {
      let envelope = try decoder.decode(Envelope.self, from: Data(contentsOf: fileURL))
      guard envelope.schemaVersion == 1 else {
        throw FilePersistenceError.unsupportedSchema(envelope.schemaVersion)
      }
      try Self.validate(envelope.schedules)
      return WeeklyReminderSchedule.sorted(envelope.schedules)
    } catch let error as FilePersistenceError {
      throw error
    } catch let error as WeeklyReminderScheduleError {
      throw error
    } catch {
      throw FilePersistenceError.unreadableLedger
    }
  }

  public func saveWeeklyReminderSchedules(_ schedules: [WeeklyReminderSchedule]) throws {
    try Self.validate(schedules)
    let directory = fileURL.deletingLastPathComponent()
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    do {
      let envelope = Envelope(
        schemaVersion: 1,
        schedules: WeeklyReminderSchedule.sorted(schedules)
      )
      try encoder.encode(envelope).write(to: fileURL, options: .atomic)
      #if os(iOS)
        try fileManager.setAttributes(
          [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
          ofItemAtPath: fileURL.path
        )
      #endif
    } catch let error as WeeklyReminderScheduleError {
      throw error
    } catch {
      throw FilePersistenceError.couldNotPersist
    }
  }

  public func deleteAllWeeklyReminderSchedules() throws {
    guard fileManager.fileExists(atPath: fileURL.path) else { return }
    do {
      try fileManager.removeItem(at: fileURL)
    } catch {
      throw FilePersistenceError.couldNotPersist
    }
  }

  private static func validate(_ schedules: [WeeklyReminderSchedule]) throws {
    var identifiers = Set<UUID>()
    var times = Set<String>()
    for schedule in schedules {
      guard schedule.schemaVersion == WeeklyReminderSchedule.currentSchemaVersion else {
        throw WeeklyReminderScheduleError.unsupportedSchema(schedule.schemaVersion)
      }
      guard (0...23).contains(schedule.hour), (0...59).contains(schedule.minute) else {
        throw WeeklyReminderScheduleError.invalidLocalTime
      }
      guard schedule.modifiedAt >= schedule.createdAt else {
        throw WeeklyReminderScheduleError.invalidModificationDate
      }
      guard identifiers.insert(schedule.id).inserted else {
        throw WeeklyReminderScheduleError.duplicateIdentifier(schedule.id)
      }
      let key = "\(schedule.weekday.rawValue):\(schedule.hour):\(schedule.minute)"
      guard times.insert(key).inserted else {
        throw WeeklyReminderScheduleError.duplicateLocalTime(
          weekday: schedule.weekday,
          hour: schedule.hour,
          minute: schedule.minute
        )
      }
    }
  }

  private static func makeEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .millisecondsSince1970
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }

  private static func makeDecoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .millisecondsSince1970
    return decoder
  }
}

public actor EphemeralWeeklyReminderScheduleRepository: WeeklyReminderScheduleRepository {
  private var schedules: [WeeklyReminderSchedule]

  public init(schedules: [WeeklyReminderSchedule] = []) {
    self.schedules = WeeklyReminderSchedule.sorted(schedules)
  }

  public func loadWeeklyReminderSchedules() -> [WeeklyReminderSchedule] { schedules }

  public func saveWeeklyReminderSchedules(_ schedules: [WeeklyReminderSchedule]) {
    self.schedules = WeeklyReminderSchedule.sorted(schedules)
  }

  public func deleteAllWeeklyReminderSchedules() { schedules = [] }
}
