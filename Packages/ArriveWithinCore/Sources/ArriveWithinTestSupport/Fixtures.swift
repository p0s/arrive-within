import ArriveWithinDomain
import ArriveWithinMeditation
import Foundation

public enum ArriveWithinFixtures {
  public static let generationID = UUID(uuidString: "40000000-0000-4000-8000-000000000001")!
  public static let gardenID = UUID(uuidString: "10000000-0000-4000-8000-000000000001")!
  public static let installationID = UUID(uuidString: "50000000-0000-4000-8000-000000000001")!
  public static let utc = TimeZone(secondsFromGMT: 0)!

  public static func event(
    ordinal: Int,
    localDate: String,
    start: Date,
    activeMilliseconds: Int64 = 180_000,
    mode: PracticeMode = .timer,
    sessionID: UUID? = nil,
    eventID: UUID? = nil,
    generationID: UUID = generationID
  ) throws -> PracticeEvent {
    let calendar = Calendar(identifier: .gregorian)
    let day = try PracticeDayKey.containing(start, timeZone: utc)
    precondition(day.localDate == localDate)
    let resolvedSessionID = sessionID ?? deterministicUUID(namespace: 0x20, ordinal: ordinal)
    let resolvedEventID = eventID ?? deterministicUUID(namespace: 0x30, ordinal: ordinal)
    return try PracticeEvent(
      id: resolvedEventID,
      sessionID: resolvedSessionID,
      profileGenerationID: generationID,
      mode: mode,
      guidedContentID: mode == .guided ? "G01" : nil,
      guidedContentVersion: mode == .guided ? 1 : nil,
      startedAt: start,
      endedAt: start.addingTimeInterval(Double(activeMilliseconds) / 1_000),
      activeMilliseconds: activeMilliseconds,
      practiceDay: try PracticeDayKey.containing(start, calendarIdentifier: calendar.identifier, timeZone: utc),
      sourceInstallationID: installationID,
      createdAt: start.addingTimeInterval(Double(activeMilliseconds) / 1_000)
    )
  }

  public static func deterministicUUID(namespace: UInt8, ordinal: Int) -> UUID {
    let suffix = String(format: "%012x", ordinal)
    return UUID(uuidString: String(format: "%02x000000-0000-4000-8000-%@", namespace, suffix))!
  }
}

public actor InMemoryPracticeEventRepository: PracticeEventRepository {
  private var events: [PracticeEvent]

  public init(events: [PracticeEvent] = []) {
    self.events = events
  }

  public func allEvents(profileGenerationID: UUID) -> [PracticeEvent] {
    events.filter { $0.profileGenerationID == profileGenerationID }
  }

  public func event(sessionID: UUID, profileGenerationID: UUID) -> PracticeEvent? {
    events.first {
      $0.sessionID == sessionID && $0.profileGenerationID == profileGenerationID
    }
  }

  public func insertIfAbsent(_ event: PracticeEvent) -> PracticeEvent {
    if let existing = events.first(where: {
      $0.sessionID == event.sessionID && $0.profileGenerationID == event.profileGenerationID
    }) {
      return existing
    }
    events.append(event)
    return event
  }

  public func deleteAll(profileGenerationID: UUID) {
    events.removeAll { $0.profileGenerationID == profileGenerationID }
  }
}

public final class VirtualSessionClock: SessionClock, @unchecked Sendable {
  private let lock = NSLock()
  private var moment: SessionMoment

  public init(moment: SessionMoment) {
    self.moment = moment
  }

  public func now() -> SessionMoment {
    lock.withLock { moment }
  }

  public func advance(milliseconds: Int64) {
    lock.withLock {
      moment = SessionMoment(
        monotonicMilliseconds: moment.monotonicMilliseconds + milliseconds,
        wallClock: moment.wallClock.addingTimeInterval(Double(milliseconds) / 1_000)
      )
    }
  }
}
