import ArriveWithinContent
import ArriveWithinDomain
import ArriveWithinGardenBridge
import ArriveWithinMeditation
import ArriveWithinPersistence
import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
  enum LaunchPhase: Equatable {
    case loading
    case firstUse
    case ready
    case failed
  }

  struct CompletionPresentation: Equatable {
    let qualifiedForGrowth: Bool
    let eventID: UUID
  }

  enum JournalNotice: Equatable {
    case editConflict
    case couldNotSave
    case couldNotExport
    case audioDeletionPending
    case exportCleanupPending
    case microphoneDenied
    case recordingFailed
    case recordingInterrupted
    case transcriptionUnavailable
  }

  enum DataNotice: Equatable {
    case exportFailed
    case resetComplete
    case resetCleanupPending
    case resetFailed
    case deletionComplete
    case deletionFailed
  }

  enum ReminderNotice: Equatable {
    case duplicateTime
    case permissionDenied
    case couldNotLoad
    case couldNotSave
    case couldNotSchedule
  }

  enum SettingsNotice: Equatable {
    case couldNotSaveLanguage
  }

  enum JournalRecordingPhase: Equatable {
    case idle
    case requestingPermission
    case recording(elapsedMilliseconds: Int64)
    case ready(JournalAudioAttachment)
    case interrupted(JournalAudioAttachment?)
    case permissionDenied
    case failed
  }

  enum AudioNotice: Equatable {
    case guidedNarrationPendingApproval
    case playbackUnavailable
    case interrupted
    case outputRouteLost
    case audioSystemReset
    case backgroundEndAlertDenied
    case guidedCatalogUnavailable
  }

  var launchPhase: LaunchPhase = .loading
  var selectedSection: AppSection = .garden
  var profile: LocalProfile?
  var gardenState: GardenState?
  var journeyProjection: JourneyProjection?
  var gardenCustomization = GardenCustomization()
  var activeSession: MeditationSession?
  var elapsedMilliseconds: Int64 = 0
  var preparationRemainingMilliseconds: Int64 = 0
  var timerPreferences: TimerPreferences = .standard
  var appLanguage: AppLanguage = .system
  var settingsNotice: SettingsNotice?
  var guidedPractices: [GuidedPractice] = []
  var favoriteGuidedPracticeIDs: Set<String> = []
  var journalEntries: [JournalEntry] = []
  var journalConflicts: [JournalReplicaConflict] = []
  var journalNotice: JournalNotice?
  var pendingReflectionEventID: UUID?
  var journalRecordingPhase: JournalRecordingPhase = .idle
  var productDataCounts = ProductDataCounts(
    profileGenerations: 0,
    practiceEvents: 0,
    journalEntries: 0,
    favoritePractices: 0,
    customizations: 0
  )
  var completeDataExportURL: URL?
  var dataNotice: DataNotice?
  var isPerformingDataAction = false
  var weeklyReminderSchedules: [WeeklyReminderSchedule] = []
  var reminderAuthorization: ReminderNotificationAuthorization = .notDetermined
  var reminderDeliveryStatus: ReminderDeliveryStatus = .inactive
  var reminderNotice: ReminderNotice?
  var audioNotice: AudioNotice?
  var timerEndAlertAuthorization: TimerEndAlertAuthorization = .notDetermined
  var completionPresentation: CompletionPresentation?
  var recoveryAssessment: SessionRecoveryAssessment?
  var forceNativeGarden = false
  var rendererIsReady = false
  var rendererFailureMessage: String?
  var rendererGeneration = 0
  var rendererSelectedQuality: GardenQualityHint = .balanced
  var rendererRecoveryCount = 0
  var rendererDiagnosticsExportURL: URL?

  @ObservationIgnored private let dependencies: AppDependencies
  @ObservationIgnored private var ticker: Task<Void, Never>?
  @ObservationIgnored private var preparationTask: Task<Void, Never>?
  @ObservationIgnored private var isCompleting = false
  @ObservationIgnored private var hasStarted = false
  @ObservationIgnored private var lastIntervalBellOrdinal: Int64 = 0
  @ObservationIgnored private var journalRecordingTicker: Task<Void, Never>?
  @ObservationIgnored private var rendererDiagnosticsRecorder = RendererDiagnosticsRecorder()

  init(dependencies: AppDependencies) {
    self.dependencies = dependencies
    guidedPractices = dependencies.guidedCatalog?.practices ?? []
    #if DEBUG
      forceNativeGarden = ProcessInfo.processInfo.arguments.contains("-ui-test-native-garden")
    #endif
    dependencies.audioController.eventHandler = { [weak self] event in
      self?.handleAudioSystemEvent(event)
    }
    dependencies.journalAudioRecorder.eventHandler = { [weak self] event in
      self?.handleJournalRecordingEvent(event)
    }
  }

  var appLocale: Locale { appLanguage.locale }

  func start() async {
    guard !hasStarted else { return }
    hasStarted = true

    do {
      try dependencies.exportStagingManager.purgeExpired(
        before: Date().addingTimeInterval(-ExportStagingManager.defaultTimeToLive)
      )
    } catch {
      journalNotice = .exportCleanupPending
    }

    do {
      appLanguage = try await dependencies.appSettingsRepository.loadLanguage()
    } catch {
      appLanguage = .system
    }
    #if DEBUG
      if let language = uiTestLanguageOverride() {
        appLanguage = language
        try? await dependencies.appSettingsRepository.saveLanguage(language)
      }
    #endif

    if let controller = dependencies.productDataController {
      await controller.discardObsoleteCloudDeletionMarkerForLocalStore()
      if let counts = try? await controller.counts() { productDataCounts = counts }
    }

    do {
      timerPreferences = try await dependencies.preferencesRepository.loadTimerPreferences()
    } catch {
      timerPreferences = .standard
    }
    do {
      favoriteGuidedPracticeIDs =
        try await dependencies.guidedFavoritesRepository.loadFavoritePracticeIDs()
        .intersection(Set(guidedPractices.map(\.id)))
    } catch {
      favoriteGuidedPracticeIDs = []
    }
    timerEndAlertAuthorization = await dependencies.timerEndAlertController.authorizationState()
    do {
      weeklyReminderSchedules = try await dependencies.weeklyReminderRepository
        .loadWeeklyReminderSchedules()
      #if DEBUG
        try await seedUITestReminderScheduleIfRequested()
      #endif
      await reconcileWeeklyReminders()
    } catch {
      reminderDeliveryStatus = .needsAttention
      reminderNotice = .couldNotLoad
    }

    do {
      guard let restoredProfile = try await dependencies.profileRepository.load() else {
        launchPhase = .firstUse
        return
      }
      profile = restoredProfile
      try await restoreProductState(for: restoredProfile)
      launchPhase = .ready
    } catch {
      launchPhase = .failed
    }
  }

  func retryLoad() async {
    ticker?.cancel()
    preparationTask?.cancel()
    dependencies.audioController.stop()
    if let session = activeSession {
      dependencies.timerEndAlertController.cancel(sessionID: session.id)
    }
    hasStarted = false
    launchPhase = .loading
    await start()
  }

  func beginFirstPractice() async {
    do {
      _ = try await createProfileIfNeeded()
      launchPhase = .ready
      selectedSection = .practice
      try await startPractice(
        mode: .timer,
        targetMinutes: 3,
        configuration: .standard
      )
    } catch {
      launchPhase = .failed
    }
  }

  func exploreGarden() async {
    do {
      _ = try await createProfileIfNeeded()
      launchPhase = .ready
      selectedSection = .garden
      try await refreshGarden()
    } catch {
      launchPhase = .failed
    }
  }

  func startPractice(
    mode: PracticeMode,
    targetMinutes: Int?,
    configuration suppliedConfiguration: MeditationSessionConfiguration? = nil,
    guidedContentID: String? = nil,
    guidedContentVersion: Int? = nil
  ) async throws {
    guard activeSession == nil else { return }
    let profile = try await createProfileIfNeeded()
    let moment = dependencies.clock.now()
    let guided = mode == .guided
    let resolvedGuidedContentID = guided ? guidedContentID : nil
    let resolvedGuidedContentVersion = guided ? guidedContentVersion : nil
    if guided, resolvedGuidedContentID == nil || resolvedGuidedContentVersion == nil {
      audioNotice = .guidedCatalogUnavailable
      return
    }
    let configuration = try suppliedConfiguration ?? defaultConfiguration(for: mode)
    let session = try MeditationSession(
      id: UUID(),
      profileGenerationID: profile.profileGenerationID,
      mode: mode,
      guidedContentID: resolvedGuidedContentID,
      guidedContentVersion: resolvedGuidedContentVersion,
      targetDurationMilliseconds: targetMinutes.map { Int64($0) * 60_000 },
      preparedAt: moment.wallClock,
      configuration: configuration
    )

    do {
      try dependencies.audioController.validate(session: session)
    } catch {
      if guided {
        audioNotice = .guidedNarrationPendingApproval
        return
      }
      audioNotice = .playbackUnavailable
    }

    try await dependencies.sessionRepository.save(session)
    activeSession = session
    elapsedMilliseconds = 0
    lastIntervalBellOrdinal = 0
    preparationRemainingMilliseconds = configuration.preparation.milliseconds
    completionPresentation = nil
    selectedSection = .practice
    if configuration.preparation == .off {
      await activatePreparedSession(id: session.id)
    } else {
      startPreparationCountdown(for: session)
    }
  }

  func beginPractice(mode: PracticeMode, targetMinutes: Int?) async {
    do {
      if mode == .guided, let practice = guidedPractices.first {
        let language: GuidedLanguage = appLanguage.languageCode == "de" ? .german : .english
        await startGuidedPractice(practiceID: practice.id, language: language)
      } else {
        try await startPractice(mode: mode, targetMinutes: targetMinutes)
      }
    } catch {
      launchPhase = .failed
    }
  }

  func startGuidedPractice(
    practiceID: String,
    language: GuidedLanguage,
    ambienceEnabled: Bool = false,
    ambienceVolume: Double = 0.18
  ) async {
    guard let practice = guidedPractices.first(where: { $0.id == practiceID }) else {
      audioNotice = .guidedCatalogUnavailable
      return
    }
    do {
      let audio = try MeditationAudioConfiguration(
        ambienceID: ambienceEnabled ? "still-air-v1" : nil,
        ambienceVolume: ambienceVolume,
        narrationLanguageCode: language.rawValue
      )
      try await startPractice(
        mode: .guided,
        targetMinutes: practice.targetMinutes,
        configuration: MeditationSessionConfiguration(audio: audio),
        guidedContentID: practice.id,
        guidedContentVersion: practice.version
      )
    } catch {
      launchPhase = .failed
    }
  }

  func setNarrationVolume(_ volume: Double) {
    guard activeSession?.mode == .guided else { return }
    dependencies.audioController.setNarrationVolume(volume)
  }

  func setAmbienceVolume(_ volume: Double) {
    guard activeSession?.configuration.audio.ambienceID != nil else { return }
    dependencies.audioController.setAmbienceVolume(volume)
  }

  func toggleFavorite(practiceID: String) async {
    guard guidedPractices.contains(where: { $0.id == practiceID }) else { return }
    if favoriteGuidedPracticeIDs.contains(practiceID) {
      favoriteGuidedPracticeIDs.remove(practiceID)
    } else {
      favoriteGuidedPracticeIDs.insert(practiceID)
    }
    do {
      try await dependencies.guidedFavoritesRepository.saveFavoritePracticeIDs(
        favoriteGuidedPracticeIDs
      )
      await refreshProductDataStatus()
    } catch {
      launchPhase = .failed
    }
  }

  func selectGardenVariant(milestoneID: Int, variantID: String) async {
    guard let state = gardenState,
      milestoneID <= state.highestMilestone,
      let milestone = GardenMilestones.definition(id: milestoneID),
      milestone.variants.contains(where: { $0.id == variantID }),
      let profile
    else { return }
    var updated = gardenCustomization
    updated.selectedVariantByMilestone[milestoneID] = variantID
    do {
      try await dependencies.gardenCustomizationRepository.save(
        updated,
        profileGenerationID: profile.profileGenerationID
      )
      gardenCustomization = updated
      try await refreshGarden(profile: profile)
      await refreshProductDataStatus()
    } catch {
      launchPhase = .failed
    }
  }

  func saveTimerPreferences(_ preferences: TimerPreferences) async {
    do {
      try await dependencies.preferencesRepository.saveTimerPreferences(preferences)
      timerPreferences = preferences
    } catch {
      launchPhase = .failed
    }
  }

  func setAppLanguage(_ language: AppLanguage) async {
    do {
      try await dependencies.appSettingsRepository.saveLanguage(language)
      appLanguage = language
      settingsNotice = nil
      await reconcileWeeklyReminders()
    } catch {
      settingsNotice = .couldNotSaveLanguage
    }
  }

  func requestTimerEndAlertAuthorization() async -> Bool {
    let current = await dependencies.timerEndAlertController.authorizationState()
    let resolved =
      current == .notDetermined
      ? await dependencies.timerEndAlertController.requestAuthorization()
      : current
    timerEndAlertAuthorization = resolved
    if resolved != .authorized {
      audioNotice = .backgroundEndAlertDenied
      return false
    }
    if audioNotice == .backgroundEndAlertDenied { audioNotice = nil }
    return true
  }

  @discardableResult
  func saveWeeklyReminder(
    existing: WeeklyReminderSchedule?,
    weekday: Weekday,
    hour: Int,
    minute: Int
  ) async -> Bool {
    guard !weeklyReminderSchedules.contains(where: {
      $0.id != existing?.id && $0.weekday == weekday && $0.hour == hour && $0.minute == minute
    }) else {
      reminderNotice = .duplicateTime
      return false
    }

    let now = Date()
    do {
      let schedule = try existing?.replacing(
        weekday: weekday,
        hour: hour,
        minute: minute,
        modifiedAt: now
      ) ?? WeeklyReminderSchedule(
        id: UUID(),
        weekday: weekday,
        hour: hour,
        minute: minute,
        createdAt: now,
        modifiedAt: now
      )
      var updated = weeklyReminderSchedules.filter { $0.id != schedule.id }
      updated.append(schedule)
      try await dependencies.weeklyReminderRepository.saveWeeklyReminderSchedules(updated)
      weeklyReminderSchedules = WeeklyReminderSchedule.sorted(updated)

      let current = await dependencies.weeklyReminderNotificationController.authorizationState()
      if current == .notDetermined {
        reminderAuthorization = await dependencies.weeklyReminderNotificationController
          .requestAuthorization()
        if reminderAuthorization == .denied { reminderNotice = .permissionDenied }
      }
      await reconcileWeeklyReminders()
      return true
    } catch {
      reminderNotice = .couldNotSave
      return false
    }
  }

  func setWeeklyReminderEnabled(_ schedule: WeeklyReminderSchedule, isEnabled: Bool) async {
    do {
      let updatedSchedule = try schedule.replacing(isEnabled: isEnabled, modifiedAt: Date())
      var updated = weeklyReminderSchedules.filter { $0.id != schedule.id }
      updated.append(updatedSchedule)
      try await dependencies.weeklyReminderRepository.saveWeeklyReminderSchedules(updated)
      weeklyReminderSchedules = WeeklyReminderSchedule.sorted(updated)
      if isEnabled,
        await dependencies.weeklyReminderNotificationController.authorizationState()
          == .notDetermined
      {
        reminderAuthorization = await dependencies.weeklyReminderNotificationController
          .requestAuthorization()
        if reminderAuthorization == .denied { reminderNotice = .permissionDenied }
      }
      await reconcileWeeklyReminders()
    } catch {
      reminderNotice = .couldNotSave
    }
  }

  func deleteWeeklyReminder(_ schedule: WeeklyReminderSchedule) async {
    let updated = weeklyReminderSchedules.filter { $0.id != schedule.id }
    do {
      try await dependencies.weeklyReminderRepository.saveWeeklyReminderSchedules(updated)
      weeklyReminderSchedules = WeeklyReminderSchedule.sorted(updated)
      await reconcileWeeklyReminders()
    } catch {
      reminderNotice = .couldNotSave
    }
  }

  func dismissReminderNotice() { reminderNotice = nil }

  func pausePractice() async {
    guard var session = activeSession, session.phase == .running else { return }
    do {
      try session.pause(at: dependencies.clock.now())
      try await dependencies.sessionRepository.save(session)
      activeSession = session
      elapsedMilliseconds = session.activeMilliseconds
      updateIntervalBellOrdinal(for: session.activeMilliseconds, session: session)
      ticker?.cancel()
      dependencies.audioController.pause()
      dependencies.timerEndAlertController.cancel(sessionID: session.id)
    } catch {
      launchPhase = .failed
    }
  }

  func resumePractice() async {
    guard var session = activeSession, session.phase == .paused else { return }
    do {
      do {
        try dependencies.audioController.resume(session: session)
        audioNotice = nil
      } catch {
        if session.mode == .guided {
          audioNotice = .guidedNarrationPendingApproval
          return
        }
        audioNotice = .playbackUnavailable
      }
      try session.resume(at: dependencies.clock.now())
      try await dependencies.sessionRepository.save(session)
      activeSession = session
      await scheduleTimerEndAlertIfNeeded(for: session)
      startTicker()
    } catch {
      launchPhase = .failed
    }
  }

  func finishPractice() async {
    if var session = activeSession, session.phase == .prepared {
      preparationTask?.cancel()
      do {
        try session.abandon(at: dependencies.clock.now().wallClock)
        try await dependencies.sessionRepository.save(session)
        activeSession = nil
        preparationRemainingMilliseconds = 0
        dependencies.audioController.stop()
        dependencies.timerEndAlertController.cancel(sessionID: session.id)
      } catch {
        launchPhase = .failed
      }
      return
    }
    await completeActiveSession()
  }

  func dismissCompletion(showGarden: Bool) {
    completionPresentation = nil
    if showGarden { selectedSection = .garden }
  }

  func beginReflectionFromCompletion() {
    guard let completionPresentation else { return }
    pendingReflectionEventID = completionPresentation.eventID
    self.completionPresentation = nil
    selectedSection = .journal
  }

  func consumePendingReflectionEventID() -> UUID? {
    defer { pendingReflectionEventID = nil }
    return pendingReflectionEventID
  }

  @discardableResult
  func saveJournalEntry(
    existing: JournalEntry?,
    linkedPracticeEventID: UUID?,
    text: String,
    audioAttachment: JournalAudioAttachment? = nil,
    transcript: JournalTranscript? = nil,
    transcriptionState: JournalTranscriptionState = .notRequested
  ) async -> JournalEntry? {
    guard let profile else { return nil }
    let now = Date()
    do {
      let candidate: JournalEntry
      if let existing {
        candidate = try existing.replacingContent(
          text: text,
          textLocaleIdentifier: appLocale.identifier,
          audioAttachment: audioAttachment,
          transcript: transcript,
          transcriptionState: transcriptionState,
          modifiedAt: max(now, existing.modifiedAt)
        )
      } else {
        candidate = try JournalEntry(
          id: UUID(),
          profileGenerationID: profile.profileGenerationID,
          linkedPracticeEventID: linkedPracticeEventID,
          createdAt: now,
          sourceInstallationID: profile.installationID,
          modifiedAt: now,
          text: text,
          textLocaleIdentifier: appLocale.identifier,
          audioAttachment: audioAttachment,
          transcript: transcript,
          transcriptionState: transcriptionState
        )
      }
      switch try await dependencies.journalRepository.save(
        candidate,
        expectedRevision: existing?.revision
      ) {
      case .saved(let saved):
        if let oldAttachment = existing?.audioAttachment,
          oldAttachment.relativeFileName != saved.audioAttachment?.relativeFileName
        {
          do {
            try FileManager.default.removeItem(
              at: dependencies.journalAudioDirectory.appending(
                path: oldAttachment.relativeFileName
              )
            )
          } catch let error as CocoaError where error.code == .fileNoSuchFile {
            // Already absent is a successful local deletion state.
          } catch {
            journalNotice = .audioDeletionPending
          }
        } else {
          journalNotice = nil
        }
        try await refreshJournal(profile: profile)
        await refreshProductDataStatus()
        return saved
      case .conflict:
        journalNotice = .editConflict
        try await refreshJournal(profile: profile)
        return nil
      }
    } catch {
      journalNotice = .couldNotSave
      return nil
    }
  }

  func deleteJournalEntry(_ entry: JournalEntry) async -> Bool {
    guard let profile, entry.profileGenerationID == profile.profileGenerationID else {
      return false
    }
    do {
      let tombstone = try entry.tombstoned(at: Date())
      switch try await dependencies.journalRepository.save(
        tombstone,
        expectedRevision: entry.revision
      ) {
      case .saved:
        var cleanupFailed = false
        do {
          try dependencies.exportStagingManager.purgeReflection(entryID: entry.id)
        } catch {
          journalNotice = .exportCleanupPending
          cleanupFailed = true
        }
        if let attachment = entry.audioAttachment {
          do {
            try FileManager.default.removeItem(
              at: dependencies.journalAudioDirectory.appending(path: attachment.relativeFileName)
            )
          } catch let error as CocoaError where error.code == .fileNoSuchFile {
            // Already absent is a successful local deletion state.
          } catch {
            journalNotice = .audioDeletionPending
            cleanupFailed = true
          }
        }
        try await refreshJournal(profile: profile)
        await refreshProductDataStatus()
        return !cleanupFailed
      case .conflict:
        journalNotice = .editConflict
        try await refreshJournal(profile: profile)
        return false
      }
    } catch {
      journalNotice = .couldNotSave
      return false
    }
  }

  func resolveJournalConflict(
    _ conflict: JournalReplicaConflict,
    keeping variant: JournalEntry
  ) async -> Bool {
    guard let profile,
      conflict.profileGenerationID == profile.profileGenerationID,
      variant.id == conflict.entryID,
      variant.revision == conflict.revision,
      conflict.variants.contains(variant)
    else { return false }
    do {
      let candidate: JournalEntry
      if variant.isDeleted {
        candidate = try variant.tombstoned(at: Date())
      } else {
        candidate = try variant.replacingContent(
          text: variant.text,
          textLocaleIdentifier: variant.textLocaleIdentifier,
          audioAttachment: variant.audioAttachment,
          transcript: variant.transcript,
          transcriptionState: variant.transcriptionState,
          modifiedAt: max(Date(), variant.modifiedAt)
        )
      }
      switch try await dependencies.journalRepository.save(
        candidate,
        expectedRevision: conflict.revision
      ) {
      case .saved:
        journalNotice = nil
        try await refreshJournal(profile: profile)
        await refreshProductDataStatus()
        return true
      case .conflict:
        journalNotice = .editConflict
        try await refreshJournal(profile: profile)
        return false
      }
    } catch {
      journalNotice = .couldNotSave
      return false
    }
  }

  func exportJournalEntry(_ entry: JournalEntry) async -> URL? {
    guard let profile, entry.profileGenerationID == profile.profileGenerationID else {
      return nil
    }
    do {
      let output = try dependencies.exportStagingManager.prepare(
        named: "arrive-within-reflection-\(entry.id.uuidString.lowercased())-r\(entry.revision)-\(Int64(Date().timeIntervalSince1970 * 1_000)).zip"
      )
      try JournalEntryExporter.export(
        entry: entry,
        audioDirectory: dependencies.journalAudioDirectory,
        outputURL: output
      )
      journalNotice = nil
      return output
    } catch {
      journalNotice = .couldNotExport
      return nil
    }
  }

  func discardOwnedExport(_ url: URL) {
    do {
      try dependencies.exportStagingManager.remove(url)
      if completeDataExportURL == url { completeDataExportURL = nil }
    } catch {
      journalNotice = .exportCleanupPending
    }
  }

  func beginJournalRecording() async {
    guard activeSession == nil else {
      journalRecordingPhase = .failed
      journalNotice = .recordingFailed
      return
    }
    discardPendingJournalRecording()
    journalRecordingPhase = .requestingPermission
    guard await dependencies.journalAudioRecorder.requestPermission() else {
      journalRecordingPhase = .permissionDenied
      journalNotice = .microphoneDenied
      return
    }
    dependencies.audioController.stop()
    let fileName = "reflection-\(UUID().uuidString.lowercased()).m4a"
    do {
      try dependencies.journalAudioRecorder.start(
        fileURL: dependencies.journalAudioDirectory.appending(path: fileName)
      )
      journalNotice = nil
      journalRecordingPhase = .recording(elapsedMilliseconds: 0)
      startJournalRecordingTicker()
    } catch {
      journalRecordingPhase = .failed
      journalNotice = .recordingFailed
    }
  }

  func finishJournalRecording() -> JournalAudioAttachment? {
    journalRecordingTicker?.cancel()
    do {
      let attachment = try dependencies.journalAudioRecorder.stop()
      journalRecordingPhase = .ready(attachment)
      return attachment
    } catch {
      journalRecordingPhase = .failed
      journalNotice = .recordingFailed
      return nil
    }
  }

  func discardPendingJournalRecording() {
    journalRecordingTicker?.cancel()
    if case .ready(let attachment) = journalRecordingPhase {
      try? FileManager.default.removeItem(
        at: dependencies.journalAudioDirectory.appending(path: attachment.relativeFileName)
      )
    } else if case .interrupted(let attachment?) = journalRecordingPhase {
      try? FileManager.default.removeItem(
        at: dependencies.journalAudioDirectory.appending(path: attachment.relativeFileName)
      )
    }
    dependencies.journalAudioRecorder.cancel()
    journalRecordingPhase = .idle
  }

  func commitPendingJournalRecording() {
    journalRecordingTicker?.cancel()
    journalRecordingPhase = .idle
  }

  func transcribeJournalAudio(
    _ attachment: JournalAudioAttachment,
    localeIdentifier: String
  ) async -> JournalTranscript? {
    let url = dependencies.journalAudioDirectory.appending(path: attachment.relativeFileName)
    do {
      let transcript = try await dependencies.journalTranscriber.transcribe(
        audioURL: url,
        localeIdentifier: localeIdentifier
      )
      journalNotice = nil
      return transcript
    } catch {
      journalNotice = .transcriptionUnavailable
      return nil
    }
  }

  func journalAudioURL(for attachment: JournalAudioAttachment) -> URL? {
    let url = dependencies.journalAudioDirectory.appending(path: attachment.relativeFileName)
    return FileManager.default.fileExists(atPath: url.path) ? url : nil
  }

  func exportAllProductData() async {
    guard let profile, let controller = dependencies.productDataController else {
      dataNotice = .exportFailed
      return
    }
    isPerformingDataAction = true
    defer { isPerformingDataAction = false }
    do {
      completeDataExportURL = try await controller.exportAll(profile: profile, at: Date())
      dataNotice = nil
      await refreshProductDataStatus()
    } catch {
      completeDataExportURL = nil
      dataNotice = .exportFailed
    }
  }

  func resetGardenAndPrivateHistory() async {
    guard activeSession == nil, let profile, let controller = dependencies.productDataController else {
      dataNotice = .resetFailed
      return
    }
    isPerformingDataAction = true
    defer { isPerformingDataAction = false }
    discardPendingJournalRecording()
    completionPresentation = nil
    pendingReflectionEventID = nil
    do {
      let outcome = try await controller.resetGarden(
        profile: profile,
        newProfileGenerationID: UUID(),
        newGardenID: UUID(),
        newGardenSeed: UInt64.random(
          in: 0...GardenSeedContract.maximumExactCrossRuntimeValue
        ),
        at: Date()
      )
      self.profile = outcome.profile
      gardenCustomization = GardenCustomization()
      journalEntries = []
      journalConflicts = []
      completeDataExportURL = nil
      try await refreshGarden(profile: outcome.profile)
      try await refreshJournal(profile: outcome.profile)
      await refreshProductDataStatus()
      dataNotice = outcome.cleanupPending ? .resetCleanupPending : .resetComplete
      selectedSection = .garden
    } catch {
      dataNotice = .resetFailed
    }
  }

  func deleteAllProductData() async {
    guard let controller = dependencies.productDataController else {
      dataNotice = .deletionFailed
      return
    }
    isPerformingDataAction = true
    defer { isPerformingDataAction = false }
    ticker?.cancel()
    preparationTask?.cancel()
    if let session = activeSession {
      dependencies.timerEndAlertController.cancel(sessionID: session.id)
    }
    dependencies.audioController.stop()
    discardPendingJournalRecording()
    do {
      let reminderIdentifiers = await dependencies.weeklyReminderNotificationController
        .pendingWeeklyReminderIdentifiers()
      dependencies.weeklyReminderNotificationController.removeWeeklyReminderIdentifiers(
        reminderIdentifiers
      )
      try await dependencies.weeklyReminderRepository.deleteAllWeeklyReminderSchedules()
      guard try await controller.deleteAllData() == .localDeletionComplete else {
        dataNotice = .deletionFailed
        return
      }
      try await dependencies.appSettingsRepository.deleteAll()
      clearLoadedPrivateData()
      appLanguage = .system
      productDataCounts = ProductDataCounts(
        profileGenerations: 0,
        practiceEvents: 0,
        journalEntries: 0,
        favoritePractices: 0,
        customizations: 0
      )
      dataNotice = .deletionComplete
      launchPhase = .firstUse
    } catch {
      dataNotice = .deletionFailed
    }
  }

  func dismissDataNotice() { dataNotice = nil }

  func confirmRecovery(useMaximumPlausibleTime: Bool) async {
    guard var session = activeSession, let recoveryAssessment else { return }
    let confirmed =
      useMaximumPlausibleTime
      ? recoveryAssessment.maximumPlausibleActiveMilliseconds
      : recoveryAssessment.lastConfirmedActiveMilliseconds
    do {
      try session.recoverAfterTermination(
        confirmedActiveMilliseconds: confirmed,
        at: recoveryAssessment.assessedAt
      )
      try await dependencies.sessionRepository.save(session)
      activeSession = session
      elapsedMilliseconds = confirmed
      updateIntervalBellOrdinal(for: confirmed, session: session)
      self.recoveryAssessment = nil
    } catch {
      launchPhase = .failed
    }
  }

  func discardRecoveredSession() async {
    guard var session = activeSession else { return }
    do {
      try session.abandon(at: Date())
      try await dependencies.sessionRepository.save(session)
      activeSession = nil
      elapsedMilliseconds = 0
      preparationRemainingMilliseconds = 0
      lastIntervalBellOrdinal = 0
      recoveryAssessment = nil
      dependencies.audioController.stop()
      dependencies.timerEndAlertController.cancel(sessionID: session.id)
    } catch {
      launchPhase = .failed
    }
  }

  func updateForForeground() async {
    await tick()
    do {
      try await refreshGarden()
    } catch {
      launchPhase = .failed
    }
    await reconcileWeeklyReminders()
    await refreshProductDataStatus()
  }

  func updateReduceMotion(_ reduceMotion: Bool) async {
    guard let profile else { return }
    do {
      try await refreshGarden(profile: profile, reduceMotion: reduceMotion)
    } catch {
      launchPhase = .failed
    }
  }

  func reportRendererFailure(_ message: String) {
    rendererIsReady = false
    rendererFailureMessage = message
  }

  func reportRendererReady() {
    rendererIsReady = true
    rendererFailureMessage = nil
  }

  func reportRendererObservation(_ observation: RendererObservation) {
    rendererDiagnosticsRecorder.record(observation)
    switch observation {
    case .diagnostic(.contextLost):
      rendererIsReady = false
    case .diagnostic(.contextRestored):
      rendererRecoveryCount += 1
      rendererIsReady = true
      rendererFailureMessage = nil
    case .selectedQuality(let quality):
      rendererSelectedQuality = quality
    default:
      break
    }
  }

  func prepareRendererDiagnosticsExport() {
    let snapshot = rendererDiagnosticsRecorder.snapshot(
      rendererReady: rendererIsReady,
      nativeFallbackActive: forceNativeGarden || rendererFailureMessage != nil,
      selectedQuality: rendererSelectedQuality,
      contextRecoveryCount: rendererRecoveryCount
    )
    let url = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-renderer-diagnostics.json")
    do {
      try RendererDiagnosticsExporter.export(snapshot, to: url)
      rendererDiagnosticsExportURL = url
    } catch {
      rendererDiagnosticsExportURL = nil
    }
  }

  func retryRenderer() {
    rendererIsReady = false
    rendererFailureMessage = nil
    forceNativeGarden = false
    rendererDiagnosticsExportURL = nil
    rendererGeneration += 1
  }

  func gardenDescription() -> String {
    guard let gardenState else { return "" }
    let language: GardenDescriptionLanguage =
      appLanguage.languageCode == "de"
      ? .german
      : .english
    return GardenDescription.text(for: gardenState, language: language)
  }

  private func createProfileIfNeeded() async throws -> LocalProfile {
    if let profile { return profile }
    let now = Date()
    let seed: UInt64
    #if DEBUG
      if let flagIndex = ProcessInfo.processInfo.arguments.firstIndex(of: "-ui-test-seed"),
        ProcessInfo.processInfo.arguments.indices.contains(flagIndex + 1),
        let supplied = UInt64(ProcessInfo.processInfo.arguments[flagIndex + 1]),
        supplied <= GardenSeedContract.maximumExactCrossRuntimeValue
      {
        seed = supplied
      } else {
        seed = UInt64.random(in: 0...GardenSeedContract.maximumExactCrossRuntimeValue)
      }
    #else
      seed = UInt64.random(in: 0...GardenSeedContract.maximumExactCrossRuntimeValue)
    #endif
    let created = try LocalProfile(
      profileGenerationID: UUID(),
      gardenID: UUID(),
      gardenSeed: seed,
      installationID: UUID(),
      createdAt: now,
      hasCompletedFirstUse: true
    )
    try await dependencies.profileRepository.save(created)
    profile = created
    #if DEBUG
      try await seedUITestJourneyIfRequested(profile: created)
    #endif
    try await refreshGarden(profile: created)
    try await refreshJournal(profile: created)
    await refreshProductDataStatus()
    return created
  }

  private func refreshProductDataStatus() async {
    guard let controller = dependencies.productDataController else { return }
    if let counts = try? await controller.counts() {
      productDataCounts = counts
    }
  }

  private func reconcileWeeklyReminders() async {
    let controller = dependencies.weeklyReminderNotificationController
    let authorization = await controller.authorizationState()
    reminderAuthorization = authorization
    let pending = await controller.pendingWeeklyReminderIdentifiers()
    let enabled = weeklyReminderSchedules.filter(\.isEnabled)
    let desiredIdentifiers: Set<String> =
      authorization == .authorized
      ? Set(enabled.map { WeeklyReminderNotificationIdentifier.value(for: $0.id) })
      : []
    controller.removeWeeklyReminderIdentifiers(pending.subtracting(desiredIdentifiers))

    switch authorization {
    case .notDetermined:
      reminderDeliveryStatus = enabled.isEmpty ? .inactive : .permissionNotDetermined
    case .denied:
      reminderDeliveryStatus = enabled.isEmpty ? .inactive : .permissionDenied
    case .authorized:
      do {
        for schedule in enabled { try await controller.upsert(schedule, locale: appLocale) }
        reminderDeliveryStatus = enabled.isEmpty ? .inactive : .scheduled(enabled.count)
        if reminderNotice == .couldNotSchedule { reminderNotice = nil }
      } catch {
        reminderDeliveryStatus = .needsAttention
        reminderNotice = .couldNotSchedule
      }
    }
  }

  private func clearLoadedPrivateData() {
    profile = nil
    gardenState = nil
    weeklyReminderSchedules = []
    reminderDeliveryStatus = .inactive
    journeyProjection = nil
    gardenCustomization = GardenCustomization()
    activeSession = nil
    elapsedMilliseconds = 0
    preparationRemainingMilliseconds = 0
    favoriteGuidedPracticeIDs = []
    journalEntries = []
    journalConflicts = []
    pendingReflectionEventID = nil
    completionPresentation = nil
    recoveryAssessment = nil
    completeDataExportURL = nil
  }

  #if DEBUG
    private func uiTestLanguageOverride() -> AppLanguage? {
      let arguments = ProcessInfo.processInfo.arguments
      guard let flag = arguments.firstIndex(of: "-ui-test-language"),
        arguments.indices.contains(flag + 1)
      else { return nil }
      switch arguments[flag + 1] {
      case "en": return .english
      case "de": return .german
      default: return nil
      }
    }

    private func seedUITestJourneyIfRequested(profile: LocalProfile) async throws {
      let arguments = ProcessInfo.processInfo.arguments
      if arguments.contains("-ui-test-journey-calendar-edges") {
        try await seedUITestCalendarEdgeJourney(profile: profile)
        return
      }
      guard let flag = arguments.firstIndex(of: "-ui-test-journey-day"),
        arguments.indices.contains(flag + 1),
        let requestedDay = Int(arguments[flag + 1]),
        (1...30).contains(requestedDay)
      else { return }

      let timeZone = TimeZone(secondsFromGMT: 0)!
      let origin = Date(timeIntervalSince1970: 1_783_036_800)
      for ordinal in 1...requestedDay {
        let startedAt = origin.addingTimeInterval(Double(ordinal - 1) * 86_400)
        let activeMilliseconds = Int64(180_000 + (ordinal % 5) * 60_000)
        let endedAt = startedAt.addingTimeInterval(Double(activeMilliseconds) / 1_000)
        let event = try PracticeEvent(
          id: uiTestUUID(prefix: "91", ordinal: ordinal),
          sessionID: uiTestUUID(prefix: "92", ordinal: ordinal),
          profileGenerationID: profile.profileGenerationID,
          mode: PracticeMode.allCases[(ordinal - 1) % PracticeMode.allCases.count],
          guidedContentID: (ordinal - 1) % PracticeMode.allCases.count == 0 ? "G01" : nil,
          guidedContentVersion: (ordinal - 1) % PracticeMode.allCases.count == 0 ? 1 : nil,
          startedAt: startedAt,
          endedAt: endedAt,
          activeMilliseconds: activeMilliseconds,
          practiceDay: try PracticeDayKey.containing(startedAt, timeZone: timeZone),
          sourceInstallationID: profile.installationID,
          createdAt: endedAt
        )
        _ = try await dependencies.eventRepository.insertIfAbsent(event)
      }
    }

    private func seedUITestReminderScheduleIfRequested() async throws {
      let arguments = ProcessInfo.processInfo.arguments
      guard arguments.contains("-ui-test-reminders-seeded") else { return }
      let timestamp = Date(timeIntervalSince1970: 1_786_320_000)
      weeklyReminderSchedules = [
        try WeeklyReminderSchedule(
          id: uiTestUUID(prefix: "97", ordinal: 1),
          weekday: .sunday,
          hour: 9,
          minute: 30,
          createdAt: timestamp,
          modifiedAt: timestamp
        ),
        try WeeklyReminderSchedule(
          id: uiTestUUID(prefix: "97", ordinal: 2),
          weekday: .wednesday,
          hour: 20,
          minute: 0,
          createdAt: timestamp,
          modifiedAt: timestamp
        ),
      ]
      try await dependencies.weeklyReminderRepository.saveWeeklyReminderSchedules(
        weeklyReminderSchedules
      )
    }

    private func seedUITestCalendarEdgeJourney(profile: LocalProfile) async throws {
      guard let losAngeles = TimeZone(identifier: "America/Los_Angeles"),
        let tokyo = TimeZone(identifier: "Asia/Tokyo")
      else { return }
      let definitions: [(TimeZone, DateComponents, Int64)] = [
        (
          losAngeles,
          DateComponents(year: 2026, month: 3, day: 7, hour: 23, minute: 58),
          180_000
        ),
        (
          losAngeles,
          DateComponents(year: 2026, month: 3, day: 8, hour: 0, minute: 2),
          240_000
        ),
        (
          tokyo,
          DateComponents(year: 2026, month: 3, day: 9, hour: 8, minute: 0),
          300_000
        ),
        (
          tokyo,
          DateComponents(year: 2026, month: 3, day: 10, hour: 8, minute: 0),
          120_000
        ),
      ]
      for (index, definition) in definitions.enumerated() {
        let ordinal = index + 1
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US_POSIX")
        calendar.timeZone = definition.0
        var components = definition.1
        components.calendar = calendar
        components.timeZone = definition.0
        guard let startedAt = calendar.date(from: components) else { continue }
        let activeMilliseconds = definition.2
        let endedAt = startedAt.addingTimeInterval(Double(activeMilliseconds) / 1_000)
        let mode = PracticeMode.allCases[index % PracticeMode.allCases.count]
        let event = try PracticeEvent(
          id: uiTestUUID(prefix: "93", ordinal: ordinal),
          sessionID: uiTestUUID(prefix: "94", ordinal: ordinal),
          profileGenerationID: profile.profileGenerationID,
          mode: mode,
          guidedContentID: mode == .guided ? "G01" : nil,
          guidedContentVersion: mode == .guided ? 1 : nil,
          startedAt: startedAt,
          endedAt: endedAt,
          activeMilliseconds: activeMilliseconds,
          practiceDay: try PracticeDayKey.containing(startedAt, timeZone: definition.0),
          sourceInstallationID: profile.installationID,
          createdAt: endedAt
        )
        _ = try await dependencies.eventRepository.insertIfAbsent(event)
      }
    }

    private func uiTestUUID(prefix: String, ordinal: Int) -> UUID {
      UUID(
        uuidString: "\(prefix)000000-0000-4000-8000-\(String(format: "%012x", ordinal))"
      )!
    }
  #endif

  private func restoreProductState(for profile: LocalProfile) async throws {
    try await refreshGarden(profile: profile)
    try await refreshJournal(profile: profile)
    guard
      let session = try await dependencies.sessionRepository.activeSession(
        profileGenerationID: profile.profileGenerationID
      )
    else {
      return
    }
    activeSession = session
    elapsedMilliseconds = session.activeMilliseconds
    updateIntervalBellOrdinal(for: session.activeMilliseconds, session: session)
    if session.phase == .prepared {
      preparationRemainingMilliseconds = session.configuration.preparation.milliseconds
      startPreparationCountdown(for: session)
    } else if let assessment = session.recoveryAssessment(
      at: dependencies.clock.now().wallClock
    ) {
      recoveryAssessment = assessment
      dependencies.timerEndAlertController.cancel(sessionID: session.id)
    } else if session.phase == .running {
      startTicker()
    }
  }

  private func refreshGarden() async throws {
    guard let profile else { return }
    try await refreshGarden(
      profile: profile,
      reduceMotion: gardenState?.reduceMotion ?? false
    )
  }

  private func refreshGarden(profile: LocalProfile, reduceMotion: Bool = false) async throws {
    let currentMoment = dependencies.clock.now().wallClock
    let events = try await dependencies.eventRepository.allEvents(
      profileGenerationID: profile.profileGenerationID
    )
    let customization = try await dependencies.gardenCustomizationRepository.load(
      profileGenerationID: profile.profileGenerationID
    )
    gardenCustomization = customization
    gardenState = ProgressionReducer.reduce(
      events: events,
      context: GardenProjectionContext(
        gardenID: profile.gardenID,
        gardenSeed: profile.gardenSeed,
        profileGenerationID: profile.profileGenerationID,
        customization: customization,
        reduceMotion: reduceMotion,
        qualityHint: .balanced,
        localDayPhase: GardenDayPhase.presentation(at: currentMoment, timeZone: .current)
      )
    )
    let currentDay = try? PracticeDayKey.containing(
      currentMoment,
      timeZone: .current
    )
    journeyProjection = JourneyReducer.reduce(
      events: events,
      profileGenerationID: profile.profileGenerationID,
      currentPracticeDay: currentDay
    )
  }

  private func refreshJournal(profile: LocalProfile) async throws {
    async let currentEntries = dependencies.journalRepository.entries(
      profileGenerationID: profile.profileGenerationID,
      includingDeleted: false
    )
    async let currentConflicts = dependencies.journalRepository.conflicts(
      profileGenerationID: profile.profileGenerationID
    )
    journalEntries = try await currentEntries
    journalConflicts = try await currentConflicts
    if !journalConflicts.isEmpty, journalNotice == nil { journalNotice = .editConflict }
    cleanupOrphanedJournalAudio()
  }

  private func cleanupOrphanedJournalAudio() {
    let conflictAttachments = journalConflicts.flatMap(\.variants)
      .compactMap(\.audioAttachment?.relativeFileName)
    let retained = Set(
      journalEntries.compactMap(\.audioAttachment?.relativeFileName) + conflictAttachments
    )
    let manager = FileManager.default
    guard manager.fileExists(atPath: dependencies.journalAudioDirectory.path) else { return }
    do {
      let files = try manager.contentsOfDirectory(
        at: dependencies.journalAudioDirectory,
        includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey],
        options: [.skipsHiddenFiles]
      )
      for file in files where file.pathExtension.lowercased() == "m4a" {
        let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else { continue }
        if !retained.contains(file.lastPathComponent) { try manager.removeItem(at: file) }
      }
    } catch {
      journalNotice = .audioDeletionPending
    }
  }

  private func startTicker() {
    ticker?.cancel()
    ticker = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(200))
        guard !Task.isCancelled, let self else { return }
        await self.tick()
      }
    }
  }

  private func startPreparationCountdown(for session: MeditationSession) {
    preparationTask?.cancel()
    let origin = dependencies.clock.now().monotonicMilliseconds
    let total = session.configuration.preparation.milliseconds
    preparationRemainingMilliseconds = total
    preparationTask = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(100))
        guard !Task.isCancelled, let self else { return }
        guard self.activeSession?.id == session.id else { return }
        let elapsed = max(0, self.dependencies.clock.now().monotonicMilliseconds - origin)
        self.preparationRemainingMilliseconds = max(0, total - elapsed)
        if elapsed >= total {
          await self.activatePreparedSession(id: session.id)
          return
        }
      }
    }
  }

  private func activatePreparedSession(id: UUID) async {
    guard var session = activeSession, session.id == id, session.phase == .prepared else { return }
    do {
      let moment = dependencies.clock.now()
      try session.start(at: moment)
      try await dependencies.sessionRepository.save(session)
      activeSession = session
      preparationRemainingMilliseconds = 0
      do {
        try dependencies.audioController.begin(session: session)
        audioNotice = nil
      } catch {
        if session.mode == .guided {
          try session.abandon(at: moment.wallClock)
          try await dependencies.sessionRepository.save(session)
          activeSession = nil
          audioNotice = .guidedNarrationPendingApproval
          return
        }
        audioNotice = .playbackUnavailable
      }
      if session.configuration.audio.hapticsEnabled {
        dependencies.hapticController.signalStart()
      }
      await scheduleTimerEndAlertIfNeeded(for: session)
      startTicker()
    } catch {
      launchPhase = .failed
    }
  }

  private func tick() async {
    guard let session = activeSession, session.phase == .running else { return }
    do {
      let moment = dependencies.clock.now()
      let elapsed = try session.elapsedMilliseconds(at: moment)
      elapsedMilliseconds = elapsed
      signalIntervalBellIfNeeded(elapsedMilliseconds: elapsed, session: session)
      if let target = session.targetDurationMilliseconds, elapsed >= target {
        let targetMoment = try session.completionMomentAtTarget(ifReachedAt: moment)
        await completeActiveSession(at: targetMoment)
      }
    } catch {
      launchPhase = .failed
    }
  }

  private func completeActiveSession(at suppliedMoment: SessionMoment? = nil) async {
    guard !isCompleting, let session = activeSession, let profile else { return }
    isCompleting = true
    ticker?.cancel()
    defer { isCompleting = false }

    do {
      let moment = suppliedMoment ?? dependencies.clock.now()
      let outcome = try await dependencies.completionCoordinator.complete(
        session: session,
        input: SessionCompletionInput(
          eventID: UUID(),
          sourceInstallationID: profile.installationID,
          practiceDay: try PracticeDayKey.containing(moment.wallClock, timeZone: .current),
          moment: moment
        )
      )
      try await dependencies.sessionRepository.save(outcome.session)
      activeSession = nil
      elapsedMilliseconds = outcome.event.activeMilliseconds
      lastIntervalBellOrdinal = 0
      dependencies.timerEndAlertController.cancel(sessionID: session.id)
      completionPresentation = CompletionPresentation(
        qualifiedForGrowth: outcome.event.qualifiesForGrowth,
        eventID: outcome.event.id
      )
      let targetReached =
        session.targetDurationMilliseconds.map {
          outcome.event.activeMilliseconds >= $0
        } ?? false
      dependencies.audioController.finish(
        playClosingBell: session.configuration.audio.closingBellEnabled,
        targetReached: targetReached
      )
      if session.configuration.audio.hapticsEnabled {
        dependencies.hapticController.signalEnd()
      }
      try await refreshGarden()
      await refreshProductDataStatus()
    } catch {
      activeSession = session
      launchPhase = .failed
    }
  }

  private func defaultConfiguration(
    for mode: PracticeMode
  ) throws -> MeditationSessionConfiguration {
    switch mode {
    case .guided:
      let language = appLanguage.languageCode
      return MeditationSessionConfiguration(
        audio: try MeditationAudioConfiguration(narrationLanguageCode: language)
      )
    case .timer:
      return MeditationSessionConfiguration(
        preparation: timerPreferences.preparation,
        audio: timerPreferences.audio
      )
    case .stopwatch:
      return .standard
    }
  }

  private func handleAudioSystemEvent(_ event: MeditationAudioSystemEvent) {
    let actions = AudioLifecyclePolicy.actions(for: activeSession?.phase, event: event)
    if actions.contains(.stopPlayback) { dependencies.audioController.pause() }
    if actions.contains(.rebuildPlayback) { dependencies.audioController.rebuild() }
    if actions.contains(.pauseSession) {
      Task { [weak self] in await self?.pausePractice() }
    }
    if actions.contains(.waitForUserResume) {
      audioNotice =
        switch event {
        case .interruptionBegan, .interruptionEnded: .interrupted
        case .outputRouteLost, .outputRouteAvailable: .outputRouteLost
        case .engineConfigurationChanged, .mediaServicesReset: .audioSystemReset
        }
    }
  }

  private func signalIntervalBellIfNeeded(
    elapsedMilliseconds: Int64,
    session: MeditationSession
  ) {
    guard let intervalMinutes = session.configuration.audio.intervalBellMinutes else { return }
    let intervalMilliseconds = Int64(intervalMinutes) * 60_000
    let ordinal = elapsedMilliseconds / intervalMilliseconds
    guard ordinal > lastIntervalBellOrdinal else { return }
    if let target = session.targetDurationMilliseconds, elapsedMilliseconds >= target {
      return
    }
    lastIntervalBellOrdinal = ordinal
    dependencies.audioController.playIntervalBell()
  }

  private func updateIntervalBellOrdinal(
    for elapsedMilliseconds: Int64,
    session: MeditationSession
  ) {
    guard let intervalMinutes = session.configuration.audio.intervalBellMinutes else {
      lastIntervalBellOrdinal = 0
      return
    }
    lastIntervalBellOrdinal = elapsedMilliseconds / (Int64(intervalMinutes) * 60_000)
  }

  private func scheduleTimerEndAlertIfNeeded(for session: MeditationSession) async {
    let audio = session.configuration.audio
    guard session.mode == .timer,
      audio.backgroundEndAlertEnabled,
      audio.ambienceID == nil,
      let target = session.targetDurationMilliseconds
    else {
      dependencies.timerEndAlertController.cancel(sessionID: session.id)
      return
    }
    let authorization = await dependencies.timerEndAlertController.authorizationState()
    timerEndAlertAuthorization = authorization
    guard authorization == .authorized else {
      audioNotice = .backgroundEndAlertDenied
      return
    }
    let remaining = target - session.activeMilliseconds
    guard remaining > 0 else { return }
    do {
      try await dependencies.timerEndAlertController.schedule(
        sessionID: session.id,
        after: Double(remaining) / 1_000,
        locale: appLocale
      )
    } catch {
      audioNotice = .backgroundEndAlertDenied
    }
  }

  private func startJournalRecordingTicker() {
    journalRecordingTicker?.cancel()
    journalRecordingTicker = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(200))
        guard !Task.isCancelled, let self else { return }
        guard self.dependencies.journalAudioRecorder.isRecording else { return }
        self.journalRecordingPhase = .recording(
          elapsedMilliseconds: self.dependencies.journalAudioRecorder.elapsedMilliseconds
        )
      }
    }
  }

  private func handleJournalRecordingEvent(_ event: JournalAudioRecordingEvent) {
    journalRecordingTicker?.cancel()
    switch event {
    case .reachedMaximum(let attachment):
      journalRecordingPhase = .ready(attachment)
    case .interrupted(let attachment):
      journalRecordingPhase = .interrupted(attachment)
      journalNotice = .recordingInterrupted
    case .failed:
      journalRecordingPhase = .failed
      journalNotice = .recordingFailed
    }
  }
}
