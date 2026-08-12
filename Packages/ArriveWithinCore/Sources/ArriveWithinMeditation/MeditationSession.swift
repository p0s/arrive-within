import ArriveWithinDomain
import Foundation

public struct SessionMoment: Codable, Equatable, Sendable {
  public let monotonicMilliseconds: Int64
  public let wallClock: Date

  public init(monotonicMilliseconds: Int64, wallClock: Date) {
    self.monotonicMilliseconds = monotonicMilliseconds
    self.wallClock = wallClock
  }
}

public protocol SessionClock: Sendable {
  func now() -> SessionMoment
}

public struct SystemSessionClock: SessionClock, Sendable {
  public init() {}

  public func now() -> SessionMoment {
    SessionMoment(
      monotonicMilliseconds: Int64((ProcessInfo.processInfo.systemUptime * 1_000).rounded(.down)),
      wallClock: Date()
    )
  }
}

public struct MeditationSession: Codable, Equatable, Identifiable, Sendable {
  public enum Phase: String, Codable, Sendable {
    case prepared
    case running
    case paused
    case completing
    case completed
    case abandoned
  }

  public let id: UUID
  public let profileGenerationID: UUID
  public let mode: PracticeMode
  public let guidedContentID: String?
  public let guidedContentVersion: Int?
  public let targetDurationMilliseconds: Int64?
  public let preparedAt: Date
  public let configuration: MeditationSessionConfiguration

  public private(set) var phase: Phase
  public private(set) var startedAt: Date?
  public private(set) var endedAt: Date?
  public private(set) var activeMilliseconds: Int64
  public private(set) var runningSinceMonotonicMilliseconds: Int64?
  public private(set) var runningSinceWallClock: Date?
  public private(set) var completedEventID: UUID?

  public init(
    id: UUID,
    profileGenerationID: UUID,
    mode: PracticeMode,
    guidedContentID: String? = nil,
    guidedContentVersion: Int? = nil,
    targetDurationMilliseconds: Int64? = nil,
    preparedAt: Date,
    configuration: MeditationSessionConfiguration = .standard
  ) throws {
    if let targetDurationMilliseconds, targetDurationMilliseconds <= 0 {
      throw MeditationSessionError.invalidTargetDuration
    }
    if mode == .stopwatch, targetDurationMilliseconds != nil {
      throw MeditationSessionError.unexpectedStopwatchTarget
    }
    if mode == .guided {
      guard let guidedContentID, !guidedContentID.isEmpty, guidedContentVersion != nil else {
        throw MeditationSessionError.missingGuidedIdentity
      }
      guard configuration.audio.narrationLanguageCode != nil else {
        throw MeditationSessionError.missingGuidedLanguage
      }
    } else if guidedContentID != nil || guidedContentVersion != nil {
      throw MeditationSessionError.unexpectedGuidedIdentity
    }

    self.id = id
    self.profileGenerationID = profileGenerationID
    self.mode = mode
    self.guidedContentID = guidedContentID
    self.guidedContentVersion = guidedContentVersion
    self.targetDurationMilliseconds = targetDurationMilliseconds
    self.preparedAt = preparedAt
    self.configuration = configuration
    self.phase = .prepared
    self.activeMilliseconds = 0
  }

  public mutating func start(at moment: SessionMoment) throws {
    guard phase == .prepared else {
      throw MeditationSessionError.invalidTransition(phase, .running)
    }
    phase = .running
    startedAt = moment.wallClock
    runningSinceMonotonicMilliseconds = moment.monotonicMilliseconds
    runningSinceWallClock = moment.wallClock
  }

  public mutating func pause(at moment: SessionMoment) throws {
    guard phase == .running else { throw MeditationSessionError.invalidTransition(phase, .paused) }
    try accrueRunningTime(at: moment)
    phase = .paused
  }

  public mutating func resume(at moment: SessionMoment) throws {
    guard phase == .paused else { throw MeditationSessionError.invalidTransition(phase, .running) }
    phase = .running
    runningSinceMonotonicMilliseconds = moment.monotonicMilliseconds
    runningSinceWallClock = moment.wallClock
  }

  @discardableResult
  public mutating func beginCompletion(at moment: SessionMoment) throws -> Int64 {
    switch phase {
    case .running:
      try accrueRunningTime(at: moment)
      phase = .completing
      endedAt = max(moment.wallClock, startedAt ?? preparedAt)
    case .paused:
      phase = .completing
      endedAt = max(moment.wallClock, startedAt ?? preparedAt)
    case .completing, .completed:
      break
    case .prepared, .abandoned:
      throw MeditationSessionError.invalidTransition(phase, .completing)
    }
    return activeMilliseconds
  }

  public mutating func markCompleted(eventID: UUID, at date: Date) throws {
    if phase == .completed {
      guard completedEventID == eventID else {
        throw MeditationSessionError.conflictingCompletion
      }
      return
    }
    guard phase == .completing else {
      throw MeditationSessionError.invalidTransition(phase, .completed)
    }
    phase = .completed
    completedEventID = eventID
    endedAt = endedAt ?? date
  }

  public mutating func abandon(at date: Date) throws {
    guard [.prepared, .running, .paused].contains(phase) else {
      throw MeditationSessionError.invalidTransition(phase, .abandoned)
    }
    phase = .abandoned
    endedAt = date
    runningSinceMonotonicMilliseconds = nil
    runningSinceWallClock = nil
  }

  public func elapsedMilliseconds(at moment: SessionMoment) throws -> Int64 {
    guard phase == .running else { return activeMilliseconds }
    guard let runningSinceMonotonicMilliseconds else {
      throw MeditationSessionError.missingRunningOrigin
    }
    let delta = moment.monotonicMilliseconds - runningSinceMonotonicMilliseconds
    guard delta >= 0 else { throw MeditationSessionError.monotonicClockMovedBackward }
    return activeMilliseconds.addingClamped(delta)
  }

  public func completionMomentAtTarget(
    ifReachedAt moment: SessionMoment
  ) throws -> SessionMoment? {
    guard phase == .running, let targetDurationMilliseconds else { return nil }
    let elapsed = try elapsedMilliseconds(at: moment)
    guard elapsed >= targetDurationMilliseconds else { return nil }
    let overshoot = elapsed - targetDurationMilliseconds
    guard overshoot <= moment.monotonicMilliseconds else {
      throw MeditationSessionError.monotonicClockMovedBackward
    }
    return SessionMoment(
      monotonicMilliseconds: moment.monotonicMilliseconds - overshoot,
      wallClock: moment.wallClock.addingTimeInterval(-Double(overshoot) / 1_000)
    )
  }

  public func recoveryAssessment(at wallClock: Date) -> SessionRecoveryAssessment? {
    guard phase == .running, let runningSinceWallClock else { return nil }
    let wallDelta = max(
      0, Int64((wallClock.timeIntervalSince(runningSinceWallClock) * 1_000).rounded(.down)))
    return SessionRecoveryAssessment(
      lastConfirmedActiveMilliseconds: activeMilliseconds,
      maximumPlausibleActiveMilliseconds: activeMilliseconds.addingClamped(wallDelta),
      runningSinceWallClock: runningSinceWallClock,
      assessedAt: wallClock
    )
  }

  public mutating func recoverAfterTermination(
    confirmedActiveMilliseconds: Int64,
    at wallClock: Date
  ) throws {
    guard let assessment = recoveryAssessment(at: wallClock) else {
      throw MeditationSessionError.recoveryNotRequired
    }
    guard confirmedActiveMilliseconds >= assessment.lastConfirmedActiveMilliseconds,
      confirmedActiveMilliseconds <= assessment.maximumPlausibleActiveMilliseconds
    else {
      throw MeditationSessionError.invalidRecoveryDuration
    }
    activeMilliseconds = confirmedActiveMilliseconds
    phase = .paused
    runningSinceMonotonicMilliseconds = nil
    runningSinceWallClock = nil
  }

  private mutating func accrueRunningTime(at moment: SessionMoment) throws {
    activeMilliseconds = try elapsedMilliseconds(at: moment)
    runningSinceMonotonicMilliseconds = nil
    runningSinceWallClock = nil
  }

  private enum CodingKeys: String, CodingKey {
    case id
    case profileGenerationID
    case mode
    case guidedContentID
    case guidedContentVersion
    case targetDurationMilliseconds
    case preparedAt
    case configuration
    case phase
    case startedAt
    case endedAt
    case activeMilliseconds
    case runningSinceMonotonicMilliseconds
    case runningSinceWallClock
    case completedEventID
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decode(UUID.self, forKey: .id)
    profileGenerationID = try container.decode(UUID.self, forKey: .profileGenerationID)
    mode = try container.decode(PracticeMode.self, forKey: .mode)
    guidedContentID = try container.decodeIfPresent(String.self, forKey: .guidedContentID)
    guidedContentVersion = try container.decodeIfPresent(Int.self, forKey: .guidedContentVersion)
    targetDurationMilliseconds = try container.decodeIfPresent(
      Int64.self,
      forKey: .targetDurationMilliseconds
    )
    if mode == .stopwatch, targetDurationMilliseconds != nil {
      throw MeditationSessionError.unexpectedStopwatchTarget
    }
    preparedAt = try container.decode(Date.self, forKey: .preparedAt)
    if let decoded = try container.decodeIfPresent(
      MeditationSessionConfiguration.self,
      forKey: .configuration
    ) {
      configuration = decoded
    } else if mode == .guided {
      configuration = MeditationSessionConfiguration(
        audio: try MeditationAudioConfiguration(narrationLanguageCode: "en")
      )
    } else {
      configuration = .standard
    }
    phase = try container.decode(Phase.self, forKey: .phase)
    startedAt = try container.decodeIfPresent(Date.self, forKey: .startedAt)
    endedAt = try container.decodeIfPresent(Date.self, forKey: .endedAt)
    activeMilliseconds = try container.decode(Int64.self, forKey: .activeMilliseconds)
    runningSinceMonotonicMilliseconds = try container.decodeIfPresent(
      Int64.self,
      forKey: .runningSinceMonotonicMilliseconds
    )
    runningSinceWallClock = try container.decodeIfPresent(Date.self, forKey: .runningSinceWallClock)
    completedEventID = try container.decodeIfPresent(UUID.self, forKey: .completedEventID)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(id, forKey: .id)
    try container.encode(profileGenerationID, forKey: .profileGenerationID)
    try container.encode(mode, forKey: .mode)
    try container.encodeIfPresent(guidedContentID, forKey: .guidedContentID)
    try container.encodeIfPresent(guidedContentVersion, forKey: .guidedContentVersion)
    try container.encodeIfPresent(targetDurationMilliseconds, forKey: .targetDurationMilliseconds)
    try container.encode(preparedAt, forKey: .preparedAt)
    try container.encode(configuration, forKey: .configuration)
    try container.encode(phase, forKey: .phase)
    try container.encodeIfPresent(startedAt, forKey: .startedAt)
    try container.encodeIfPresent(endedAt, forKey: .endedAt)
    try container.encode(activeMilliseconds, forKey: .activeMilliseconds)
    try container.encodeIfPresent(
      runningSinceMonotonicMilliseconds,
      forKey: .runningSinceMonotonicMilliseconds
    )
    try container.encodeIfPresent(runningSinceWallClock, forKey: .runningSinceWallClock)
    try container.encodeIfPresent(completedEventID, forKey: .completedEventID)
  }
}

public struct SessionRecoveryAssessment: Codable, Equatable, Sendable {
  public let lastConfirmedActiveMilliseconds: Int64
  public let maximumPlausibleActiveMilliseconds: Int64
  public let runningSinceWallClock: Date
  public let assessedAt: Date

  public init(
    lastConfirmedActiveMilliseconds: Int64,
    maximumPlausibleActiveMilliseconds: Int64,
    runningSinceWallClock: Date,
    assessedAt: Date
  ) {
    self.lastConfirmedActiveMilliseconds = lastConfirmedActiveMilliseconds
    self.maximumPlausibleActiveMilliseconds = maximumPlausibleActiveMilliseconds
    self.runningSinceWallClock = runningSinceWallClock
    self.assessedAt = assessedAt
  }
}

public enum MeditationSessionError: Error, Equatable, Sendable {
  case invalidTargetDuration
  case unexpectedStopwatchTarget
  case missingGuidedIdentity
  case missingGuidedLanguage
  case unexpectedGuidedIdentity
  case invalidTransition(MeditationSession.Phase, MeditationSession.Phase)
  case missingRunningOrigin
  case monotonicClockMovedBackward
  case conflictingCompletion
  case recoveryNotRequired
  case invalidRecoveryDuration
}

extension Int64 {
  fileprivate func addingClamped(_ other: Int64) -> Int64 {
    let (sum, overflow) = addingReportingOverflow(other)
    return overflow ? Int64.max : sum
  }
}
