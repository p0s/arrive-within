import ArriveWithinContent
import ArriveWithinDomain
import ArriveWithinMeditation
import Foundation

/// Minimal, non-sensitive practice state that Siri and Shortcuts may report.
struct PracticeIntentStatus: Equatable, Sendable {
  enum Kind: Equatable, Sendable {
    case guided
    case timer
    case openEnded
  }

  enum Phase: Equatable, Sendable {
    case preparing
    case running
    case paused
    case awaitingRecoveryChoice
    case finishing
  }

  let kind: Kind
  let phase: Phase
  let plannedMinutes: Int?

  var isBelowGrowthMinimum: Bool {
    guard let plannedMinutes else { return false }
    return Int64(plannedMinutes) * 60_000 < PracticeEvent.qualificationMilliseconds
  }
}

enum PracticeIntentStartOutcome: Equatable, Sendable {
  case started(PracticeIntentStatus)
  case alreadyInProgress(PracticeIntentStatus)

  var status: PracticeIntentStatus {
    switch self {
    case .started(let status), .alreadyInProgress(let status): status
    }
  }
}

enum PracticeIntentControlOutcome: Equatable, Sendable {
  case changed(PracticeIntentStatus)
  case unchanged(PracticeIntentStatus)

  var status: PracticeIntentStatus {
    switch self {
    case .changed(let status), .unchanged(let status): status
    }
  }
}

enum PracticeIntentFailure: Error, CaseIterable, Equatable, Sendable {
  case invalidDuration
  case unknownPractice
  case narrationUnavailable
  case catalogUnavailable
  case stillOpening
  case dataUnavailable
  case busy
  case couldNotStart
  case noLivePractice
  case recoveryChoicePending
  case stillPreparing
  case narrationCannotResume
  case couldNotChange
}

/// Adapter between App Intents and `AppModel`. It never owns practice state:
/// starts go through the same model entry points as the Meditate tab, so the
/// model's one-session guard stays the only duplicate guard, and pause/resume
/// only touch a session that this process has already loaded.
@MainActor
final class PracticeIntentController {
  static let silentMinutesRange = 1...Int(MeditationSession.maximumTargetDurationMilliseconds / 60_000)

  private let model: AppModel
  private let loadPollInterval: Duration
  private let loadTimeout: Duration

  init(
    model: AppModel,
    loadPollInterval: Duration = .milliseconds(50),
    loadTimeout: Duration = .seconds(10)
  ) {
    self.model = model
    self.loadPollInterval = loadPollInterval
    self.loadTimeout = loadTimeout
  }

  var guidedPractices: [GuidedPractice] { model.guidedPractices }

  func startSilentPractice(minutes: Int?) async throws -> PracticeIntentStartOutcome {
    if let minutes, !Self.silentMinutesRange.contains(minutes) {
      throw PracticeIntentFailure.invalidDuration
    }
    try await loadSavedState()
    // A length uses the remembered timer configuration without saving it;
    // no length is the open-ended stopwatch.
    let mode: PracticeMode = minutes == nil ? .stopwatch : .timer
    return try await start {
      await self.model.beginPractice(mode: mode, targetMinutes: minutes)
    }
  }

  func startGuidedPractice(
    practiceID: String,
    language: GuidedLanguage?
  ) async throws -> PracticeIntentStartOutcome {
    try await loadSavedState()
    guard !model.guidedPractices.isEmpty else { throw PracticeIntentFailure.catalogUnavailable }
    guard model.guidedPractices.contains(where: { $0.id == practiceID }) else {
      throw PracticeIntentFailure.unknownPractice
    }
    let appNarration: GuidedLanguage = model.appLanguage.languageCode == "de" ? .german : .english
    let narration = language ?? appNarration
    return try await start {
      await self.model.startGuidedPractice(practiceID: practiceID, language: narration)
    }
  }

  func setPaused(_ paused: Bool) async throws -> PracticeIntentControlOutcome {
    switch model.launchPhase {
    case .loading, .firstUse:
      // A process launched only for this action has not loaded a session and
      // must not recover or continue one that ended with an earlier process.
      throw PracticeIntentFailure.noLivePractice
    case .failed:
      throw PracticeIntentFailure.dataUnavailable
    case .ready:
      break
    }
    guard let session = model.activeSession else { throw PracticeIntentFailure.noLivePractice }
    guard model.recoveryAssessment == nil else { throw PracticeIntentFailure.recoveryChoicePending }
    switch session.phase {
    case .prepared:
      throw PracticeIntentFailure.stillPreparing
    case .completing, .completed, .abandoned:
      throw PracticeIntentFailure.noLivePractice
    case .running:
      guard paused else { return .unchanged(status(for: session)) }
      await model.pausePractice()
    case .paused:
      guard !paused else { return .unchanged(status(for: session)) }
      await model.resumePractice()
    }

    guard let updated = model.activeSession, updated.id == session.id else {
      throw PracticeIntentFailure.couldNotChange
    }
    let requestedPhase: MeditationSession.Phase = paused ? .paused : .running
    if updated.phase == requestedPhase {
      return .changed(status(for: updated))
    }
    if !paused, updated.mode == .guided, model.audioNotice == .guidedNarrationPendingApproval {
      throw PracticeIntentFailure.narrationCannotResume
    }
    throw PracticeIntentFailure.couldNotChange
  }

  #if DEBUG
    func verificationSnapshot() async -> PracticeVerificationSnapshot {
      await model.practiceVerificationSnapshot()
    }
  #endif

  func status(for session: MeditationSession) -> PracticeIntentStatus {
    let kind: PracticeIntentStatus.Kind =
      switch session.mode {
      case .guided: .guided
      case .timer: .timer
      case .stopwatch: .openEnded
      }
    let phase: PracticeIntentStatus.Phase
    if model.recoveryAssessment != nil {
      phase = .awaitingRecoveryChoice
    } else {
      phase =
        switch session.phase {
        case .prepared: .preparing
        case .running: .running
        case .paused: .paused
        case .completing, .completed, .abandoned: .finishing
        }
    }
    return PracticeIntentStatus(
      kind: kind,
      phase: phase,
      plannedMinutes: session.targetDurationMilliseconds.map { Int($0 / 60_000) }
    )
  }

  /// Start requests may arrive while the app is still opening. Acting before
  /// the saved profile and session are loaded could replace the profile or
  /// start a second session, so wait for the model's own load to finish.
  private func loadSavedState() async throws {
    await model.start()
    var waited = Duration.zero
    while model.launchPhase == .loading {
      guard waited < loadTimeout else { throw PracticeIntentFailure.stillOpening }
      try await Task.sleep(for: loadPollInterval)
      waited += loadPollInterval
    }
    if model.launchPhase == .failed { throw PracticeIntentFailure.dataUnavailable }
  }

  private func start(
    _ request: @MainActor () async -> Bool
  ) async throws -> PracticeIntentStartOutcome {
    let previousSessionID = model.activeSession?.id
    _ = await request()
    model.leaveFirstUseAfterSystemStart()

    if let session = model.activeSession {
      return session.id == previousSessionID
        ? .alreadyInProgress(status(for: session))
        : .started(status(for: session))
    }
    if model.isPerformingDataAction { throw PracticeIntentFailure.busy }
    if model.launchPhase == .failed { throw PracticeIntentFailure.dataUnavailable }
    switch model.audioNotice {
    case .guidedNarrationPendingApproval?: throw PracticeIntentFailure.narrationUnavailable
    case .guidedCatalogUnavailable?: throw PracticeIntentFailure.catalogUnavailable
    default: throw PracticeIntentFailure.couldNotStart
    }
  }
}
