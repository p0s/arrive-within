import ArriveWithinDomain
import ArriveWithinMeditation
import ArriveWithinPersistence
import ArriveWithinTestSupport
import Foundation
import Testing

@testable import ArriveWithin

@Suite("Native timer-to-garden vertical slice")
@MainActor
struct AppModelVerticalSliceTests {
  #if !targetEnvironment(simulator)
    @Test("A prepared timer starts bundled sound without a fallback notice on device")
    func preparedTimerStartsNativeAudioOnDevice() async throws {
      let eventRepository = InMemoryPracticeEventRepository()
      let clock = VirtualSessionClock(
        moment: SessionMoment(
          monotonicMilliseconds: 1_000,
          wallClock: Date(timeIntervalSince1970: 1_786_320_000)
        )
      )
      let audioController = try NativeMeditationAudioController(bundle: .main)
      defer { audioController.stop() }
      let model = AppModel(
        dependencies: AppDependencies(
          profileRepository: TestProfileRepository(),
          eventRepository: eventRepository,
          sessionRepository: TestSessionRepository(),
          preferencesRepository: TestPreferencesRepository(),
          completionCoordinator: SessionCompletionCoordinator(repository: eventRepository),
          clock: clock,
          dataDirectory: FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString, directoryHint: .isDirectory),
          audioController: audioController,
          timerEndAlertController: NoOpTimerEndAlertController(),
          hapticController: NoOpMeditationHapticController()
        )
      )
      let audio = try MeditationAudioConfiguration(
        intervalBellMinutes: 1,
        ambienceID: "still-air-v1",
        ambienceVolume: 0.3,
        otherAudioPolicy: .mixWithOthers,
        backgroundEndAlertEnabled: true
      )

      await model.start()
      try await model.startPractice(
        mode: .timer,
        targetMinutes: 3,
        configuration: MeditationSessionConfiguration(
          preparation: .fiveSeconds,
          audio: audio
        )
      )
      clock.advance(milliseconds: 5_000)
      try await Task.sleep(for: .milliseconds(350))

      #expect(model.activeSession?.phase == .running)
      #expect(model.audioNotice == nil)
    }
  #endif

  @Test("A three-minute completion visibly and durably advances the projection")
  func completionAdvancesGarden() async throws {
    let eventRepository = InMemoryPracticeEventRepository()
    let sessionRepository = TestSessionRepository()
    let clock = VirtualSessionClock(
      moment: SessionMoment(
        monotonicMilliseconds: 1_000,
        wallClock: Date(timeIntervalSince1970: 1_786_320_000)
      )
    )
    let model = AppModel(
      dependencies: AppDependencies(
        profileRepository: TestProfileRepository(),
        eventRepository: eventRepository,
        sessionRepository: sessionRepository,
        preferencesRepository: TestPreferencesRepository(),
        completionCoordinator: SessionCompletionCoordinator(repository: eventRepository),
        clock: clock,
        dataDirectory: FileManager.default.temporaryDirectory
          .appending(path: UUID().uuidString, directoryHint: .isDirectory),
        audioController: NoOpMeditationAudioController(),
        timerEndAlertController: NoOpTimerEndAlertController(),
        hapticController: NoOpMeditationHapticController()
      )
    )

    await model.start()
    #expect(model.launchPhase == .firstUse)
    await model.exploreGarden()
    #expect(model.gardenState?.journeyDay == 0)

    try await model.startPractice(mode: .timer, targetMinutes: 3)
    clock.advance(milliseconds: 180_000)
    await model.finishPractice()

    #expect(model.activeSession == nil)
    #expect(model.completionPresentation?.qualifiedForGrowth == true)
    #expect(model.gardenState?.journeyDay == 1)
    #expect(model.gardenState?.qualifyingSessionCount == 1)
  }

  @Test("Preparation remains prepared until the monotonic boundary")
  func preparationUsesMonotonicBoundary() async throws {
    let eventRepository = InMemoryPracticeEventRepository()
    let sessionRepository = TestSessionRepository()
    let clock = VirtualSessionClock(
      moment: SessionMoment(
        monotonicMilliseconds: 10_000,
        wallClock: Date(timeIntervalSince1970: 1_786_320_000)
      )
    )
    let model = AppModel(
      dependencies: AppDependencies(
        profileRepository: TestProfileRepository(),
        eventRepository: eventRepository,
        sessionRepository: sessionRepository,
        preferencesRepository: TestPreferencesRepository(),
        completionCoordinator: SessionCompletionCoordinator(repository: eventRepository),
        clock: clock,
        dataDirectory: FileManager.default.temporaryDirectory
          .appending(path: UUID().uuidString, directoryHint: .isDirectory),
        audioController: NoOpMeditationAudioController(),
        timerEndAlertController: NoOpTimerEndAlertController(),
        hapticController: NoOpMeditationHapticController()
      )
    )
    let configuration = MeditationSessionConfiguration(preparation: .fiveSeconds)

    await model.start()
    try await model.startPractice(
      mode: .timer,
      targetMinutes: 3,
      configuration: configuration
    )
    #expect(model.activeSession?.phase == .prepared)

    clock.advance(milliseconds: 4_999)
    try await Task.sleep(for: .milliseconds(120))
    #expect(model.activeSession?.phase == .prepared)

    clock.advance(milliseconds: 1)
    try await Task.sleep(for: .milliseconds(120))
    #expect(model.activeSession?.phase == .running)
  }

  @Test("Background end alert follows active time across pause and resume")
  func endAlertReschedulesFromRemainingActiveTime() async throws {
    let eventRepository = InMemoryPracticeEventRepository()
    let sessionRepository = TestSessionRepository()
    let alertController = RecordingTimerEndAlertController()
    let clock = VirtualSessionClock(
      moment: SessionMoment(
        monotonicMilliseconds: 1_000,
        wallClock: Date(timeIntervalSince1970: 1_786_320_000)
      )
    )
    let model = AppModel(
      dependencies: AppDependencies(
        profileRepository: TestProfileRepository(),
        eventRepository: eventRepository,
        sessionRepository: sessionRepository,
        preferencesRepository: TestPreferencesRepository(),
        completionCoordinator: SessionCompletionCoordinator(repository: eventRepository),
        clock: clock,
        dataDirectory: FileManager.default.temporaryDirectory
          .appending(path: UUID().uuidString, directoryHint: .isDirectory),
        audioController: NoOpMeditationAudioController(),
        timerEndAlertController: alertController,
        hapticController: NoOpMeditationHapticController()
      )
    )
    let audio = try MeditationAudioConfiguration(backgroundEndAlertEnabled: true)

    await model.start()
    await model.setAppLanguage(.german)
    try await model.startPractice(
      mode: .timer,
      targetMinutes: 3,
      configuration: MeditationSessionConfiguration(audio: audio)
    )
    let sessionID = try #require(model.activeSession?.id)
    #expect(alertController.scheduled.count == 1)
    #expect(alertController.scheduled[0].0 == sessionID)
    #expect(alertController.scheduled[0].1 == 180)
    #expect(alertController.scheduled[0].2 == "de_DE")

    clock.advance(milliseconds: 60_000)
    await model.pausePractice()
    #expect(alertController.cancelled.last == sessionID)

    await model.resumePractice()
    #expect(alertController.scheduled.last?.0 == sessionID)
    #expect(alertController.scheduled.last?.1 == 120)
  }

  @Test("Timer timing continues while interrupted audio rebuilds and resumes safely")
  func timerAudioEventsNeverPauseOrDuplicateCompletion() async throws {
    let eventRepository = InMemoryPracticeEventRepository()
    let sessionRepository = TestSessionRepository()
    let audioController = RecordingMeditationAudioController()
    let clock = VirtualSessionClock(
      moment: SessionMoment(
        monotonicMilliseconds: 1_000,
        wallClock: Date(timeIntervalSince1970: 1_786_320_000)
      )
    )
    let model = AppModel(
      dependencies: AppDependencies(
        profileRepository: TestProfileRepository(),
        eventRepository: eventRepository,
        sessionRepository: sessionRepository,
        preferencesRepository: TestPreferencesRepository(),
        completionCoordinator: SessionCompletionCoordinator(repository: eventRepository),
        clock: clock,
        dataDirectory: FileManager.default.temporaryDirectory
          .appending(path: UUID().uuidString, directoryHint: .isDirectory),
        audioController: audioController,
        timerEndAlertController: NoOpTimerEndAlertController(),
        hapticController: NoOpMeditationHapticController()
      )
    )

    await model.start()
    try await model.startPractice(mode: .timer, targetMinutes: 3)
    #expect(model.activeSession?.phase == .running)
    #expect(audioController.beginCount == 1)

    clock.advance(milliseconds: 60_000)
    audioController.emit(.interruptionBegan)
    try await Task.sleep(for: .milliseconds(30))
    #expect(model.activeSession?.phase == .running)
    #expect(try model.activeSession?.elapsedMilliseconds(at: clock.now()) == 60_000)
    #expect(model.audioNotice == .interrupted)
    #expect(audioController.rebuildCount == 1)
    #expect(await eventRepository.allEvents(profileGenerationID: model.profile!.profileGenerationID).isEmpty)

    audioController.emit(.interruptionEnded)
    try await Task.sleep(for: .milliseconds(30))
    #expect(model.activeSession?.phase == .running)
    #expect(audioController.resumeCount == 1)
    #expect(audioController.resumeElapsedMilliseconds == [60_000])
    #expect(model.audioNotice == nil)

    clock.advance(milliseconds: 60_000)
    audioController.emit(.outputRouteLost)
    try await Task.sleep(for: .milliseconds(30))
    #expect(model.activeSession?.phase == .running)
    #expect(try model.activeSession?.elapsedMilliseconds(at: clock.now()) == 120_000)
    #expect(model.audioNotice == .outputRouteLost)
    #expect(audioController.rebuildCount == 2)
    audioController.emit(.outputRouteAvailable)
    try await Task.sleep(for: .milliseconds(30))
    #expect(model.activeSession?.phase == .running)
    #expect(audioController.resumeCount == 2)
    #expect(audioController.resumeElapsedMilliseconds == [60_000, 120_000])

    clock.advance(milliseconds: 30_000)
    audioController.emit(.mediaServicesReset)
    try await Task.sleep(for: .milliseconds(30))
    #expect(model.activeSession?.phase == .running)
    #expect(try model.activeSession?.elapsedMilliseconds(at: clock.now()) == 150_000)
    #expect(audioController.rebuildCount == 3)
    #expect(audioController.resumeCount == 3)
    #expect(audioController.resumeElapsedMilliseconds == [60_000, 120_000, 150_000])
    #expect(model.audioNotice == nil)

    clock.advance(milliseconds: 30_000)
    await model.finishPractice()
    let events = await eventRepository.allEvents(
      profileGenerationID: try #require(model.profile?.profileGenerationID)
    )
    #expect(events.count == 1)
    #expect(events[0].activeMilliseconds == 180_000)
    audioController.emit(.interruptionBegan)
    try await Task.sleep(for: .milliseconds(10))
    #expect(
      await eventRepository.allEvents(
        profileGenerationID: try #require(model.profile?.profileGenerationID)
      ).count == 1
    )
  }

  @Test("Active audio mix controls affect only layers present in the current session")
  func activeAudioMixControlsAreSessionScoped() async throws {
    let eventRepository = InMemoryPracticeEventRepository()
    let audioController = RecordingMeditationAudioController()
    let model = AppModel(
      dependencies: AppDependencies(
        profileRepository: TestProfileRepository(),
        eventRepository: eventRepository,
        sessionRepository: TestSessionRepository(),
        preferencesRepository: TestPreferencesRepository(),
        completionCoordinator: SessionCompletionCoordinator(repository: eventRepository),
        clock: VirtualSessionClock(
          moment: SessionMoment(
            monotonicMilliseconds: 1_000,
            wallClock: Date(timeIntervalSince1970: 1_786_320_000)
          )
        ),
        dataDirectory: FileManager.default.temporaryDirectory
          .appending(path: UUID().uuidString, directoryHint: .isDirectory),
        audioController: audioController,
        timerEndAlertController: NoOpTimerEndAlertController(),
        hapticController: NoOpMeditationHapticController()
      )
    )
    let audio = try MeditationAudioConfiguration(
      ambienceID: "still-air-v1",
      ambienceVolume: 0.18,
      narrationLanguageCode: "en"
    )

    await model.start()
    try await model.startPractice(
      mode: .guided,
      targetMinutes: 3,
      configuration: MeditationSessionConfiguration(audio: audio),
      guidedContentID: "G01",
      guidedContentVersion: 1
    )
    model.setNarrationVolume(0.7)
    model.setAmbienceVolume(0.25)

    #expect(audioController.narrationVolumes == [0.7])
    #expect(audioController.ambienceVolumes == [0.25])
  }

  @Test("An open-ended stopwatch crosses qualification without auto-finishing and inserts once")
  func stopwatchQualificationIsTruthfulAndIdempotent() async throws {
    let eventRepository = InMemoryPracticeEventRepository()
    let sessionRepository = TestSessionRepository()
    let clock = VirtualSessionClock(
      moment: SessionMoment(
        monotonicMilliseconds: 1_000,
        wallClock: Date(timeIntervalSince1970: 1_786_320_000)
      )
    )
    let model = AppModel(
      dependencies: AppDependencies(
        profileRepository: TestProfileRepository(),
        eventRepository: eventRepository,
        sessionRepository: sessionRepository,
        preferencesRepository: TestPreferencesRepository(),
        completionCoordinator: SessionCompletionCoordinator(repository: eventRepository),
        clock: clock,
        dataDirectory: FileManager.default.temporaryDirectory
          .appending(path: UUID().uuidString, directoryHint: .isDirectory),
        audioController: NoOpMeditationAudioController(),
        timerEndAlertController: NoOpTimerEndAlertController(),
        hapticController: NoOpMeditationHapticController()
      )
    )

    await model.start()
    await model.exploreGarden()
    try await model.startPractice(mode: .stopwatch, targetMinutes: nil)
    #expect(model.activeSession?.mode == .stopwatch)
    #expect(model.activeSession?.targetDurationMilliseconds == nil)

    clock.advance(milliseconds: 179_999)
    await model.updateForForeground()
    #expect(model.elapsedMilliseconds == 179_999)
    #expect(model.activeSession?.phase == .running)
    #expect(model.completionPresentation == nil)

    clock.advance(milliseconds: 1)
    await model.updateForForeground()
    #expect(model.elapsedMilliseconds == PracticeEvent.qualificationMilliseconds)
    #expect(model.activeSession?.phase == .running)
    #expect(model.completionPresentation == nil)

    await model.finishPractice()
    let generationID = try #require(model.profile?.profileGenerationID)
    let events = await eventRepository.allEvents(profileGenerationID: generationID)
    let event = try #require(events.first)
    #expect(events.count == 1)
    #expect(event.mode == .stopwatch)
    #expect(event.activeMilliseconds == PracticeEvent.qualificationMilliseconds)
    #expect(event.qualifiesForGrowth)
    #expect(model.completionPresentation?.qualifiedForGrowth == true)
    #expect(model.gardenState?.journeyDay == 1)

    await model.finishPractice()
    #expect(await eventRepository.allEvents(profileGenerationID: generationID).count == 1)
  }

  @Test("A terminated stopwatch offers bounded recovery and requires an explicit resume")
  func stopwatchRecoveryUsesInjectedWallClockAndPauses() async throws {
    let eventRepository = InMemoryPracticeEventRepository()
    let sessionRepository = TestSessionRepository()
    let profileRepository = TestProfileRepository()
    let preferencesRepository = TestPreferencesRepository()
    let clock = VirtualSessionClock(
      moment: SessionMoment(
        monotonicMilliseconds: 1_000,
        wallClock: Date(timeIntervalSince1970: 1_786_320_000)
      )
    )
    let directory = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    var firstModel: AppModel? = AppModel(
      dependencies: AppDependencies(
        profileRepository: profileRepository,
        eventRepository: eventRepository,
        sessionRepository: sessionRepository,
        preferencesRepository: preferencesRepository,
        completionCoordinator: SessionCompletionCoordinator(repository: eventRepository),
        clock: clock,
        dataDirectory: directory,
        audioController: NoOpMeditationAudioController(),
        timerEndAlertController: NoOpTimerEndAlertController(),
        hapticController: NoOpMeditationHapticController()
      )
    )
    await firstModel?.start()
    await firstModel?.exploreGarden()
    try await firstModel?.startPractice(mode: .stopwatch, targetMinutes: nil)
    clock.advance(milliseconds: 120_000)
    firstModel = nil

    let restoredModel = AppModel(
      dependencies: AppDependencies(
        profileRepository: profileRepository,
        eventRepository: eventRepository,
        sessionRepository: sessionRepository,
        preferencesRepository: preferencesRepository,
        completionCoordinator: SessionCompletionCoordinator(repository: eventRepository),
        clock: clock,
        dataDirectory: directory,
        audioController: NoOpMeditationAudioController(),
        timerEndAlertController: NoOpTimerEndAlertController(),
        hapticController: NoOpMeditationHapticController()
      )
    )
    await restoredModel.start()
    let assessment = try #require(restoredModel.recoveryAssessment)
    #expect(assessment.lastConfirmedActiveMilliseconds == 0)
    #expect(assessment.maximumPlausibleActiveMilliseconds == 120_000)

    await restoredModel.confirmRecovery(useMaximumPlausibleTime: true)
    #expect(restoredModel.recoveryAssessment == nil)
    #expect(restoredModel.activeSession?.phase == .paused)
    #expect(restoredModel.elapsedMilliseconds == 120_000)

    clock.advance(milliseconds: 60_000)
    #expect(restoredModel.elapsedMilliseconds == 120_000)
    await restoredModel.resumePractice()
    clock.advance(milliseconds: 60_000)
    await restoredModel.updateForForeground()
    #expect(restoredModel.elapsedMilliseconds == PracticeEvent.qualificationMilliseconds)
  }

  @Test("A private voice reflection survives optional text and on-device transcription adapters")
  func privateVoiceReflectionAdapters() async throws {
    let eventRepository = InMemoryPracticeEventRepository()
    let recorder = TestJournalAudioRecorder()
    let transcriber = TestJournalTranscriber()
    let directory = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    let model = AppModel(
      dependencies: AppDependencies(
        profileRepository: TestProfileRepository(),
        eventRepository: eventRepository,
        sessionRepository: TestSessionRepository(),
        preferencesRepository: TestPreferencesRepository(),
        completionCoordinator: SessionCompletionCoordinator(repository: eventRepository),
        clock: VirtualSessionClock(
          moment: SessionMoment(
            monotonicMilliseconds: 1_000,
            wallClock: Date(timeIntervalSince1970: 1_786_320_000)
          )
        ),
        dataDirectory: directory,
        audioController: NoOpMeditationAudioController(),
        timerEndAlertController: NoOpTimerEndAlertController(),
        hapticController: NoOpMeditationHapticController(),
        journalAudioRecorder: recorder,
        journalTranscriber: transcriber
      )
    )

    await model.start()
    await model.exploreGarden()
    await model.beginJournalRecording()
    #expect(recorder.startCount == 1)
    let attachment = try #require(model.finishJournalRecording())
    let transcript = try #require(
      await model.transcribeJournalAudio(attachment, localeIdentifier: "en-US")
    )
    let saved = await model.saveJournalEntry(
      existing: nil,
      linkedPracticeEventID: nil,
      text: "",
      audioAttachment: attachment,
      transcript: transcript,
      transcriptionState: .complete
    )
    model.commitPendingJournalRecording()

    #expect(saved?.audioAttachment == attachment)
    #expect(saved?.transcript?.text == "A private local transcript.")
    #expect(model.journalEntries.count == 1)
  }

  @Test("A reminder is persisted before contextual permission and reconciles idempotently")
  func weeklyReminderContextAndReconciliation() async throws {
    let eventRepository = InMemoryPracticeEventRepository()
    let reminderRepository = EphemeralWeeklyReminderScheduleRepository()
    let reminderController = RecordingWeeklyReminderNotificationController(
      authorization: .notDetermined,
      requestResult: .authorized,
      pendingIdentifiers: ["arrive-within.weekly-reminder.stale"]
    )
    let model = AppModel(
      dependencies: AppDependencies(
        profileRepository: TestProfileRepository(),
        eventRepository: eventRepository,
        sessionRepository: TestSessionRepository(),
        preferencesRepository: TestPreferencesRepository(),
        weeklyReminderRepository: reminderRepository,
        completionCoordinator: SessionCompletionCoordinator(repository: eventRepository),
        clock: VirtualSessionClock(
          moment: SessionMoment(
            monotonicMilliseconds: 1_000,
            wallClock: Date(timeIntervalSince1970: 1_786_320_000)
          )
        ),
        dataDirectory: FileManager.default.temporaryDirectory
          .appending(path: UUID().uuidString, directoryHint: .isDirectory),
        audioController: NoOpMeditationAudioController(),
        timerEndAlertController: NoOpTimerEndAlertController(),
        weeklyReminderNotificationController: reminderController,
        hapticController: NoOpMeditationHapticController()
      )
    )

    await model.start()
    await model.setAppLanguage(.german)
    #expect(reminderController.requestCount == 0)
    #expect(reminderController.removedIdentifiers.contains("arrive-within.weekly-reminder.stale"))

    #expect(
      await model.saveWeeklyReminder(
        existing: nil,
        weekday: .monday,
        hour: 20,
        minute: 0
      )
    )
    let saved = try #require(model.weeklyReminderSchedules.first)
    #expect(reminderController.requestCount == 1)
    #expect(reminderController.upserted.last == saved)
    #expect(reminderController.upsertedLocaleIdentifiers.last == "de_DE")
    #expect(model.reminderDeliveryStatus == .scheduled(1))
    #expect(await reminderRepository.loadWeeklyReminderSchedules() == [saved])

    await model.setAppLanguage(.english)
    #expect(reminderController.upserted.last == saved)
    #expect(reminderController.upsertedLocaleIdentifiers.last == "en_US")

    #expect(
      await model.saveWeeklyReminder(
        existing: saved,
        weekday: .tuesday,
        hour: 7,
        minute: 45
      )
    )
    let edited = try #require(model.weeklyReminderSchedules.first)
    #expect(edited.id == saved.id)
    #expect(edited.weekday == .tuesday)
    #expect(reminderController.requestCount == 1)
    #expect(reminderController.upserted.last == edited)

    await model.deleteWeeklyReminder(edited)
    #expect(model.weeklyReminderSchedules.isEmpty)
    #expect(model.reminderDeliveryStatus == .inactive)
    #expect(
      reminderController.removedIdentifiers.contains(
        WeeklyReminderNotificationIdentifier.value(for: edited.id)
      )
    )
  }

  @Test("Denied reminder permission preserves the local schedule and later foreground recovers")
  func deniedReminderRemainsLocalThenRecovers() async throws {
    let eventRepository = InMemoryPracticeEventRepository()
    let reminderRepository = EphemeralWeeklyReminderScheduleRepository()
    let reminderController = RecordingWeeklyReminderNotificationController(
      authorization: .notDetermined,
      requestResult: .denied
    )
    let model = AppModel(
      dependencies: AppDependencies(
        profileRepository: TestProfileRepository(),
        eventRepository: eventRepository,
        sessionRepository: TestSessionRepository(),
        preferencesRepository: TestPreferencesRepository(),
        weeklyReminderRepository: reminderRepository,
        completionCoordinator: SessionCompletionCoordinator(repository: eventRepository),
        clock: VirtualSessionClock(
          moment: SessionMoment(
            monotonicMilliseconds: 1_000,
            wallClock: Date(timeIntervalSince1970: 1_786_320_000)
          )
        ),
        dataDirectory: FileManager.default.temporaryDirectory
          .appending(path: UUID().uuidString, directoryHint: .isDirectory),
        audioController: NoOpMeditationAudioController(),
        timerEndAlertController: NoOpTimerEndAlertController(),
        weeklyReminderNotificationController: reminderController,
        hapticController: NoOpMeditationHapticController()
      )
    )

    await model.start()
    #expect(
      await model.saveWeeklyReminder(
        existing: nil,
        weekday: .sunday,
        hour: 9,
        minute: 15
      )
    )
    #expect(model.reminderDeliveryStatus == .permissionDenied)
    #expect(model.reminderNotice == .permissionDenied)
    #expect(await reminderRepository.loadWeeklyReminderSchedules().count == 1)
    #expect(reminderController.upserted.isEmpty)

    reminderController.authorization = .authorized
    await model.updateForForeground()
    #expect(model.reminderDeliveryStatus == .scheduled(1))
    #expect(reminderController.upserted.count == 1)
  }

  @Test("A language preference activates only after durable save succeeds")
  func languageSaveFailurePreservesActiveChoice() async {
    let eventRepository = InMemoryPracticeEventRepository()
    let settingsRepository = RejectingAppSettingsRepository(language: .english)
    let model = AppModel(
      dependencies: AppDependencies(
        profileRepository: TestProfileRepository(),
        eventRepository: eventRepository,
        sessionRepository: TestSessionRepository(),
        preferencesRepository: TestPreferencesRepository(),
        appSettingsRepository: settingsRepository,
        completionCoordinator: SessionCompletionCoordinator(repository: eventRepository),
        clock: VirtualSessionClock(
          moment: SessionMoment(
            monotonicMilliseconds: 1_000,
            wallClock: Date(timeIntervalSince1970: 1_786_320_000)
          )
        ),
        dataDirectory: FileManager.default.temporaryDirectory
          .appending(path: UUID().uuidString, directoryHint: .isDirectory),
        audioController: NoOpMeditationAudioController(),
        timerEndAlertController: NoOpTimerEndAlertController(),
        hapticController: NoOpMeditationHapticController()
      )
    )

    await model.start()
    #expect(model.appLanguage == .english)
    await model.setAppLanguage(.german)
    #expect(model.appLanguage == .english)
    #expect(model.settingsNotice == .couldNotSaveLanguage)
  }

  @Test("Reduce Motion is projected into authoritative garden state")
  func reduceMotionUpdatesGardenState() async {
    let eventRepository = InMemoryPracticeEventRepository()
    let model = AppModel(
      dependencies: AppDependencies(
        profileRepository: TestProfileRepository(),
        eventRepository: eventRepository,
        sessionRepository: TestSessionRepository(),
        preferencesRepository: TestPreferencesRepository(),
        completionCoordinator: SessionCompletionCoordinator(repository: eventRepository),
        clock: VirtualSessionClock(
          moment: SessionMoment(
            monotonicMilliseconds: 1_000,
            wallClock: Date(timeIntervalSince1970: 1_786_320_000)
          )
        ),
        dataDirectory: FileManager.default.temporaryDirectory
          .appending(path: UUID().uuidString, directoryHint: .isDirectory),
        audioController: NoOpMeditationAudioController(),
        timerEndAlertController: NoOpTimerEndAlertController(),
        hapticController: NoOpMeditationHapticController()
      )
    )

    await model.start()
    await model.exploreGarden()
    #expect(model.gardenState?.reduceMotion == false)
    await model.updateReduceMotion(true)
    #expect(model.gardenState?.reduceMotion == true)
    await model.updateReduceMotion(false)
    #expect(model.gardenState?.reduceMotion == false)
  }

  @Test("Foreground refresh follows the native local clock without losing Reduce Motion")
  func foregroundRefreshUpdatesGardenDayPhase() async throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .current
    let dawnBoundary = try #require(
      calendar.date(
        from: DateComponents(year: 2026, month: 8, day: 13, hour: 7, minute: 59)
      )
    )
    let eventRepository = InMemoryPracticeEventRepository()
    let clock = VirtualSessionClock(
      moment: SessionMoment(monotonicMilliseconds: 1_000, wallClock: dawnBoundary)
    )
    let model = AppModel(
      dependencies: AppDependencies(
        profileRepository: TestProfileRepository(),
        eventRepository: eventRepository,
        sessionRepository: TestSessionRepository(),
        preferencesRepository: TestPreferencesRepository(),
        completionCoordinator: SessionCompletionCoordinator(repository: eventRepository),
        clock: clock,
        dataDirectory: FileManager.default.temporaryDirectory
          .appending(path: UUID().uuidString, directoryHint: .isDirectory),
        audioController: NoOpMeditationAudioController(),
        timerEndAlertController: NoOpTimerEndAlertController(),
        hapticController: NoOpMeditationHapticController()
      )
    )

    await model.start()
    await model.exploreGarden()
    await model.updateReduceMotion(true)
    #expect(model.gardenState?.localDayPhase == .dawn)

    clock.advance(milliseconds: 60_000)
    await model.updateForForeground()

    #expect(model.gardenState?.localDayPhase == .day)
    #expect(model.gardenState?.reduceMotion == true)
  }
}

@MainActor
private final class RecordingTimerEndAlertController: TimerEndAlertControlling {
  var scheduled: [(UUID, TimeInterval, String)] = []
  var cancelled: [UUID] = []

  func authorizationState() async -> TimerEndAlertAuthorization { .authorized }
  func requestAuthorization() async -> TimerEndAlertAuthorization { .authorized }
  func schedule(sessionID: UUID, after seconds: TimeInterval, locale: Locale) async throws {
    scheduled.append((sessionID, seconds, locale.identifier))
  }
  func cancel(sessionID: UUID) { cancelled.append(sessionID) }
}

@MainActor
private final class RecordingMeditationAudioController: MeditationAudioControlling {
  var eventHandler: ((MeditationAudioSystemEvent) -> Void)?
  var beginCount = 0
  var pauseCount = 0
  var resumeCount = 0
  var resumeElapsedMilliseconds: [Int64] = []
  var rebuildCount = 0
  var narrationVolumes: [Double] = []
  var ambienceVolumes: [Double] = []

  func validate(session: MeditationSession) throws { _ = session }
  func begin(session: MeditationSession) throws {
    _ = session
    beginCount += 1
  }
  func pause() { pauseCount += 1 }
  func resume(session: MeditationSession, elapsedMilliseconds: Int64) throws {
    _ = session
    resumeCount += 1
    resumeElapsedMilliseconds.append(elapsedMilliseconds)
  }
  func setNarrationVolume(_ volume: Double) { narrationVolumes.append(volume) }
  func setAmbienceVolume(_ volume: Double) { ambienceVolumes.append(volume) }
  func playIntervalBell() {}
  func finish(playClosingBell: Bool, targetReached: Bool) {
    _ = playClosingBell
    _ = targetReached
  }
  func stop() {}
  func rebuild() { rebuildCount += 1 }
  func emit(_ event: MeditationAudioSystemEvent) { eventHandler?(event) }
}

@MainActor
private final class RecordingWeeklyReminderNotificationController:
  WeeklyReminderNotificationControlling
{
  var authorization: ReminderNotificationAuthorization
  let requestResult: ReminderNotificationAuthorization
  var pendingIdentifiers: Set<String>
  var upserted: [WeeklyReminderSchedule] = []
  var upsertedLocaleIdentifiers: [String] = []
  var removedIdentifiers: Set<String> = []
  var requestCount = 0

  init(
    authorization: ReminderNotificationAuthorization,
    requestResult: ReminderNotificationAuthorization,
    pendingIdentifiers: Set<String> = []
  ) {
    self.authorization = authorization
    self.requestResult = requestResult
    self.pendingIdentifiers = pendingIdentifiers
  }

  func authorizationState() async -> ReminderNotificationAuthorization { authorization }

  func requestAuthorization() async -> ReminderNotificationAuthorization {
    requestCount += 1
    authorization = requestResult
    return authorization
  }

  func pendingWeeklyReminderIdentifiers() async -> Set<String> { pendingIdentifiers }

  func upsert(_ schedule: WeeklyReminderSchedule, locale: Locale) async throws {
    upserted.append(schedule)
    upsertedLocaleIdentifiers.append(locale.identifier)
    pendingIdentifiers.insert(WeeklyReminderNotificationIdentifier.value(for: schedule.id))
  }

  func removeWeeklyReminderIdentifiers(_ identifiers: Set<String>) {
    removedIdentifiers.formUnion(identifiers)
    pendingIdentifiers.subtract(identifiers)
  }
}

private actor TestPreferencesRepository: MeditationPreferencesRepository {
  private var preferences = TimerPreferences.standard

  func loadTimerPreferences() -> TimerPreferences { preferences }
  func saveTimerPreferences(_ preferences: TimerPreferences) { self.preferences = preferences }
}

private actor RejectingAppSettingsRepository: AppSettingsRepository {
  let language: AppLanguage

  init(language: AppLanguage) {
    self.language = language
  }

  func loadLanguage() -> AppLanguage { language }
  func saveLanguage(_ language: AppLanguage) throws {
    _ = language
    throw AppSettingsError.couldNotPersist
  }

  func loadGardenRenderStyle() -> GardenRenderStyle { .twilight }

  func saveGardenRenderStyle(_ style: GardenRenderStyle) throws {
    throw AppSettingsError.couldNotPersist
  }
  func deleteAll() throws {
    throw AppSettingsError.couldNotPersist
  }
}

private actor TestProfileRepository: LocalProfileRepository {
  private var profile: LocalProfile?

  func load() -> LocalProfile? { profile }
  func save(_ profile: LocalProfile) { self.profile = profile }
}

private actor TestSessionRepository: MeditationSessionRepository {
  private var session: MeditationSession?

  func activeSession(profileGenerationID: UUID) -> MeditationSession? {
    guard session?.profileGenerationID == profileGenerationID,
      let phase = session?.phase,
      [.prepared, .running, .paused, .completing].contains(phase)
    else {
      return nil
    }
    return session
  }

  func save(_ session: MeditationSession) {
    self.session = session
  }

  func remove(sessionID: UUID, profileGenerationID: UUID) {
    guard session?.id == sessionID, session?.profileGenerationID == profileGenerationID else {
      return
    }
    session = nil
  }
}

@MainActor
private final class TestJournalAudioRecorder: JournalAudioRecordingControlling {
  var eventHandler: ((JournalAudioRecordingEvent) -> Void)?
  var isRecording = false
  var elapsedMilliseconds: Int64 = 1_250
  var startCount = 0

  func requestPermission() async -> Bool { true }

  func start(fileURL: URL) throws {
    _ = fileURL
    startCount += 1
    isRecording = true
  }

  func stop() throws -> JournalAudioAttachment {
    isRecording = false
    return try JournalAudioAttachment(
      relativeFileName: "test-reflection.m4a",
      durationMilliseconds: 1_250,
      byteCount: 128,
      checksumSHA256: String(repeating: "0", count: 64),
      recordedAt: Date(timeIntervalSince1970: 1_786_320_000)
    )
  }

  func cancel() { isRecording = false }
}

@MainActor
private final class TestJournalTranscriber: JournalTranscribing {
  func transcribe(audioURL: URL, localeIdentifier: String) async throws -> JournalTranscript {
    _ = audioURL
    return try JournalTranscript(
      text: "A private local transcript.",
      localeIdentifier: localeIdentifier,
      generatedAt: Date(timeIntervalSince1970: 1_786_320_100)
    )
  }
}
