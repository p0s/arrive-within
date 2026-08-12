import ArriveWithinDomain
import Foundation

public struct SessionCompletionInput: Sendable {
  public let eventID: UUID
  public let sourceInstallationID: UUID
  public let practiceDay: PracticeDayKey
  public let moment: SessionMoment

  public init(
    eventID: UUID,
    sourceInstallationID: UUID,
    practiceDay: PracticeDayKey,
    moment: SessionMoment
  ) {
    self.eventID = eventID
    self.sourceInstallationID = sourceInstallationID
    self.practiceDay = practiceDay
    self.moment = moment
  }
}

public struct SessionCompletionOutcome: Sendable {
  public let session: MeditationSession
  public let event: PracticeEvent
  public let inserted: Bool

  public init(session: MeditationSession, event: PracticeEvent, inserted: Bool) {
    self.session = session
    self.event = event
    self.inserted = inserted
  }
}

public actor SessionCompletionCoordinator {
  private let repository: any PracticeEventRepository

  public init(repository: any PracticeEventRepository) {
    self.repository = repository
  }

  public func complete(
    session original: MeditationSession,
    input: SessionCompletionInput
  ) async throws -> SessionCompletionOutcome {
    var session = original

    if let existing = try await repository.event(
      sessionID: session.id,
      profileGenerationID: session.profileGenerationID
    ) {
      if session.phase != .completed {
        if session.phase != .completing {
          _ = try session.beginCompletion(at: input.moment)
        }
        try session.markCompleted(eventID: existing.id, at: input.moment.wallClock)
      }
      return SessionCompletionOutcome(session: session, event: existing, inserted: false)
    }

    let activeMilliseconds = try session.beginCompletion(at: input.moment)
    guard let startedAt = session.startedAt else {
      throw MeditationSessionError.invalidTransition(session.phase, .completed)
    }
    let event = try PracticeEvent(
      id: input.eventID,
      sessionID: session.id,
      profileGenerationID: session.profileGenerationID,
      mode: session.mode,
      guidedContentID: session.guidedContentID,
      guidedContentVersion: session.guidedContentVersion,
      startedAt: startedAt,
      endedAt: session.endedAt ?? input.moment.wallClock,
      activeMilliseconds: activeMilliseconds,
      practiceDay: input.practiceDay,
      sourceInstallationID: input.sourceInstallationID,
      createdAt: max(input.moment.wallClock, session.endedAt ?? startedAt)
    )
    let stored = try await repository.insertIfAbsent(event)
    try session.markCompleted(eventID: stored.id, at: input.moment.wallClock)
    return SessionCompletionOutcome(
      session: session,
      event: stored,
      inserted: stored.id == event.id
    )
  }
}
