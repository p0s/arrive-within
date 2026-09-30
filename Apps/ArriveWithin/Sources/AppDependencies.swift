import ArriveWithinContent
import ArriveWithinDomain
import ArriveWithinMeditation
import ArriveWithinPersistence
import Foundation

#if canImport(Darwin)
  import Darwin
#endif

enum AppDataDirectoryPreparationError: Error, Equatable, Sendable {
  case unsafeDirectory
  case backupExclusionFailed
  #if DEBUG
    case invalidVerificationNamespace
  #endif
}

enum AppDataDirectoryPreparer {
  #if DEBUG
    static func verificationDirectory(in support: URL, arguments: [String]) throws -> URL? {
      let indices = arguments.indices.filter { arguments[$0] == "-ui-test-namespace" }
      guard !indices.isEmpty else { return nil }
      guard indices.count == 1, let index = indices.first,
        arguments.indices.contains(index + 1),
        let identifier = UUID(uuidString: arguments[index + 1])
      else {
        throw AppDataDirectoryPreparationError.invalidVerificationNamespace
      }
      return support.appending(path: "ArriveWithinVerification", directoryHint: .isDirectory)
        .appending(path: identifier.uuidString, directoryHint: .isDirectory)
        .appending(path: "ArriveWithin", directoryHint: .isDirectory)
    }
  #endif

  static func prepare(_ directory: URL, fileManager: FileManager = .default) throws {
    let normalized = directory.standardizedFileURL
    guard normalized.isFileURL, normalized.path != "/" else {
      throw AppDataDirectoryPreparationError.unsafeDirectory
    }
    var existingIsDirectory: ObjCBool = false
    if fileManager.fileExists(atPath: normalized.path, isDirectory: &existingIsDirectory) {
      let existingValues = try normalized.resourceValues(
        forKeys: [.isDirectoryKey, .isSymbolicLinkKey]
      )
      guard existingIsDirectory.boolValue,
        existingValues.isDirectory == true,
        existingValues.isSymbolicLink != true
      else {
        throw AppDataDirectoryPreparationError.unsafeDirectory
      }
    } else {
      try fileManager.createDirectory(
        at: normalized,
        withIntermediateDirectories: true,
        attributes: [
          .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication
        ]
      )
    }
    let values = try normalized.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
    guard values.isDirectory == true, values.isSymbolicLink != true else {
      throw AppDataDirectoryPreparationError.unsafeDirectory
    }
    #if os(iOS)
      try fileManager.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: normalized.path
      )
    #endif
    var backupValues = URLResourceValues()
    backupValues.isExcludedFromBackup = true
    var mutableDirectory = normalized
    try mutableDirectory.setResourceValues(backupValues)
    mutableDirectory.removeAllCachedResourceValues()
    guard
      try mutableDirectory.resourceValues(
        forKeys: [.isExcludedFromBackupKey]
      ).isExcludedFromBackup == true
    else {
      throw AppDataDirectoryPreparationError.backupExclusionFailed
    }
  }
}

@MainActor
struct AppDependencies {
  let profileRepository: any LocalProfileRepository
  let eventRepository: any PracticeEventRepository
  let sessionRepository: any MeditationSessionRepository
  let preferencesRepository: any MeditationPreferencesRepository
  let appSettingsRepository: any AppSettingsRepository
  let premiumGardenPurchaseClient: any PremiumGardenPurchaseClient
  let guidedFavoritesRepository: any GuidedFavoritesRepository
  let gardenCustomizationRepository: any GardenCustomizationRepository
  let journalRepository: any JournalEntryRepository
  let journalTextDraftRepository: any JournalTextDraftRepository
  let weeklyReminderRepository: any WeeklyReminderScheduleRepository
  let productStore: CoreDataProductStore?
  let productDataController: ProductDataController?
  let guidedCatalog: GuidedCatalogDocument?
  let completionCoordinator: SessionCompletionCoordinator
  let clock: any SessionClock
  let dataDirectory: URL
  let journalAudioDirectory: URL
  let exportStagingManager: ExportStagingManager
  let audioController: any MeditationAudioControlling
  let timerEndAlertController: any TimerEndAlertControlling
  let liveActivityController: any MeditationLiveActivityControlling
  let weeklyReminderNotificationController: any WeeklyReminderNotificationControlling
  let hapticController: any MeditationHapticControlling
  let journalAudioRecorder: any JournalAudioRecordingControlling
  let journalTranscriber: any JournalTranscribing
  let marketingCaptureFixture: UITestMarketingCaptureFixture?
  let marketingCaptureReportURL: URL?

  init(
    profileRepository: any LocalProfileRepository,
    eventRepository: any PracticeEventRepository,
    sessionRepository: any MeditationSessionRepository,
    preferencesRepository: any MeditationPreferencesRepository,
    appSettingsRepository: any AppSettingsRepository = EphemeralAppSettingsRepository(),
    premiumGardenPurchaseClient: any PremiumGardenPurchaseClient =
      FixedPremiumGardenPurchaseClient(),
    guidedFavoritesRepository: any GuidedFavoritesRepository = EphemeralGuidedFavoritesRepository(),
    gardenCustomizationRepository: any GardenCustomizationRepository =
      EphemeralGardenCustomizationRepository(),
    journalRepository: any JournalEntryRepository = EphemeralJournalEntryRepository(),
    journalTextDraftRepository: (any JournalTextDraftRepository)? = nil,
    weeklyReminderRepository: any WeeklyReminderScheduleRepository =
      EphemeralWeeklyReminderScheduleRepository(),
    productStore: CoreDataProductStore? = nil,
    productDataController: ProductDataController? = nil,
    guidedCatalog: GuidedCatalogDocument? = nil,
    completionCoordinator: SessionCompletionCoordinator,
    clock: any SessionClock,
    dataDirectory: URL,
    audioController: any MeditationAudioControlling,
    timerEndAlertController: any TimerEndAlertControlling,
    liveActivityController: any MeditationLiveActivityControlling =
      NoOpMeditationLiveActivityController(),
    weeklyReminderNotificationController: any WeeklyReminderNotificationControlling =
      NoOpWeeklyReminderNotificationController(),
    hapticController: any MeditationHapticControlling,
    journalAudioRecorder: any JournalAudioRecordingControlling = UnavailableJournalAudioRecorder(),
    journalTranscriber: any JournalTranscribing = UnavailableJournalTranscriber(),
    marketingCaptureFixture: UITestMarketingCaptureFixture? = nil,
    marketingCaptureReportURL: URL? = nil
  ) {
    self.profileRepository = profileRepository
    self.eventRepository = eventRepository
    self.sessionRepository = sessionRepository
    self.preferencesRepository = preferencesRepository
    self.appSettingsRepository = appSettingsRepository
    self.premiumGardenPurchaseClient = premiumGardenPurchaseClient
    self.guidedFavoritesRepository = guidedFavoritesRepository
    self.gardenCustomizationRepository = gardenCustomizationRepository
    self.journalRepository = journalRepository
    self.journalTextDraftRepository = journalTextDraftRepository
      ?? FileJournalTextDraftRepository(
        fileURL: dataDirectory.appending(path: "journal-drafts-v1.json")
      )
    self.weeklyReminderRepository = weeklyReminderRepository
    self.productStore = productStore
    self.productDataController = productDataController
    self.guidedCatalog = guidedCatalog
    self.completionCoordinator = completionCoordinator
    self.clock = clock
    self.dataDirectory = dataDirectory
    self.journalAudioDirectory = dataDirectory.appending(
      path: "journal-audio", directoryHint: .isDirectory)
    do {
      self.exportStagingManager = try ExportStagingManager(
        root: dataDirectory.appending(path: "exports", directoryHint: .isDirectory)
      )
    } catch {
      preconditionFailure("The validated export staging boundary could not be created.")
    }
    self.audioController = audioController
    self.timerEndAlertController = timerEndAlertController
    self.liveActivityController = liveActivityController
    self.weeklyReminderNotificationController = weeklyReminderNotificationController
    self.hapticController = hapticController
    self.journalAudioRecorder = journalAudioRecorder
    self.journalTranscriber = journalTranscriber
    self.marketingCaptureFixture = marketingCaptureFixture
    self.marketingCaptureReportURL = marketingCaptureReportURL
  }

  static func live(arguments: [String] = ProcessInfo.processInfo.arguments) -> Self {
    let support = FileManager.default.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    )[0]
    let marketingCaptureFixture: UITestMarketingCaptureFixture?
    let marketingCaptureReportURL: URL?
    #if DEBUG
      do {
        marketingCaptureFixture = try UITestMarketingCaptureFixture.parse(arguments: arguments)
      } catch {
        preconditionFailure("Invalid physical marketing capture fixture.")
      }
      let verificationRoot: URL?
      do {
        verificationRoot = try AppDataDirectoryPreparer.verificationDirectory(
          in: support, arguments: arguments
        )
      } catch {
        preconditionFailure("Invalid isolated verification namespace.")
      }
      let root =
        verificationRoot ?? support.appending(path: "ArriveWithin", directoryHint: .isDirectory)
      if arguments.contains("-ui-test-reset") {
        let resetRoot = verificationRoot ?? root
        if FileManager.default.fileExists(atPath: resetRoot.path) {
          do {
            let values = try resetRoot.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true else {
              preconditionFailure("The isolated UI-test reset root is unsafe.")
            }
            try FileManager.default.removeItem(at: resetRoot)
          } catch {
            preconditionFailure("The isolated UI-test namespace could not be reset.")
          }
        }
      }
      if marketingCaptureFixture != nil {
        let reportDirectory = support.appending(
          path: "ArriveWithinMarketingCaptureReports", directoryHint: .isDirectory
        )
        do {
          try AppDataDirectoryPreparer.prepare(reportDirectory)
          let reportURL = reportDirectory.appending(path: "marketing-capture.json")
          if FileManager.default.fileExists(atPath: reportURL.path) {
            let values = try reportURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true else {
              preconditionFailure("The existing marketing capture report is unsafe.")
            }
            try FileManager.default.removeItem(at: reportURL)
          }
          marketingCaptureReportURL = reportURL
        } catch {
          preconditionFailure("Physical marketing capture report directory is unsafe.")
        }
      } else {
        marketingCaptureReportURL = nil
      }
    #else
      marketingCaptureFixture = nil
      marketingCaptureReportURL = nil
      let root = support.appending(path: "ArriveWithin", directoryHint: .isDirectory)
    #endif
    do {
      try AppDataDirectoryPreparer.prepare(root)
    } catch {
      preconditionFailure("The protected application data directory could not be created.")
    }
    let productStore: CoreDataProductStore
    do {
      productStore = try CoreDataProductStore(
        configuration: ProductStoreConfiguration(
          storeURL: root.appending(path: "product-v1.sqlite"),
          mode: productStoreMode(arguments: arguments)
        )
      )
    } catch {
      preconditionFailure("The validated product store configuration could not be created.")
    }
    #if DEBUG
      if arguments.contains("-initialize-cloudkit-development-schema") {
        Task {
          do {
            try await productStore.initializeCloudKitDevelopmentSchema()
            print("ARRIVE_WITHIN_CLOUDKIT_SCHEMA_INITIALIZED")
            Darwin.exit(EXIT_SUCCESS)
          } catch {
            print("ARRIVE_WITHIN_CLOUDKIT_SCHEMA_INITIALIZATION_FAILED")
            Darwin.exit(70)
          }
        }
      }
    #endif
    let eventRepository = CoreDataPracticeEventRepository(store: productStore)
    let productDataController: ProductDataController
    do {
      productDataController = try ProductDataController(
        store: productStore,
        dataDirectory: root
      )
    } catch {
      preconditionFailure("The validated local data-control boundary could not be created.")
    }
    let sessionRepository = FileMeditationSessionRepository(
      fileURL: root.appending(path: "session-state-v1.json")
    )
    let localJournalTextDraftRepository = FileJournalTextDraftRepository(
      fileURL: root.appending(path: "journal-drafts-v1.json")
    )
    let journalTextDraftRepository: any JournalTextDraftRepository
    #if DEBUG
      let failFirstDraftDeletion = arguments.contains("-ui-test-journal-draft-delete-fails-once")
      let failFirstDraftSave = arguments.contains("-ui-test-journal-draft-save-fails-once")
      if failFirstDraftDeletion || failFirstDraftSave {
        journalTextDraftRepository = UITestFailingJournalTextDraftRepository(
          base: localJournalTextDraftRepository,
          failFirstDeletion: failFirstDraftDeletion,
          failFirstSave: failFirstDraftSave
        )
      } else {
        journalTextDraftRepository = localJournalTextDraftRepository
      }
    #else
      journalTextDraftRepository = localJournalTextDraftRepository
    #endif
    let audioController: any MeditationAudioControlling =
      (try? NativeMeditationAudioController()) ?? UnavailableMeditationAudioController()

    #if DEBUG
      let clock: any SessionClock = testClock(arguments: arguments) ?? SystemSessionClock()
      let timerEndAlertController: any TimerEndAlertControlling =
        verificationRoot == nil ? NativeTimerEndAlertController() : NoOpTimerEndAlertController()
      let liveActivityController: any MeditationLiveActivityControlling =
        verificationRoot == nil
        ? SystemMeditationLiveActivityController() : NoOpMeditationLiveActivityController()
      let journalAudioRecorder: any JournalAudioRecordingControlling =
        if arguments.contains("-ui-test-journal-recorder-unavailable") {
          UnavailableJournalAudioRecorder()
        } else if arguments.contains("-ui-test-journal-recorder-synthetic") {
          UITestJournalAudioRecorder()
        } else {
          NativeJournalAudioRecorder()
        }
    #else
      let clock: any SessionClock = SystemSessionClock()
      let timerEndAlertController: any TimerEndAlertControlling = NativeTimerEndAlertController()
      let liveActivityController: any MeditationLiveActivityControlling =
        SystemMeditationLiveActivityController()
      let journalAudioRecorder: any JournalAudioRecordingControlling =
        NativeJournalAudioRecorder()
    #endif

    return AppDependencies(
      profileRepository: CoreDataLocalProfileRepository(store: productStore),
      eventRepository: eventRepository,
      sessionRepository: sessionRepository,
      preferencesRepository: FileMeditationPreferencesRepository(
        fileURL: root.appending(path: "meditation-preferences-v1.json")
      ),
      appSettingsRepository: FileAppSettingsRepository(
        fileURL: root.appending(path: "app-settings-v1.json")
      ),
      premiumGardenPurchaseClient: premiumGardenPurchaseClient(arguments: arguments),
      guidedFavoritesRepository: CoreDataGuidedFavoritesRepository(store: productStore),
      gardenCustomizationRepository: CoreDataGardenCustomizationRepository(store: productStore),
      journalRepository: CoreDataJournalEntryRepository(
        store: productStore,
        audioDirectory: root.appending(path: "journal-audio", directoryHint: .isDirectory)
      ),
      journalTextDraftRepository: journalTextDraftRepository,
      weeklyReminderRepository: FileWeeklyReminderScheduleRepository(
        fileURL: root.appending(path: "weekly-reminders-v1.json")
      ),
      productStore: productStore,
      productDataController: productDataController,
      guidedCatalog: loadGuidedCatalog(),
      completionCoordinator: SessionCompletionCoordinator(repository: eventRepository),
      clock: clock,
      dataDirectory: root,
      audioController: audioController,
      timerEndAlertController: timerEndAlertController,
      liveActivityController: liveActivityController,
      weeklyReminderNotificationController: weeklyReminderController(arguments: arguments),
      hapticController: NativeMeditationHapticController(),
      journalAudioRecorder: journalAudioRecorder,
      journalTranscriber: NativeOnDeviceJournalTranscriber(),
      marketingCaptureFixture: marketingCaptureFixture,
      marketingCaptureReportURL: marketingCaptureReportURL
    )
  }

  private static func loadGuidedCatalog(bundle: Bundle = .main) -> GuidedCatalogDocument? {
    guard
      let url = bundle.url(
        forResource: "catalog",
        withExtension: "json",
        subdirectory: "guided"
      ),
      let data = try? Data(contentsOf: url)
    else {
      return nil
    }
    return try? GuidedCatalogLoader.decode(data)
  }

  private static func productStoreMode(
    arguments: [String] = ProcessInfo.processInfo.arguments
  ) -> ProductStoreMode {
    #if DEBUG
      // UI automation must never inherit a maintainer's ignored CloudKit
      // override. Sync presentation states are injected separately and stay
      // backed by the deterministic local store.
      if arguments.contains(where: { $0.hasPrefix("-ui-test-") }) {
        return .localOnly
      }
    #endif
    // V1.0 is deliberately local-only. Do not reactivate private CloudKit from
    // a build setting until deletion completion and stale-replica convergence
    // have operation-specific two-device proof.
    return .localOnly
  }

  private static func weeklyReminderController(
    arguments: [String]
  ) -> any WeeklyReminderNotificationControlling {
    #if DEBUG
      if arguments.contains("-ui-test-reminders-authorized") {
        return NoOpWeeklyReminderNotificationController(authorization: .authorized)
      }
      if arguments.contains("-ui-test-reminders-denied") {
        return NoOpWeeklyReminderNotificationController(authorization: .denied)
      }
      if arguments.contains("-ui-test-namespace") {
        return NoOpWeeklyReminderNotificationController(authorization: .notDetermined)
      }
    #endif
    return NativeWeeklyReminderNotificationController()
  }

  private static func premiumGardenPurchaseClient(
    arguments: [String]
  ) -> any PremiumGardenPurchaseClient {
    #if DEBUG
      if arguments.contains("-ui-test-premium-owned") {
        return FixedPremiumGardenPurchaseClient(
          snapshot: PremiumGardenAccessSnapshot(
            isOwned: true,
            productIsAvailable: true,
            displayPrice: PremiumGardenProduct.testDisplayPrice
          )
        )
      }
      if arguments.contains("-ui-test-premium-available") {
        return FixedPremiumGardenPurchaseClient(
          snapshot: PremiumGardenAccessSnapshot(
            isOwned: false,
            productIsAvailable: true,
            displayPrice: PremiumGardenProduct.testDisplayPrice
          ),
          purchaseSucceeds: arguments.contains("-ui-test-premium-purchase-succeeds")
        )
      }
    #endif
    return StoreKitPremiumGardenPurchaseClient()
  }

  #if DEBUG
    private static func testClock(arguments: [String]) -> (any SessionClock)? {
      do {
        if let fixture = try MarketingCaptureClockFixture.parse(arguments: arguments) {
          return FixedSessionClock(wallClock: fixture.date)
        }
      } catch {
        preconditionFailure("Invalid simulator marketing clock fixture.")
      }
      if let flagIndex = arguments.firstIndex(of: "-ui-test-wall-clock-epoch"),
        arguments.indices.contains(flagIndex + 1),
        let epoch = TimeInterval(arguments[flagIndex + 1])
      {
        return FixedSessionClock(wallClock: Date(timeIntervalSince1970: epoch))
      }
      guard let flagIndex = arguments.firstIndex(of: "-ui-test-time-scale"),
        arguments.indices.contains(flagIndex + 1),
        let scale = Double(arguments[flagIndex + 1]),
        scale > 0
      else {
        return nil
      }
      return ScaledSessionClock(scale: scale)
    }
  #endif
}

#if DEBUG
private actor UITestFailingJournalTextDraftRepository: JournalTextDraftRepository {
  private let base: any JournalTextDraftRepository
  private let failFirstDeletion: Bool
  private let failFirstSave: Bool
  private var hasFailedFirstDeletion = false
  private var hasFailedFirstSave = false

  init(
    base: any JournalTextDraftRepository,
    failFirstDeletion: Bool,
    failFirstSave: Bool
  ) {
    self.base = base
    self.failFirstDeletion = failFirstDeletion
    self.failFirstSave = failFirstSave
  }

  func load(editorKey: String, profileGenerationID: UUID) async throws -> JournalTextDraft? {
    try await base.load(editorKey: editorKey, profileGenerationID: profileGenerationID)
  }

  func save(_ draft: JournalTextDraft) async throws {
    if failFirstSave, !hasFailedFirstSave {
      hasFailedFirstSave = true
      throw JournalTextDraftError.couldNotPersist
    }
    try await base.save(draft)
  }

  func delete(editorKey: String, profileGenerationID: UUID) async throws {
    if failFirstDeletion, !hasFailedFirstDeletion {
      hasFailedFirstDeletion = true
      throw JournalTextDraftError.couldNotPersist
    }
    try await base.delete(editorKey: editorKey, profileGenerationID: profileGenerationID)
  }

  func deleteEntryDrafts(entryIDs: Set<UUID>, profileGenerationID: UUID) async throws {
    if failFirstDeletion, !hasFailedFirstDeletion {
      hasFailedFirstDeletion = true
      throw JournalTextDraftError.couldNotPersist
    }
    try await base.deleteEntryDrafts(entryIDs: entryIDs, profileGenerationID: profileGenerationID)
  }

  func deleteAll() async throws {
    try await base.deleteAll()
  }
}
#endif

#if DEBUG
  private struct FixedSessionClock: SessionClock, Sendable {
    let wallClock: Date

    func now() -> SessionMoment {
      SessionMoment(monotonicMilliseconds: 0, wallClock: wallClock)
    }
  }

  private final class ScaledSessionClock: SessionClock, @unchecked Sendable {
    private let lock = NSLock()
    private let scale: Double
    private let realOrigin: SessionMoment

    init(scale: Double) {
      self.scale = scale
      self.realOrigin = SystemSessionClock().now()
    }

    func now() -> SessionMoment {
      lock.withLock {
        let real = SystemSessionClock().now()
        let realDelta = real.monotonicMilliseconds - realOrigin.monotonicMilliseconds
        let scaledDelta = Int64((Double(realDelta) * scale).rounded(.down))
        return SessionMoment(
          monotonicMilliseconds: realOrigin.monotonicMilliseconds + scaledDelta,
          wallClock: realOrigin.wallClock.addingTimeInterval(Double(scaledDelta) / 1_000)
        )
      }
    }
  }
#endif
