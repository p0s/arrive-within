import ArriveWithinContent
import ArriveWithinDomain
import ArriveWithinMeditation
import ArriveWithinPersistence
import Foundation
#if canImport(Darwin)
  import Darwin
#endif

enum AppDataDirectoryPreparer {
  static func prepare(_ directory: URL, fileManager: FileManager = .default) throws {
    try fileManager.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: [
        .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication
      ]
    )
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
  let weeklyReminderNotificationController: any WeeklyReminderNotificationControlling
  let hapticController: any MeditationHapticControlling
  let journalAudioRecorder: any JournalAudioRecordingControlling
  let journalTranscriber: any JournalTranscribing

  init(
    profileRepository: any LocalProfileRepository,
    eventRepository: any PracticeEventRepository,
    sessionRepository: any MeditationSessionRepository,
    preferencesRepository: any MeditationPreferencesRepository,
    appSettingsRepository: any AppSettingsRepository = EphemeralAppSettingsRepository(),
    premiumGardenPurchaseClient: any PremiumGardenPurchaseClient = FixedPremiumGardenPurchaseClient(),
    guidedFavoritesRepository: any GuidedFavoritesRepository = EphemeralGuidedFavoritesRepository(),
    gardenCustomizationRepository: any GardenCustomizationRepository = EphemeralGardenCustomizationRepository(),
    journalRepository: any JournalEntryRepository = EphemeralJournalEntryRepository(),
    weeklyReminderRepository: any WeeklyReminderScheduleRepository = EphemeralWeeklyReminderScheduleRepository(),
    productStore: CoreDataProductStore? = nil,
    productDataController: ProductDataController? = nil,
    guidedCatalog: GuidedCatalogDocument? = nil,
    completionCoordinator: SessionCompletionCoordinator,
    clock: any SessionClock,
    dataDirectory: URL,
    audioController: any MeditationAudioControlling,
    timerEndAlertController: any TimerEndAlertControlling,
    weeklyReminderNotificationController: any WeeklyReminderNotificationControlling = NoOpWeeklyReminderNotificationController(),
    hapticController: any MeditationHapticControlling,
    journalAudioRecorder: any JournalAudioRecordingControlling = UnavailableJournalAudioRecorder(),
    journalTranscriber: any JournalTranscribing = UnavailableJournalTranscriber()
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
    self.weeklyReminderRepository = weeklyReminderRepository
    self.productStore = productStore
    self.productDataController = productDataController
    self.guidedCatalog = guidedCatalog
    self.completionCoordinator = completionCoordinator
    self.clock = clock
    self.dataDirectory = dataDirectory
    self.journalAudioDirectory = dataDirectory.appending(path: "journal-audio", directoryHint: .isDirectory)
    do {
      self.exportStagingManager = try ExportStagingManager(
        root: dataDirectory.appending(path: "exports", directoryHint: .isDirectory)
      )
    } catch {
      preconditionFailure("The validated export staging boundary could not be created.")
    }
    self.audioController = audioController
    self.timerEndAlertController = timerEndAlertController
    self.weeklyReminderNotificationController = weeklyReminderNotificationController
    self.hapticController = hapticController
    self.journalAudioRecorder = journalAudioRecorder
    self.journalTranscriber = journalTranscriber
  }

  static func live(arguments: [String] = ProcessInfo.processInfo.arguments) -> Self {
    let root = FileManager.default.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    )[0].appending(path: "ArriveWithin", directoryHint: .isDirectory)
    #if DEBUG
      if arguments.contains("-ui-test-reset") {
        try? FileManager.default.removeItem(at: root)
      }
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
    let audioController: any MeditationAudioControlling =
      (try? NativeMeditationAudioController()) ?? UnavailableMeditationAudioController()

    #if DEBUG
      let clock: any SessionClock = testClock(arguments: arguments) ?? SystemSessionClock()
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
      timerEndAlertController: NativeTimerEndAlertController(),
      weeklyReminderNotificationController: weeklyReminderController(arguments: arguments),
      hapticController: NativeMeditationHapticController(),
      journalAudioRecorder: journalAudioRecorder,
      journalTranscriber: NativeOnDeviceJournalTranscriber()
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
            displayPrice: PremiumGardenProduct.proposedUSDPrice
          )
        )
      }
      if arguments.contains("-ui-test-premium-available") {
        return FixedPremiumGardenPurchaseClient(
          snapshot: PremiumGardenAccessSnapshot(
            isOwned: false,
            productIsAvailable: true,
            displayPrice: PremiumGardenProduct.proposedUSDPrice
          ),
          purchaseSucceeds: arguments.contains("-ui-test-premium-purchase-succeeds")
        )
      }
    #endif
    return StoreKitPremiumGardenPurchaseClient()
  }

  #if DEBUG
    private static func testClock(arguments: [String]) -> (any SessionClock)? {
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
