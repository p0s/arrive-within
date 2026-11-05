import ArriveWithinContent
import ArriveWithinDomain
import ArriveWithinMeditation
import ArriveWithinTestSupport
import Foundation
import Testing

@testable import ArriveWithin

@Suite("Siri and Shortcuts practice adapter")
@MainActor
struct PracticeIntentControllerTests {
  @Test("A timed silent start uses the remembered settings without saving them")
  func timedStartUsesRememberedConfiguration() async throws {
    let remembered = try TimerPreferences(
      durationMinutes: 20,
      audio: MeditationAudioConfiguration(intervalBellMinutes: 5)
    )
    let harness = try IntentHarness.make(profile: savedProfile(), timerPreferences: remembered)
    defer { harness.removeDirectory() }

    let outcome = try await harness.controller.startSilentPractice(minutes: 10)

    #expect(outcome == .started(PracticeIntentStatus(kind: .timer, phase: .running, plannedMinutes: 10)))
    let session = try #require(harness.model.activeSession)
    #expect(session.mode == .timer)
    #expect(session.targetDurationMilliseconds == 600_000)
    #expect(session.configuration.audio.intervalBellMinutes == 5)
    #expect(session.configuration.preparation == .off)
    #expect(await harness.preferences.saveCount == 0)
    #expect(harness.model.timerPreferences == remembered)
    #expect(try await harness.ledgerCount() == 0)
  }

  // Negative control (ADR-0015): removing `activeSession == nil` from the guard
  // in `AppModel.startPractice` must make this test fail. The adapter has no
  // second duplicate guard of its own.
  @Test("Repeated starts report the existing practice and create no second session")
  func repeatedStartsReuseTheExistingPractice() async throws {
    let harness = try IntentHarness.make(profile: savedProfile())
    defer { harness.removeDirectory() }

    let first = try await harness.controller.startSilentPractice(minutes: 10)
    let sessionID = try #require(harness.model.activeSession?.id)
    let existing = PracticeIntentStatus(kind: .timer, phase: .running, plannedMinutes: 10)
    #expect(first == .started(existing))

    #expect(try await harness.controller.startSilentPractice(minutes: 5) == .alreadyInProgress(existing))
    #expect(try await harness.controller.startSilentPractice(minutes: nil) == .alreadyInProgress(existing))
    #expect(
      try await harness.controller.startGuidedPractice(practiceID: "G01", language: .english)
        == .alreadyInProgress(existing)
    )

    #expect(harness.model.activeSession?.id == sessionID)
    #expect(harness.model.activeSession?.targetDurationMilliseconds == 600_000)
    #expect(await harness.sessions.distinctSavedSessionCount == 1)
    #expect(try await harness.ledgerCount() == 0)
    #expect(harness.model.completionPresentation == nil)
  }

  @Test("An empty length starts the open-ended stopwatch")
  func emptyLengthStartsOpenEndedPractice() async throws {
    let harness = try IntentHarness.make(profile: savedProfile())
    defer { harness.removeDirectory() }

    let outcome = try await harness.controller.startSilentPractice(minutes: nil)

    #expect(outcome == .started(PracticeIntentStatus(kind: .openEnded, phase: .running, plannedMinutes: nil)))
    #expect(harness.model.activeSession?.mode == .stopwatch)
    #expect(harness.model.activeSession?.targetDurationMilliseconds == nil)
  }

  @Test("Lengths outside 1 to 180 minutes fail before anything loads or starts")
  func invalidLengthsFailBeforeLoading() async throws {
    let harness = IntentHarness.make()
    defer { harness.removeDirectory() }

    for minutes in [0, -5, 181, 10_000] {
      await #expect(throws: PracticeIntentFailure.invalidDuration) {
        try await harness.controller.startSilentPractice(minutes: minutes)
      }
    }
    #expect(harness.model.launchPhase == .loading)
    #expect(harness.model.activeSession == nil)
    #expect(await harness.profiles.saveCount == 0)
    #expect(await harness.sessions.savedSessionIDs.isEmpty)
  }

  @Test("The shortest and longest lengths start, and short practices are marked as not growing")
  func boundaryLengthsStart() async throws {
    let shortest = try IntentHarness.make(profile: savedProfile())
    defer { shortest.removeDirectory() }
    let short = try await shortest.controller.startSilentPractice(minutes: 1)
    #expect(short.status.plannedMinutes == 1)
    #expect(short.status.isBelowGrowthMinimum)
    #expect(shortest.model.activeSession?.targetDurationMilliseconds == 60_000)

    let longest = try IntentHarness.make(profile: savedProfile())
    defer { longest.removeDirectory() }
    let long = try await longest.controller.startSilentPractice(minutes: 180)
    #expect(long.status.plannedMinutes == 180)
    #expect(!long.status.isBelowGrowthMinimum)
    #expect(longest.model.activeSession?.targetDurationMilliseconds == 10_800_000)
  }

  @Test("A first-ever start creates the profile like first use and shows the practice")
  func firstStartLeavesFirstUse() async throws {
    let harness = IntentHarness.make()
    defer { harness.removeDirectory() }

    let outcome = try await harness.controller.startSilentPractice(minutes: 3)

    #expect(outcome == .started(PracticeIntentStatus(kind: .timer, phase: .running, plannedMinutes: 3)))
    #expect(harness.model.launchPhase == .ready)
    #expect(harness.model.selectedSection == .practice)
    #expect(harness.model.profile != nil)
    #expect(await harness.profiles.saveCount == 1)
  }

  @Test("A start that arrives before loading keeps the saved profile and paused session")
  func startBeforeLoadingKeepsSavedState() async throws {
    let profile = try savedProfile()
    let saved = try savedStopwatch(pausedAfterMilliseconds: 240_000)
    let harness = IntentHarness.make(profile: profile, session: saved)
    defer { harness.removeDirectory() }
    #expect(harness.model.launchPhase == .loading)

    let outcome = try await harness.controller.startSilentPractice(minutes: 10)

    #expect(outcome == .alreadyInProgress(PracticeIntentStatus(kind: .openEnded, phase: .paused, plannedMinutes: nil)))
    #expect(harness.model.profile?.profileGenerationID == profile.profileGenerationID)
    #expect(harness.model.activeSession?.id == saved.id)
    #expect(harness.model.activeSession?.activeMilliseconds == 240_000)
    #expect(await harness.profiles.saveCount == 0)
    #expect(await harness.sessions.savedSessionIDs.isEmpty)
  }

  @Test("A saved running practice that awaits the recovery choice is reported and left unchanged")
  func recoveryChoiceIsNeverMadeBySiri() async throws {
    let saved = try savedStopwatch(pausedAfterMilliseconds: nil)
    let harness = try IntentHarness.make(profile: savedProfile(), session: saved)
    defer { harness.removeDirectory() }

    let outcome = try await harness.controller.startSilentPractice(minutes: 10)
    #expect(
      outcome == .alreadyInProgress(
        PracticeIntentStatus(kind: .openEnded, phase: .awaitingRecoveryChoice, plannedMinutes: nil)
      )
    )
    await #expect(throws: PracticeIntentFailure.recoveryChoicePending) {
      try await harness.controller.setPaused(true)
    }
    await #expect(throws: PracticeIntentFailure.recoveryChoicePending) {
      try await harness.controller.setPaused(false)
    }

    #expect(harness.model.recoveryAssessment != nil)
    #expect(harness.model.activeSession?.phase == .running)
    #expect(await harness.sessions.savedSessionIDs.isEmpty)
    #expect(try await harness.ledgerCount() == 0)
  }

  @Test("A process that has not loaded state never resumes a saved paused practice")
  func unloadedProcessNeverTouchesSavedSession() async throws {
    let saved = try savedStopwatch(pausedAfterMilliseconds: 120_000)
    let harness = try IntentHarness.make(profile: savedProfile(), session: saved)
    defer { harness.removeDirectory() }

    await #expect(throws: PracticeIntentFailure.noLivePractice) {
      try await harness.controller.setPaused(false)
    }
    await #expect(throws: PracticeIntentFailure.noLivePractice) {
      try await harness.controller.setPaused(true)
    }

    #expect(harness.model.launchPhase == .loading)
    #expect(harness.model.activeSession == nil)
    #expect(await harness.sessions.current?.phase == .paused)
    #expect(await harness.sessions.savedSessionIDs.isEmpty)
  }

  @Test("Pause and resume exclude the paused interval and repeat without changes")
  func pauseAndResumeAreIdempotent() async throws {
    let harness = try IntentHarness.make(profile: savedProfile())
    defer { harness.removeDirectory() }
    _ = try await harness.controller.startSilentPractice(minutes: nil)
    let paused = PracticeIntentStatus(kind: .openEnded, phase: .paused, plannedMinutes: nil)
    let running = PracticeIntentStatus(kind: .openEnded, phase: .running, plannedMinutes: nil)

    harness.clock.advance(milliseconds: 60_000)
    #expect(try await harness.controller.setPaused(true) == .changed(paused))
    #expect(harness.model.activeSession?.activeMilliseconds == 60_000)
    #expect(try await harness.controller.setPaused(true) == .unchanged(paused))

    harness.clock.advance(milliseconds: 30_000)
    #expect(try await harness.controller.setPaused(false) == .changed(running))
    #expect(try await harness.controller.setPaused(false) == .unchanged(running))

    harness.clock.advance(milliseconds: 15_000)
    let session = try #require(harness.model.activeSession)
    #expect(try session.elapsedMilliseconds(at: harness.clock.now()) == 75_000)
    #expect(await harness.sessions.distinctSavedSessionCount == 1)
    #expect(try await harness.ledgerCount() == 0)
    #expect(harness.model.completionPresentation == nil)
  }

  @Test("Pause without a live practice reports that none is in progress")
  func pauseWithoutPracticeFails() async throws {
    let ready = try IntentHarness.make(profile: savedProfile())
    defer { ready.removeDirectory() }
    await ready.model.start()
    #expect(ready.model.launchPhase == .ready)
    await #expect(throws: PracticeIntentFailure.noLivePractice) {
      try await ready.controller.setPaused(true)
    }

    let firstUse = IntentHarness.make()
    defer { firstUse.removeDirectory() }
    await firstUse.model.start()
    #expect(firstUse.model.launchPhase == .firstUse)
    await #expect(throws: PracticeIntentFailure.noLivePractice) {
      try await firstUse.controller.setPaused(true)
    }
    #expect(firstUse.model.activeSession == nil)
  }

  @Test("Pause during the preparation countdown is reported and changes nothing")
  func pauseDuringPreparationFails() async throws {
    let remembered = try TimerPreferences(durationMinutes: 10, preparation: .tenSeconds)
    let harness = try IntentHarness.make(profile: savedProfile(), timerPreferences: remembered)
    defer { harness.removeDirectory() }

    let outcome = try await harness.controller.startSilentPractice(minutes: 10)
    #expect(outcome == .started(PracticeIntentStatus(kind: .timer, phase: .preparing, plannedMinutes: 10)))
    await #expect(throws: PracticeIntentFailure.stillPreparing) {
      try await harness.controller.setPaused(true)
    }
    #expect(harness.model.activeSession?.phase == .prepared)
  }

  @Test("A guided start uses the catalog identity and the app language by default")
  func guidedStartUsesCatalogIdentity() async throws {
    let catalog = try #require(bundledCatalog())
    let practice = try #require(catalog.practices.first { $0.id == "G01" })
    let harness = try IntentHarness.make(profile: savedProfile(), language: .german)
    defer { harness.removeDirectory() }

    let outcome = try await harness.controller.startGuidedPractice(practiceID: "G01", language: nil)

    #expect(
      outcome == .started(
        PracticeIntentStatus(kind: .guided, phase: .running, plannedMinutes: practice.targetMinutes)
      )
    )
    let session = try #require(harness.model.activeSession)
    #expect(session.guidedContentID == practice.id)
    #expect(session.guidedContentVersion == practice.version)
    #expect(session.configuration.audio.narrationLanguageCode == "de")
    #expect(session.targetDurationMilliseconds == Int64(practice.targetMinutes) * 60_000)
  }

  @Test("An explicit narration language overrides the app language")
  func guidedStartHonorsNarrationLanguage() async throws {
    let harness = try IntentHarness.make(profile: savedProfile(), language: .german)
    defer { harness.removeDirectory() }

    _ = try await harness.controller.startGuidedPractice(practiceID: "G38", language: .english)

    #expect(harness.model.activeSession?.guidedContentID == "G38")
    #expect(harness.model.activeSession?.configuration.audio.narrationLanguageCode == "en")
  }

  @Test("Unpackaged narration fails with the existing notice and starts nothing")
  func unpackagedNarrationFails() async throws {
    let harness = try IntentHarness.make(
      profile: savedProfile(),
      audioController: UnavailableMeditationAudioController()
    )
    defer { harness.removeDirectory() }

    await #expect(throws: PracticeIntentFailure.narrationUnavailable) {
      try await harness.controller.startGuidedPractice(practiceID: "G10", language: .english)
    }
    #expect(harness.model.activeSession == nil)
    #expect(harness.model.audioNotice == .guidedNarrationPendingApproval)
    #expect(try await harness.ledgerCount() == 0)
  }

  @Test("An unknown practice or a missing catalog fails without starting")
  func unknownPracticeAndMissingCatalogFail() async throws {
    let harness = try IntentHarness.make(profile: savedProfile())
    defer { harness.removeDirectory() }
    await #expect(throws: PracticeIntentFailure.unknownPractice) {
      try await harness.controller.startGuidedPractice(practiceID: "G99", language: nil)
    }
    #expect(harness.model.activeSession == nil)

    let withoutCatalog = try IntentHarness.make(profile: savedProfile(), guidedCatalog: nil)
    defer { withoutCatalog.removeDirectory() }
    await #expect(throws: PracticeIntentFailure.catalogUnavailable) {
      try await withoutCatalog.controller.startGuidedPractice(practiceID: "G01", language: nil)
    }
    #expect(withoutCatalog.model.activeSession == nil)
  }

  @Test("A start during a data action is reported as busy")
  func startDuringDataActionIsBusy() async throws {
    let harness = try IntentHarness.make(profile: savedProfile())
    defer { harness.removeDirectory() }
    await harness.model.start()
    harness.model.isPerformingDataAction = true

    await #expect(throws: PracticeIntentFailure.busy) {
      try await harness.controller.startSilentPractice(minutes: 10)
    }
    #expect(harness.model.activeSession == nil)
    #expect(await harness.sessions.savedSessionIDs.isEmpty)
  }

  @Test("The entity list holds the 42 bundled practices with English and German titles")
  func entitiesMirrorTheCatalog() throws {
    let catalog = try #require(bundledCatalog())
    let entities = GuidedPracticeQuery.entities(in: catalog.practices)

    #expect(entities.count == 42)
    #expect(entities.map(\.id) == (1...42).map { String(format: "G%02d", $0) })
    for (entity, practice) in zip(entities, catalog.practices) {
      var title = entity.title
      title.locale = Locale(identifier: "en")
      #expect(String(localized: title) == practice.localized.en.title)
      title.locale = Locale(identifier: "de")
      #expect(String(localized: title) == practice.localized.de.title)
      #expect(entity.minutes == practice.targetMinutes)
      #expect(entity.purpose == GuidedPurposeAppEnum(practice.category))
    }

    let resolved = GuidedPracticeQuery.entities(in: catalog.practices, matching: ["G42", "G99", "G01"])
    #expect(resolved.map(\.id) == ["G42", "G01"])
  }

  @Test("Status values carry only mode, state, and planned minutes")
  func statusEntityIsMinimal() {
    let entity = PracticeStatusEntity(
      status: PracticeIntentStatus(kind: .guided, phase: .paused, plannedMinutes: 12)
    )
    #expect(entity.mode == .guided)
    #expect(entity.state == .paused)
    #expect(entity.plannedMinutes == 12)
    #expect(!PracticeIntentStatus(kind: .timer, phase: .running, plannedMinutes: 3).isBelowGrowthMinimum)
    #expect(PracticeIntentStatus(kind: .timer, phase: .running, plannedMinutes: 2).isBelowGrowthMinimum)
    #expect(!PracticeIntentStatus(kind: .openEnded, phase: .running, plannedMinutes: nil).isBelowGrowthMinimum)
  }

  @Test("Every failure explains itself in English and German")
  func failuresAreLocalized() {
    for failure in PracticeIntentFailure.allCases {
      var message = failure.localizedStringResource
      message.locale = Locale(identifier: "en")
      let english = String(localized: message)
      message.locale = Locale(identifier: "de")
      let german = String(localized: message)
      #expect(!english.isEmpty)
      #expect(!german.isEmpty)
      #expect(german != english, "missing German text for \(failure)")
    }
    var noPractice = PracticeIntentFailure.noLivePractice.localizedStringResource
    noPractice.locale = Locale(identifier: "en")
    #expect(String(localized: noPractice) == "No practice is in progress.")
  }
}

private let referenceDate = Date(timeIntervalSince1970: 1_786_320_000)

private func savedProfile() throws -> LocalProfile {
  try LocalProfile(
    profileGenerationID: ArriveWithinFixtures.generationID,
    gardenID: ArriveWithinFixtures.gardenID,
    gardenSeed: 42,
    installationID: ArriveWithinFixtures.installationID,
    createdAt: referenceDate.addingTimeInterval(-86_400),
    hasCompletedFirstUse: true
  )
}

/// A stopwatch persisted by an earlier process: running, or paused after the
/// given active time.
private func savedStopwatch(pausedAfterMilliseconds: Int64?) throws -> MeditationSession {
  let startedAt = referenceDate.addingTimeInterval(-600)
  var session = try MeditationSession(
    id: ArriveWithinFixtures.deterministicUUID(namespace: 0x60, ordinal: 1),
    profileGenerationID: ArriveWithinFixtures.generationID,
    mode: .stopwatch,
    preparedAt: startedAt
  )
  try session.start(at: SessionMoment(monotonicMilliseconds: 500, wallClock: startedAt))
  if let pausedAfterMilliseconds {
    try session.pause(
      at: SessionMoment(
        monotonicMilliseconds: 500 + pausedAfterMilliseconds,
        wallClock: startedAt.addingTimeInterval(Double(pausedAfterMilliseconds) / 1_000)
      )
    )
  }
  return session
}

private func bundledCatalog() -> GuidedCatalogDocument? {
  guard
    let url = Bundle.main.url(forResource: "catalog", withExtension: "json", subdirectory: "guided"),
    let data = try? Data(contentsOf: url)
  else {
    return nil
  }
  return try? GuidedCatalogLoader.decode(data)
}

@MainActor
private struct IntentHarness {
  let model: AppModel
  let controller: PracticeIntentController
  let sessions: CountingSessionRepository
  let profiles: CountingProfileRepository
  let preferences: CountingPreferencesRepository
  let events: InMemoryPracticeEventRepository
  let clock: VirtualSessionClock
  let directory: URL

  static func make(
    profile: LocalProfile? = nil,
    session: MeditationSession? = nil,
    timerPreferences: TimerPreferences = .standard,
    audioController: any MeditationAudioControlling = NoOpMeditationAudioController(),
    language: AppLanguage = .english,
    guidedCatalog: GuidedCatalogDocument? = bundledCatalog()
  ) -> IntentHarness {
    let sessions = CountingSessionRepository(seed: session)
    let profiles = CountingProfileRepository(seed: profile)
    let preferences = CountingPreferencesRepository(preferences: timerPreferences)
    let events = InMemoryPracticeEventRepository()
    let clock = VirtualSessionClock(
      moment: SessionMoment(monotonicMilliseconds: 1_000, wallClock: referenceDate)
    )
    let directory = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let model = AppModel(
      dependencies: AppDependencies(
        profileRepository: profiles,
        eventRepository: events,
        sessionRepository: sessions,
        preferencesRepository: preferences,
        appSettingsRepository: EphemeralAppSettingsRepository(language: language),
        guidedCatalog: guidedCatalog,
        completionCoordinator: SessionCompletionCoordinator(repository: events),
        clock: clock,
        dataDirectory: directory,
        audioController: audioController,
        timerEndAlertController: NoOpTimerEndAlertController(),
        hapticController: NoOpMeditationHapticController()
      )
    )
    return IntentHarness(
      model: model,
      controller: PracticeIntentController(
        model: model,
        loadPollInterval: .milliseconds(5),
        loadTimeout: .seconds(5)
      ),
      sessions: sessions,
      profiles: profiles,
      preferences: preferences,
      events: events,
      clock: clock,
      directory: directory
    )
  }

  func ledgerCount() async throws -> Int {
    let generationID = model.profile?.profileGenerationID ?? ArriveWithinFixtures.generationID
    return await events.allEvents(profileGenerationID: generationID).count
  }

  func removeDirectory() {
    try? FileManager.default.removeItem(at: directory)
  }
}

private actor CountingSessionRepository: MeditationSessionRepository {
  private(set) var current: MeditationSession?
  private(set) var savedSessionIDs: [UUID] = []

  init(seed: MeditationSession?) {
    current = seed
  }

  var distinctSavedSessionCount: Int { Set(savedSessionIDs).count }

  func activeSession(profileGenerationID: UUID) -> MeditationSession? {
    guard let current, current.profileGenerationID == profileGenerationID,
      [.prepared, .running, .paused, .completing].contains(current.phase)
    else {
      return nil
    }
    return current
  }

  func save(_ session: MeditationSession) {
    current = session
    savedSessionIDs.append(session.id)
  }

  func remove(sessionID: UUID, profileGenerationID: UUID) {
    guard current?.id == sessionID, current?.profileGenerationID == profileGenerationID else {
      return
    }
    current = nil
  }
}

private actor CountingProfileRepository: LocalProfileRepository {
  private(set) var profile: LocalProfile?
  private(set) var saveCount = 0

  init(seed: LocalProfile?) {
    profile = seed
  }

  func load() -> LocalProfile? { profile }

  func save(_ profile: LocalProfile) {
    self.profile = profile
    saveCount += 1
  }
}

private actor CountingPreferencesRepository: MeditationPreferencesRepository {
  private var preferences: TimerPreferences
  private(set) var saveCount = 0

  init(preferences: TimerPreferences) {
    self.preferences = preferences
  }

  func loadTimerPreferences() -> TimerPreferences { preferences }

  func saveTimerPreferences(_ preferences: TimerPreferences) {
    self.preferences = preferences
    saveCount += 1
  }
}
