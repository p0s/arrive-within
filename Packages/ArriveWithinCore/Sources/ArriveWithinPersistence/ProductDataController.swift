import ArriveWithinDomain
import Foundation

public struct ProductResetOutcome: Equatable, Sendable {
  public let profile: LocalProfile
  public let cleanupPending: Bool

  public init(profile: LocalProfile, cleanupPending: Bool) {
    self.profile = profile
    self.cleanupPending = cleanupPending
  }
}

public enum ProductDeletionOutcome: String, Codable, Equatable, Sendable {
  case localDeletionComplete
  case pendingPrivateCloudConfirmation
}

public enum ProductDataControlError: Error, Equatable, Sendable {
  case unsafeDataDirectory
  case unsafeDeletionTarget
  case couldNotDeleteLocalData
}

/// Coordinates whole-product export/reset/delete while keeping CloudKit truth
/// explicit. A local delete is immediate; a configured mirrored store remains
/// pending until a real CloudKit event can confirm its remote deletions.
public actor ProductDataController {
  /// Every standalone product-data artifact outside the Core Data store. New
  /// persistent files must be classified here so full deletion cannot silently
  /// omit them.
  private static let standaloneProductArtifactNames = [
    "app-settings-v1.json",
    "garden-customization-v1.json",
    "guided-favorites-v1.json",
    "journal-v1.json",
    "meditation-preferences-v1.json",
    "practice-ledger-v1.json",
    "profile-v1.json",
    "session-state-v1.json",
    "weekly-reminders-v1.json",
  ]
  private let store: CoreDataProductStore
  private let dataDirectory: URL
  private let journalAudioDirectory: URL
  private let exportDirectory: URL
  private let exportStaging: ExportStagingManager
  private let deletionStateURL: URL
  private let fileManager: FileManager

  private struct DeletionState: Codable {
    let schemaVersion: Int
    let state: ProductDeletionOutcome
    let requestedAt: Date
  }

  public init(
    store: CoreDataProductStore,
    dataDirectory: URL,
    fileManager: FileManager = .default
  ) throws {
    let root = dataDirectory.standardizedFileURL
    guard root.isFileURL, root.path != "/", root.lastPathComponent == "ArriveWithin" else {
      throw ProductDataControlError.unsafeDataDirectory
    }
    self.store = store
    self.dataDirectory = root
    self.journalAudioDirectory = root.appending(
      path: "journal-audio",
      directoryHint: .isDirectory
    )
    self.exportDirectory = root.appending(path: "exports", directoryHint: .isDirectory)
    self.exportStaging = try ExportStagingManager(
      root: root.appending(path: "exports", directoryHint: .isDirectory),
      fileManager: fileManager
    )
    self.deletionStateURL = root.appending(path: "deletion-state-v1.json")
    self.fileManager = fileManager
  }

  public func syncStatus() async -> ProductSyncStatus { await store.syncStatus() }

  public func counts() async throws -> ProductDataCounts { try await store.counts() }

  public func hasPendingPrivateCloudDeletion() -> Bool {
    guard fileManager.fileExists(atPath: deletionStateURL.path) else { return false }
    guard
      let data = try? Data(contentsOf: deletionStateURL),
      let state = try? JSONDecoder().decode(DeletionState.self, from: data)
    else {
      return true
    }
    return state.schemaVersion == 1 && state.state == .pendingPrivateCloudConfirmation
  }

  /// A marker written by an older cloud-enabled build must not strand a user
  /// after upgrading to the deliberately local-only V1 composition. Local
  /// records were already deleted before this exact marker was persisted.
  public func discardObsoleteCloudDeletionMarkerForLocalStore() async {
    guard await store.syncStatus() == .localOnly else { return }
    _ = deleteExactLocalItem(named: deletionStateURL.lastPathComponent, directory: dataDirectory)
  }

  public func exportAll(profile: LocalProfile, at exportedAt: Date) async throws -> URL {
    let journalRepository = CoreDataJournalEntryRepository(
      store: store,
      audioDirectory: journalAudioDirectory
    )
    async let events = store.allEvents(profileGenerationID: profile.profileGenerationID)
    async let customization = store.loadCustomization(
      profileGenerationID: profile.profileGenerationID
    )
    async let journal = journalRepository.entries(
      profileGenerationID: profile.profileGenerationID,
      includingDeleted: false
    )
    async let favorites = store.loadFavoritePracticeIDs()
    async let status = store.syncStatus()
    let resolvedEvents = try await events
    let snapshot = ProductDataExportSnapshot(
      profile: profile,
      journey: JourneyReducer.reduce(
        events: resolvedEvents,
        profileGenerationID: profile.profileGenerationID
      ),
      events: resolvedEvents,
      customization: try await customization,
      journalEntries: try await journal,
      favoritePracticeIDs: try await favorites,
      syncStatus: await status,
      exportedAt: exportedAt
    )
    let milliseconds = Int64(exportedAt.timeIntervalSince1970 * 1_000)
    let output = try exportStaging.prepare(
      named: "arrive-within-complete-\(milliseconds).zip",
      now: exportedAt
    )
    try WholeProductExporter.export(
      snapshot: snapshot,
      audioDirectory: journalAudioDirectory,
      outputURL: output,
      fileManager: fileManager
    )
    return output
  }

  public func resetGarden(
    profile: LocalProfile,
    newProfileGenerationID: UUID,
    newGardenID: UUID,
    newGardenSeed: UInt64,
    at resetAt: Date
  ) async throws -> ProductResetOutcome {
    let oldEntries = try await store.journalEntries(
      profileGenerationID: profile.profileGenerationID,
      includingDeleted: true
    )
    let reset = try profile.resetting(
      profileGenerationID: newProfileGenerationID,
      gardenID: newGardenID,
      gardenSeed: newGardenSeed,
      at: resetAt
    )
    try await store.resetProfile(from: profile, to: reset)
    var cleanupPending = !deleteAudioFiles(
      named: Set(oldEntries.compactMap(\.audioAttachment?.relativeFileName))
    )
    do {
      try exportStaging.purgeAll()
    } catch {
      cleanupPending = true
    }
    _ = deleteExactLocalItem(named: "session-state-v1.json", directory: dataDirectory)
    return ProductResetOutcome(profile: reset, cleanupPending: cleanupPending)
  }

  public func deleteAllData(at requestedAt: Date = Date()) async throws -> ProductDeletionOutcome {
    let status = await store.syncStatus()
    if status != .localOnly {
      try writeDeletionState(requestedAt: requestedAt)
    }
    try await store.deleteAllProductRecords()

    var localDeletionSucceeded = deleteAllRegularFiles(in: journalAudioDirectory)
    localDeletionSucceeded = deleteAllRegularFiles(in: exportDirectory) && localDeletionSucceeded
    for name in Self.standaloneProductArtifactNames {
      localDeletionSucceeded = deleteExactLocalItem(named: name, directory: dataDirectory)
        && localDeletionSucceeded
    }
    guard localDeletionSucceeded else {
      throw ProductDataControlError.couldNotDeleteLocalData
    }
    if status == .localOnly {
      _ = deleteExactLocalItem(named: deletionStateURL.lastPathComponent, directory: dataDirectory)
      return .localDeletionComplete
    }
    return .pendingPrivateCloudConfirmation
  }

  public func retryPendingPrivateCloudDeletion() async throws -> ProductDeletionOutcome {
    guard hasPendingPrivateCloudDeletion() else { return .localDeletionComplete }
    try await store.deleteAllProductRecords()
    return .pendingPrivateCloudConfirmation
  }

  private func writeDeletionState(requestedAt: Date) throws {
    let state = DeletionState(
      schemaVersion: 1,
      state: .pendingPrivateCloudConfirmation,
      requestedAt: requestedAt
    )
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .millisecondsSince1970
    encoder.outputFormatting = [.sortedKeys]
    do {
      try fileManager.createDirectory(at: dataDirectory, withIntermediateDirectories: true)
      try encoder.encode(state).write(to: deletionStateURL, options: .atomic)
      #if os(iOS)
        try fileManager.setAttributes(
          [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
          ofItemAtPath: deletionStateURL.path
        )
      #endif
    } catch {
      throw ProductDataControlError.couldNotDeleteLocalData
    }
  }

  private func deleteAudioFiles(named names: Set<String>) -> Bool {
    names.reduce(true) { succeeded, name in
      deleteExactLocalItem(named: name, directory: journalAudioDirectory) && succeeded
    }
  }

  private func deleteAllRegularFiles(in directory: URL) -> Bool {
    guard fileManager.fileExists(atPath: directory.path) else { return true }
    guard isDirectChild(directory, of: dataDirectory) else { return false }
    do {
      let values = try directory.resourceValues(
        forKeys: [.isDirectoryKey, .isSymbolicLinkKey]
      )
      guard values.isDirectory == true, values.isSymbolicLink != true else { return false }
      let items = try fileManager.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey]
      )
      for item in items {
        guard isDirectChild(item, of: directory) else { return false }
        let itemValues = try item.resourceValues(
          forKeys: [.isRegularFileKey, .isSymbolicLinkKey]
        )
        guard itemValues.isRegularFile == true, itemValues.isSymbolicLink != true else {
          return false
        }
      }
      for item in items { try fileManager.removeItem(at: item) }
      return true
    } catch {
      return false
    }
  }

  private func deleteExactLocalItem(named name: String, directory: URL) -> Bool {
    guard !name.isEmpty, name == URL(fileURLWithPath: name).lastPathComponent else {
      return false
    }
    let target = directory.appending(path: name).standardizedFileURL
    guard isDirectChild(target, of: directory) else { return false }
    guard fileManager.fileExists(atPath: target.path) else { return true }
    do {
      let values = try target.resourceValues(
        forKeys: [.isRegularFileKey, .isSymbolicLinkKey]
      )
      guard values.isRegularFile == true, values.isSymbolicLink != true else { return false }
      try fileManager.removeItem(at: target)
      return true
    } catch {
      return false
    }
  }

  private func isDirectChild(_ candidate: URL, of parent: URL) -> Bool {
    let resolvedParent = parent.resolvingSymlinksInPath().standardizedFileURL
    let resolvedCandidate = candidate.resolvingSymlinksInPath().standardizedFileURL
    return resolvedParent.path != "/"
      && resolvedCandidate.deletingLastPathComponent().path == resolvedParent.path
  }
}
