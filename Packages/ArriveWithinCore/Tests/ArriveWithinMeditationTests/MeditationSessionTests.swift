import ArriveWithinDomain
import ArriveWithinMeditation
import ArriveWithinTestSupport
import Foundation
import Testing

@Suite("Persistable meditation state machine")
struct MeditationSessionTests {
  @Test("Paused time never counts as active time")
  func pausesAreExcluded() throws {
    let base = Date(timeIntervalSince1970: 1_786_291_200)
    var session = try makeSession(preparedAt: base)
    try session.start(at: .init(monotonicMilliseconds: 1_000, wallClock: base))
    try session.pause(
      at: .init(monotonicMilliseconds: 61_000, wallClock: base.addingTimeInterval(60)))
    try session.resume(
      at: .init(monotonicMilliseconds: 121_000, wallClock: base.addingTimeInterval(120)))
    let elapsed = try session.beginCompletion(
      at: .init(monotonicMilliseconds: 241_000, wallClock: base.addingTimeInterval(240))
    )

    #expect(elapsed == 180_000)
  }

  @Test("Termination recovery never fabricates active time")
  func recoveryRequiresConfirmedDuration() throws {
    let base = Date(timeIntervalSince1970: 1_786_291_200)
    var session = try makeSession(preparedAt: base)
    try session.start(at: .init(monotonicMilliseconds: 1_000, wallClock: base))
    let assessment = try #require(session.recoveryAssessment(at: base.addingTimeInterval(300)))

    #expect(assessment.lastConfirmedActiveMilliseconds == 0)
    #expect(assessment.maximumPlausibleActiveMilliseconds == 300_000)

    try session.recoverAfterTermination(
      confirmedActiveMilliseconds: 120_000,
      at: base.addingTimeInterval(300)
    )
    #expect(session.phase == .paused)
    #expect(session.activeMilliseconds == 120_000)
  }

  @Test("A suspended timer completes at its target rather than over-crediting wake time")
  func timerCompletionClampsToTargetMoment() throws {
    let base = Date(timeIntervalSince1970: 1_786_291_200)
    var session = try makeSession(preparedAt: base)
    try session.start(at: .init(monotonicMilliseconds: 1_000, wallClock: base))
    let wake = SessionMoment(
      monotonicMilliseconds: 241_000,
      wallClock: base.addingTimeInterval(240)
    )
    let targetCandidate = try session.completionMomentAtTarget(ifReachedAt: wake)
    let target = try #require(targetCandidate)

    #expect(target.monotonicMilliseconds == 181_000)
    #expect(target.wallClock == base.addingTimeInterval(180))
    #expect(try session.beginCompletion(at: target) == 180_000)
  }

  @Test("A stopwatch has no target, no artificial maximum, and preserves pause truth")
  func stopwatchIsOpenEnded() throws {
    let base = Date(timeIntervalSince1970: 1_786_291_200)
    #expect(throws: MeditationSessionError.unexpectedStopwatchTarget) {
      _ = try MeditationSession(
        id: ArriveWithinFixtures.deterministicUUID(namespace: 0x20, ordinal: 2),
        profileGenerationID: ArriveWithinFixtures.generationID,
        mode: .stopwatch,
        targetDurationMilliseconds: 180_000,
        preparedAt: base
      )
    }

    var session = try MeditationSession(
      id: ArriveWithinFixtures.deterministicUUID(namespace: 0x20, ordinal: 3),
      profileGenerationID: ArriveWithinFixtures.generationID,
      mode: .stopwatch,
      preparedAt: base
    )
    try session.start(at: .init(monotonicMilliseconds: 1_000, wallClock: base))
    let fourHours: Int64 = 4 * 60 * 60 * 1_000
    let later = SessionMoment(
      monotonicMilliseconds: 1_000 + fourHours,
      wallClock: base.addingTimeInterval(4 * 60 * 60)
    )

    #expect(session.targetDurationMilliseconds == nil)
    #expect(try session.completionMomentAtTarget(ifReachedAt: later) == nil)
    #expect(try session.elapsedMilliseconds(at: later) == fourHours)
    try session.pause(at: later)
    #expect(session.activeMilliseconds == fourHours)
    #expect(
      try session.elapsedMilliseconds(
        at: .init(
          monotonicMilliseconds: later.monotonicMilliseconds + 3_600_000,
          wallClock: later.wallClock.addingTimeInterval(3_600)
        )
      ) == fourHours
    )
  }

  @Test("Wall-clock rollback cannot invalidate a monotonic stopwatch completion")
  func stopwatchCompletionClampsBackwardWallClock() async throws {
    let base = Date(timeIntervalSince1970: 1_786_291_200)
    var session = try MeditationSession(
      id: ArriveWithinFixtures.deterministicUUID(namespace: 0x20, ordinal: 4),
      profileGenerationID: ArriveWithinFixtures.generationID,
      mode: .stopwatch,
      preparedAt: base
    )
    try session.start(at: .init(monotonicMilliseconds: 10_000, wallClock: base))
    try session.pause(
      at: .init(
        monotonicMilliseconds: 190_000,
        wallClock: base.addingTimeInterval(180)
      )
    )
    let rollbackMoment = SessionMoment(
      monotonicMilliseconds: 200_000,
      wallClock: base.addingTimeInterval(-3_600)
    )
    let repository = InMemoryPracticeEventRepository()
    let coordinator = SessionCompletionCoordinator(repository: repository)
    let outcome = try await coordinator.complete(
      session: session,
      input: SessionCompletionInput(
        eventID: ArriveWithinFixtures.deterministicUUID(namespace: 0x30, ordinal: 4),
        sourceInstallationID: ArriveWithinFixtures.installationID,
        practiceDay: try PracticeDayKey.containing(
          rollbackMoment.wallClock,
          timeZone: ArriveWithinFixtures.utc
        ),
        moment: rollbackMoment
      )
    )

    #expect(outcome.event.activeMilliseconds == PracticeEvent.qualificationMilliseconds)
    #expect(outcome.event.endedAt == base)
    #expect(outcome.event.createdAt == base)
    #expect(outcome.event.qualifiesForGrowth)
  }

  @Test("Duplicate completion calls return one immutable event")
  func completionIsIdempotent() async throws {
    let base = Date(timeIntervalSince1970: 1_786_291_200)
    var session = try makeSession(preparedAt: base)
    try session.start(at: .init(monotonicMilliseconds: 0, wallClock: base))
    let repository = InMemoryPracticeEventRepository()
    let coordinator = SessionCompletionCoordinator(repository: repository)
    let day = try PracticeDayKey.containing(
      base.addingTimeInterval(180), timeZone: ArriveWithinFixtures.utc)
    let input = SessionCompletionInput(
      eventID: ArriveWithinFixtures.deterministicUUID(namespace: 0x30, ordinal: 1),
      sourceInstallationID: ArriveWithinFixtures.installationID,
      practiceDay: day,
      moment: .init(monotonicMilliseconds: 180_000, wallClock: base.addingTimeInterval(180))
    )

    let first = try await coordinator.complete(session: session, input: input)
    let second = try await coordinator.complete(session: first.session, input: input)
    let events = await repository.allEvents(profileGenerationID: ArriveWithinFixtures.generationID)

    #expect(first.inserted)
    #expect(!second.inserted)
    #expect(first.event.id == second.event.id)
    #expect(events.count == 1)
  }

  @Test("Timer timing survives audio loss while guided narration pauses safely")
  func interruptionAndRoutePolicy() throws {
    #expect(
      AudioLifecyclePolicy.actions(for: .timer, phase: .running, event: .interruptionBegan)
        == [.stopPlayback, .rebuildPlayback]
    )
    #expect(
      AudioLifecyclePolicy.actions(for: .timer, phase: .running, event: .interruptionEnded)
        == [.resumePlayback]
    )
    #expect(
      AudioLifecyclePolicy.actions(for: .guided, phase: .running, event: .interruptionBegan)
        == [.pauseSession, .stopPlayback, .waitForUserResume]
    )
    #expect(
      AudioLifecyclePolicy.actions(for: .guided, phase: .paused, event: .interruptionEnded)
        == [.waitForUserResume]
    )
    #expect(
      AudioLifecyclePolicy.actions(for: .stopwatch, phase: .running, event: .outputRouteLost)
        == [.stopPlayback, .rebuildPlayback]
    )
    #expect(
      AudioLifecyclePolicy.actions(for: .timer, phase: .running, event: .mediaServicesReset)
        == [.stopPlayback, .rebuildPlayback, .resumePlayback]
    )
  }

  @Test("Timer configuration rejects dishonest or unreachable controls")
  func timerConfigurationValidation() throws {
    let interval = try MeditationAudioConfiguration(intervalBellMinutes: 5)
    #expect(throws: MeditationConfigurationError.intervalMustPrecedeTimerEnd) {
      _ = try TimerPreferences(durationMinutes: 5, audio: interval)
    }
    #expect(throws: MeditationConfigurationError.invalidTimerDuration) {
      _ = try TimerPreferences(durationMinutes: 181)
    }
    #expect(throws: MeditationConfigurationError.invalidAmbienceVolume) {
      _ = try MeditationAudioConfiguration(ambienceVolume: .infinity)
    }
  }

  private func makeSession(preparedAt: Date) throws -> MeditationSession {
    try MeditationSession(
      id: ArriveWithinFixtures.deterministicUUID(namespace: 0x20, ordinal: 1),
      profileGenerationID: ArriveWithinFixtures.generationID,
      mode: .timer,
      targetDurationMilliseconds: 180_000,
      preparedAt: preparedAt,
      configuration: .standard
    )
  }
}
