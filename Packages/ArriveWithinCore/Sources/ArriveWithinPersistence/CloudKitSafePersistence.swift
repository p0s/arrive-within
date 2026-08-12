import ArriveWithinContent
import ArriveWithinDomain
import CloudKit
import CoreData
import CryptoKit
import Foundation

public enum ProductStoreMode: Equatable, Sendable {
  case localOnly
  case privateCloud(containerIdentifier: String)
}

public struct ProductStoreConfiguration: Equatable, Sendable {
  public let storeURL: URL
  public let mode: ProductStoreMode

  public init(storeURL: URL, mode: ProductStoreMode = .localOnly) {
    self.storeURL = storeURL
    self.mode = mode
  }
}

public enum ProductSyncStatus: String, Codable, CaseIterable, Equatable, Sendable {
  case localOnly
  case available
  case syncing
  case upToDate
  case offline
  case noICloudAccount
  case restricted
  case quotaFull
  case temporarilyUnavailable
  case error
}

public enum ProductSyncSignal: Equatable, Sendable {
  case accountAvailable
  case operationStarted
  case operationSucceeded
  case offline
  case noICloudAccount
  case restricted
  case quotaFull
  case temporarilyUnavailable
  case error
}

public enum ProductSyncStateReducer {
  public static func reduce(
    current: ProductSyncStatus,
    signal: ProductSyncSignal,
    cloudBacked: Bool
  ) -> ProductSyncStatus {
    guard cloudBacked else { return .localOnly }
    switch signal {
    case .accountAvailable:
      return current == .upToDate ? .upToDate : .available
    case .operationStarted: return .syncing
    case .operationSucceeded: return .upToDate
    case .offline: return .offline
    case .noICloudAccount: return .noICloudAccount
    case .restricted: return .restricted
    case .quotaFull: return .quotaFull
    case .temporarilyUnavailable: return .temporarilyUnavailable
    case .error: return .error
    }
  }
}

public struct ProductDataCounts: Codable, Equatable, Sendable {
  public let profileGenerations: Int
  public let practiceEvents: Int
  public let journalEntries: Int
  public let journalConflicts: Int
  public let favoritePractices: Int
  public let customizations: Int

  public init(
    profileGenerations: Int,
    practiceEvents: Int,
    journalEntries: Int,
    journalConflicts: Int = 0,
    favoritePractices: Int,
    customizations: Int
  ) {
    self.profileGenerations = profileGenerations
    self.practiceEvents = practiceEvents
    self.journalEntries = journalEntries
    self.journalConflicts = journalConflicts
    self.favoritePractices = favoritePractices
    self.customizations = customizations
  }
}

public enum ProductStoreError: Error, Equatable, Sendable {
  case invalidStoreURL
  case invalidCloudContainerIdentifier
  case couldNotLoadPersistentStore
  case unreadableRecord(entity: String)
  case conflictingEventIdentifier(existingSessionID: UUID)
  case couldNotPersist
}

public enum JournalAudioReplicaError: Error, Equatable, Sendable {
  case unsafeAudioDirectory
  case unsafeAttachmentPath
  case missingAttachment
  case unreadableAttachment
  case attachmentIntegrityMismatch
}

/// One domain model backs both the safe public local-only store and an optional
/// maintainer-configured private CloudKit mirror. Domain values remain Codable
/// payloads so the rest of the product never depends on Core Data types.
public actor CoreDataProductStore {
  private enum Entity: String, CaseIterable {
    case profile = "AWProfileGeneration"
    case event = "AWPracticeEvent"
    case customization = "AWGardenCustomization"
    case journal = "AWJournalEntry"
    case favorite = "AWFavoritePractice"
  }

  private final class ContainerBox: @unchecked Sendable {
    let container: NSPersistentCloudKitContainer

    init(configuration: ProductStoreConfiguration) throws {
      guard configuration.storeURL.isFileURL else { throw ProductStoreError.invalidStoreURL }
      if case .privateCloud(let identifier) = configuration.mode,
        identifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      {
        throw ProductStoreError.invalidCloudContainerIdentifier
      }

      container = NSPersistentCloudKitContainer(
        name: "ArriveWithinProduct",
        managedObjectModel: Self.makeModel()
      )
      let description = NSPersistentStoreDescription(url: configuration.storeURL)
      description.shouldAddStoreAsynchronously = true
      description.shouldMigrateStoreAutomatically = true
      description.shouldInferMappingModelAutomatically = true
      description.setOption(true as NSNumber, forKey: NSPersistentHistoryTrackingKey)
      description.setOption(
        true as NSNumber,
        forKey: NSPersistentStoreRemoteChangeNotificationPostOptionKey
      )
      #if os(iOS)
        description.setOption(
          FileProtectionType.completeUntilFirstUserAuthentication as NSObject,
          forKey: NSPersistentStoreFileProtectionKey
        )
      #endif
      if case .privateCloud(let identifier) = configuration.mode {
        let options = NSPersistentCloudKitContainerOptions(containerIdentifier: identifier)
        options.databaseScope = .private
        description.cloudKitContainerOptions = options
      }
      container.persistentStoreDescriptions = [description]
      container.viewContext.automaticallyMergesChangesFromParent = true
      container.viewContext.mergePolicy = NSMergePolicy(
        merge: .mergeByPropertyObjectTrumpMergePolicyType
      )
    }

    func load() async throws {
      try await withCheckedThrowingContinuation { continuation in
        container.loadPersistentStores { _, error in
          if error == nil {
            continuation.resume()
          } else {
            continuation.resume(throwing: ProductStoreError.couldNotLoadPersistentStore)
          }
        }
      }
    }

    private static func makeModel() -> NSManagedObjectModel {
      let model = NSManagedObjectModel()
      model.versionIdentifiers = ["ArriveWithinProduct.v1"]
      model.entities = [
        entity(
          Entity.profile.rawValue,
          attributes: [
            attribute("profileGenerationID", .stringAttributeType, defaultValue: ""),
            attribute("installationID", .stringAttributeType, defaultValue: ""),
            attribute("schemaVersion", .integer64AttributeType, defaultValue: Int64(1)),
            attribute("createdAt", .dateAttributeType, defaultValue: Date(timeIntervalSince1970: 0)),
            attribute("modifiedAt", .dateAttributeType, defaultValue: Date(timeIntervalSince1970: 0)),
            attribute("isActive", .booleanAttributeType, defaultValue: false),
            attribute("previousProfileGenerationID", .stringAttributeType, optional: true),
            attribute("resetAt", .dateAttributeType, optional: true),
            attribute("payload", .binaryDataAttributeType, defaultValue: Data()),
          ]
        ),
        entity(
          Entity.event.rawValue,
          attributes: [
            attribute("eventID", .stringAttributeType, defaultValue: ""),
            attribute("sessionID", .stringAttributeType, defaultValue: ""),
            attribute("profileGenerationID", .stringAttributeType, defaultValue: ""),
            attribute("createdAt", .dateAttributeType, defaultValue: Date(timeIntervalSince1970: 0)),
            attribute("payload", .binaryDataAttributeType, defaultValue: Data()),
          ]
        ),
        entity(
          Entity.customization.rawValue,
          attributes: [
            attribute("profileGenerationID", .stringAttributeType, defaultValue: ""),
            attribute("modifiedAt", .dateAttributeType, defaultValue: Date(timeIntervalSince1970: 0)),
            attribute("payload", .binaryDataAttributeType, defaultValue: Data()),
          ]
        ),
        entity(
          Entity.journal.rawValue,
          attributes: [
            attribute("entryID", .stringAttributeType, defaultValue: ""),
            attribute("profileGenerationID", .stringAttributeType, defaultValue: ""),
            attribute("revision", .integer64AttributeType, defaultValue: Int64(0)),
            attribute("modifiedAt", .dateAttributeType, defaultValue: Date(timeIntervalSince1970: 0)),
            attribute("deletedAt", .dateAttributeType, optional: true),
            attribute(
              "audioData",
              .binaryDataAttributeType,
              optional: true,
              allowsExternalBinaryDataStorage: true
            ),
            attribute("payload", .binaryDataAttributeType, defaultValue: Data()),
          ]
        ),
        entity(
          Entity.favorite.rawValue,
          attributes: [
            attribute("practiceID", .stringAttributeType, defaultValue: ""),
            attribute("modifiedAt", .dateAttributeType, defaultValue: Date(timeIntervalSince1970: 0)),
            attribute("removed", .booleanAttributeType, defaultValue: false),
          ]
        ),
      ]
      return model
    }

    private static func entity(
      _ name: String,
      attributes: [NSAttributeDescription]
    ) -> NSEntityDescription {
      let entity = NSEntityDescription()
      entity.name = name
      entity.managedObjectClassName = NSStringFromClass(NSManagedObject.self)
      entity.properties = attributes
      return entity
    }

    private static func attribute(
      _ name: String,
      _ type: NSAttributeType,
      optional: Bool = false,
      defaultValue: Any? = nil,
      allowsExternalBinaryDataStorage: Bool = false
    ) -> NSAttributeDescription {
      let attribute = NSAttributeDescription()
      attribute.name = name
      attribute.attributeType = type
      attribute.isOptional = optional
      attribute.defaultValue = defaultValue
      if type == .binaryDataAttributeType {
        attribute.allowsExternalBinaryDataStorage = allowsExternalBinaryDataStorage
      }
      return attribute
    }
  }

  private let box: ContainerBox
  private let mode: ProductStoreMode
  private let ready: Task<Void, Error>
  private var currentSyncStatus: ProductSyncStatus
  private var cloudMonitorTask: Task<Void, Never>?

  public init(configuration: ProductStoreConfiguration) throws {
    let box = try ContainerBox(configuration: configuration)
    self.box = box
    self.mode = configuration.mode
    self.currentSyncStatus = configuration.mode == .localOnly ? .localOnly : .available
    self.ready = Task { try await box.load() }
  }

  public func syncStatus() -> ProductSyncStatus { currentSyncStatus }

  #if DEBUG
    /// Creates the development CloudKit schema for this exact Core Data model.
    /// Release builds cannot call this maintenance-only operation.
    public func initializeCloudKitDevelopmentSchema() async throws {
      guard case .privateCloud = mode else {
        throw ProductStoreError.invalidCloudContainerIdentifier
      }
      try await ready.value
      try box.container.initializeCloudKitSchema(options: [])
    }
  #endif

  public func applySyncSignal(_ signal: ProductSyncSignal) {
    currentSyncStatus = ProductSyncStateReducer.reduce(
      current: currentSyncStatus,
      signal: signal,
      cloudBacked: mode != .localOnly
    )
  }

  public func startCloudStatusMonitoring() {
    guard case .privateCloud(let identifier) = mode, cloudMonitorTask == nil else { return }
    cloudMonitorTask = Task { [weak self] in
      guard let self else { return }
      await self.refreshCloudAccountStatus(containerIdentifier: identifier)
      for await notification in NotificationCenter.default.notifications(
        named: NSPersistentCloudKitContainer.eventChangedNotification
      ) {
        guard !Task.isCancelled,
          let event = notification.userInfo?[
            NSPersistentCloudKitContainer.eventNotificationUserInfoKey
          ] as? NSPersistentCloudKitContainer.Event
        else { continue }
        let signal: ProductSyncSignal
        if event.endDate == nil {
          signal = .operationStarted
        } else if event.succeeded {
          signal = .operationSucceeded
        } else if let error = event.error {
          signal = Self.signal(for: error)
        } else {
          signal = .error
        }
        await self.applySyncSignal(signal)
      }
    }
  }

  public func refreshCloudAccountStatus() async {
    guard case .privateCloud(let identifier) = mode else { return }
    await refreshCloudAccountStatus(containerIdentifier: identifier)
  }

  public func loadActiveProfile() async throws -> LocalProfile? {
    let profiles: [LocalProfile] = try await decodedRecords(Entity.profile)
    guard let canonical = canonicalProfile(in: profiles) else { return nil }
    try await markActiveProfile(canonical.profileGenerationID)
    return canonical
  }

  public func allProfiles() async throws -> [LocalProfile] {
    let profiles: [LocalProfile] = try await decodedRecords(Entity.profile)
    return profiles.sorted {
      if $0.createdAt != $1.createdAt { return $0.createdAt < $1.createdAt }
      return $0.profileGenerationID.uuidString < $1.profileGenerationID.uuidString
    }
  }

  public func saveProfile(_ profile: LocalProfile) async throws {
    try await perform { context in
      let records = try Self.fetch(
        Entity.profile,
        predicate: NSPredicate(
          format: "profileGenerationID == %@",
          profile.profileGenerationID.uuidString
        ),
        context: context
      )
      let record = records.first ?? Self.insert(Entity.profile, context: context)
      record.setValue(profile.profileGenerationID.uuidString, forKey: "profileGenerationID")
      record.setValue(profile.installationID.uuidString, forKey: "installationID")
      record.setValue(Int64(profile.schemaVersion), forKey: "schemaVersion")
      record.setValue(profile.createdAt, forKey: "createdAt")
      record.setValue(profile.resetAt ?? profile.createdAt, forKey: "modifiedAt")
      record.setValue(true, forKey: "isActive")
      record.setValue(profile.previousProfileGenerationID?.uuidString, forKey: "previousProfileGenerationID")
      record.setValue(profile.resetAt, forKey: "resetAt")
      record.setValue(try Self.encode(profile), forKey: "payload")
      for other in try Self.fetch(Entity.profile, context: context)
      where other !== record {
        other.setValue(false, forKey: "isActive")
      }
      try Self.save(context)
    }
  }

  public func allEvents(profileGenerationID: UUID) async throws -> [PracticeEvent] {
    let values: [PracticeEvent] = try await decodedRecords(
      Entity.event,
      profileGenerationID: profileGenerationID
    )
    return values.sorted {
      if $0.endedAt != $1.endedAt { return $0.endedAt < $1.endedAt }
      return $0.id.uuidString < $1.id.uuidString
    }
  }

  public func event(
    sessionID: UUID,
    profileGenerationID: UUID
  ) async throws -> PracticeEvent? {
    try await perform { context in
      let records = try Self.fetch(
        Entity.event,
        predicate: NSCompoundPredicate(andPredicateWithSubpredicates: [
          NSPredicate(format: "sessionID == %@", sessionID.uuidString),
          NSPredicate(
            format: "profileGenerationID == %@",
            profileGenerationID.uuidString
          ),
        ]),
        context: context
      )
      guard let record = records.first else { return nil }
      return try Self.decode(record, as: PracticeEvent.self)
    }
  }

  @discardableResult
  public func insertEventIfAbsent(_ event: PracticeEvent) async throws -> PracticeEvent {
    try await perform { context in
      let duplicate = try Self.fetch(
        Entity.event,
        predicate: NSCompoundPredicate(andPredicateWithSubpredicates: [
          NSPredicate(format: "sessionID == %@", event.sessionID.uuidString),
          NSPredicate(
            format: "profileGenerationID == %@",
            event.profileGenerationID.uuidString
          ),
        ]),
        context: context
      ).first
      if let duplicate { return try Self.decode(duplicate, as: PracticeEvent.self) }

      let conflicting = try Self.fetch(
        Entity.event,
        predicate: NSPredicate(format: "eventID == %@", event.id.uuidString),
        context: context
      ).first
      if let conflicting {
        let existing = try Self.decode(conflicting, as: PracticeEvent.self)
        throw ProductStoreError.conflictingEventIdentifier(existingSessionID: existing.sessionID)
      }

      let record = Self.insert(Entity.event, context: context)
      record.setValue(event.id.uuidString, forKey: "eventID")
      record.setValue(event.sessionID.uuidString, forKey: "sessionID")
      record.setValue(event.profileGenerationID.uuidString, forKey: "profileGenerationID")
      record.setValue(event.createdAt, forKey: "createdAt")
      record.setValue(try Self.encode(event), forKey: "payload")
      try Self.save(context)
      return event
    }
  }

  public func loadCustomization(profileGenerationID: UUID) async throws -> GardenCustomization {
    try await perform { context in
      let records = try Self.fetch(
        Entity.customization,
        predicate: NSPredicate(
          format: "profileGenerationID == %@",
          profileGenerationID.uuidString
        ),
        context: context
      )
      guard let record = records.max(by: { Self.modifiedAt($0) < Self.modifiedAt($1) }) else {
        return GardenCustomization()
      }
      return try Self.decode(record, as: GardenCustomization.self)
    }
  }

  public func saveCustomization(
    _ customization: GardenCustomization,
    profileGenerationID: UUID,
    modifiedAt: Date = Date()
  ) async throws {
    try await perform { context in
      let records = try Self.fetch(
        Entity.customization,
        predicate: NSPredicate(
          format: "profileGenerationID == %@",
          profileGenerationID.uuidString
        ),
        context: context
      )
      let record = records.max(by: { Self.modifiedAt($0) < Self.modifiedAt($1) })
        ?? Self.insert(Entity.customization, context: context)
      for duplicate in records where duplicate !== record { context.delete(duplicate) }
      record.setValue(profileGenerationID.uuidString, forKey: "profileGenerationID")
      record.setValue(modifiedAt, forKey: "modifiedAt")
      record.setValue(try Self.encode(customization), forKey: "payload")
      try Self.save(context)
    }
  }

  public func journalEntries(
    profileGenerationID: UUID,
    includingDeleted: Bool
  ) async throws -> [JournalEntry] {
    var values = try await perform { context in
      let predicate = NSPredicate(
        format: "profileGenerationID == %@",
        profileGenerationID.uuidString
      )
      let records = try Self.pruneSupersededJournalRecords(
        Self.fetch(Entity.journal, predicate: predicate, context: context),
        context: context
      )
      try Self.save(context)
      return try Self.resolveJournalRecords(records).entries
    }
    if !includingDeleted { values.removeAll(where: \.isDeleted) }
    return values.sorted {
      if $0.modifiedAt != $1.modifiedAt { return $0.modifiedAt > $1.modifiedAt }
      return $0.id.uuidString < $1.id.uuidString
    }
  }

  public func allJournalEntries(includingDeleted: Bool) async throws -> [JournalEntry] {
    var values = try await perform { context in
      let records = try Self.pruneSupersededJournalRecords(
        Self.fetch(Entity.journal, context: context),
        context: context
      )
      try Self.save(context)
      return try Self.resolveJournalRecords(records).entries
    }
    if !includingDeleted { values.removeAll(where: \.isDeleted) }
    return values.sorted {
      if $0.modifiedAt != $1.modifiedAt { return $0.modifiedAt > $1.modifiedAt }
      return $0.id.uuidString < $1.id.uuidString
    }
  }

  public func journalConflicts(
    profileGenerationID: UUID
  ) async throws -> [JournalReplicaConflict] {
    try await perform { context in
      let predicate = NSPredicate(
        format: "profileGenerationID == %@",
        profileGenerationID.uuidString
      )
      let records = try Self.pruneSupersededJournalRecords(
        Self.fetch(Entity.journal, predicate: predicate, context: context),
        context: context
      )
      try Self.save(context)
      return try Self.resolveJournalRecords(records).conflicts
    }
  }

  public func saveJournalEntry(
    _ entry: JournalEntry,
    expectedRevision: Int?,
    audioData: Data? = nil
  ) async throws -> JournalWriteResult {
    try await perform { context in
      let records = try Self.fetch(
        Entity.journal,
        predicate: NSPredicate(format: "entryID == %@", entry.id.uuidString),
        context: context
      )
      let resolved = try Self.resolveJournalRecords(records)
      if let current = resolved.entries.first {
        guard current.profileGenerationID == entry.profileGenerationID else {
          throw JournalEntryError.identityChanged
        }
        guard expectedRevision == current.revision, entry.revision == current.revision else {
          return .conflict(current: current, attempted: entry)
        }
        let saved = try entry.persisted(revision: current.revision + 1)
        let record = Self.insert(Entity.journal, context: context)
        try Self.write(saved, audioData: audioData, to: record)
        for superseded in records { context.delete(superseded) }
        try Self.save(context)
        return .saved(saved)
      }
      guard expectedRevision == nil, entry.revision == 0 else {
        throw JournalEntryError.missingExpectedEntry
      }
      let saved = try entry.persisted(revision: 1)
      let record = Self.insert(Entity.journal, context: context)
      try Self.write(saved, audioData: audioData, to: record)
      try Self.save(context)
      return .saved(saved)
    }
  }

  /// Mirrors the append-only shape produced by independent CloudKit inserts.
  /// It is internal so deterministic tests can prove convergence without a
  /// configured container; production replicas arrive through CloudKit.
  func preserveJournalReplica(_ entry: JournalEntry, audioData: Data? = nil) async throws {
    guard entry.revision > 0 else { throw JournalEntryError.invalidRevision }
    try await perform { context in
      let records = try Self.fetch(
        Entity.journal,
        predicate: NSPredicate(format: "entryID == %@", entry.id.uuidString),
        context: context
      )
      for record in records {
        if try Self.decode(record, as: JournalEntry.self) == entry { return }
      }
      let record = Self.insert(Entity.journal, context: context)
      try Self.write(entry, audioData: audioData, to: record)
      _ = try Self.pruneSupersededJournalRecords(records + [record], context: context)
      try Self.save(context)
    }
  }

  public func journalAudioData(for entry: JournalEntry) async throws -> Data? {
    try await perform { context in
      let records = try Self.fetch(
        Entity.journal,
        predicate: NSPredicate(format: "entryID == %@", entry.id.uuidString),
        context: context
      )
      for record in records {
        if try Self.decode(record, as: JournalEntry.self) == entry {
          return record.value(forKey: "audioData") as? Data
        }
      }
      return nil
    }
  }

  public func loadFavoritePracticeIDs() async throws -> Set<String> {
    try await perform { context in
      let records = try Self.fetch(Entity.favorite, context: context)
      var latest: [String: (date: Date, removed: Bool)] = [:]
      for record in records {
        guard let id = record.value(forKey: "practiceID") as? String else {
          throw ProductStoreError.unreadableRecord(entity: Entity.favorite.rawValue)
        }
        let candidate = (
          Self.modifiedAt(record),
          (record.value(forKey: "removed") as? Bool) ?? false
        )
        if latest[id] == nil || latest[id]!.date <= candidate.0 { latest[id] = candidate }
      }
      return Set(latest.compactMap { $0.value.removed ? nil : $0.key })
    }
  }

  public func saveFavoritePracticeIDs(
    _ identifiers: Set<String>,
    modifiedAt: Date = Date()
  ) async throws {
    try await perform { context in
      let records = try Self.fetch(Entity.favorite, context: context)
      var latest: [String: NSManagedObject] = [:]
      for record in records {
        guard let id = record.value(forKey: "practiceID") as? String else { continue }
        if let current = latest[id] {
          if Self.modifiedAt(current) <= Self.modifiedAt(record) {
            context.delete(current)
            latest[id] = record
          } else {
            context.delete(record)
          }
        } else {
          latest[id] = record
        }
      }
      let allIDs = Set(latest.keys).union(identifiers)
      for id in allIDs {
        let record = latest[id] ?? Self.insert(Entity.favorite, context: context)
        record.setValue(id, forKey: "practiceID")
        record.setValue(modifiedAt, forKey: "modifiedAt")
        record.setValue(!identifiers.contains(id), forKey: "removed")
      }
      try Self.save(context)
    }
  }

  public func deleteEvents(profileGenerationID: UUID) async throws {
    try await delete(Entity.event, profileGenerationID: profileGenerationID)
  }

  public func deleteCustomization(profileGenerationID: UUID) async throws {
    try await delete(Entity.customization, profileGenerationID: profileGenerationID)
  }

  public func deleteJournalEntries(profileGenerationID: UUID) async throws {
    try await delete(Entity.journal, profileGenerationID: profileGenerationID)
  }

  public func resetProfile(from oldProfile: LocalProfile, to newProfile: LocalProfile) async throws {
    guard newProfile.previousProfileGenerationID == oldProfile.profileGenerationID,
      newProfile.resetAt != nil
    else {
      throw ProductStoreError.couldNotPersist
    }
    try await saveProfile(newProfile)
    try await deleteEvents(profileGenerationID: oldProfile.profileGenerationID)
    try await deleteCustomization(profileGenerationID: oldProfile.profileGenerationID)
    try await deleteJournalEntries(profileGenerationID: oldProfile.profileGenerationID)
  }

  public func deleteAllProductRecords() async throws {
    try await perform { context in
      for entity in Entity.allCases {
        for record in try Self.fetch(entity, context: context) { context.delete(record) }
      }
      try Self.save(context)
    }
  }

  public func counts() async throws -> ProductDataCounts {
    try await perform { context in
      let journal = try Self.resolveJournalRecords(Self.fetch(Entity.journal, context: context))
      return ProductDataCounts(
        profileGenerations: try Self.fetch(Entity.profile, context: context).count,
        practiceEvents: try Self.fetch(Entity.event, context: context).count,
        journalEntries: journal.entries.filter { !$0.isDeleted }.count,
        journalConflicts: journal.conflicts.count,
        favoritePractices: try Self.fetch(
          Entity.favorite,
          predicate: NSPredicate(format: "removed == NO"),
          context: context
        ).count,
        customizations: try Self.fetch(Entity.customization, context: context).count
      )
    }
  }

  private func canonicalProfile(in profiles: [LocalProfile]) -> LocalProfile? {
    guard !profiles.isEmpty else { return nil }
    let byID = Dictionary(uniqueKeysWithValues: profiles.map { ($0.profileGenerationID, $0) })
    let parents = Set(profiles.compactMap(\.previousProfileGenerationID))
    let leaves = profiles.filter { !parents.contains($0.profileGenerationID) }
    let candidates = leaves.isEmpty ? profiles : leaves
    func depth(_ profile: LocalProfile) -> Int {
      var seen: Set<UUID> = []
      var current: LocalProfile? = profile
      var value = 0
      while let next = current?.previousProfileGenerationID,
        seen.insert(next).inserted,
        let parent = byID[next]
      {
        value += 1
        current = parent
      }
      return value
    }
    return candidates.max {
      let left = (depth($0), $0.resetAt ?? $0.createdAt, $0.profileGenerationID.uuidString)
      let right = (depth($1), $1.resetAt ?? $1.createdAt, $1.profileGenerationID.uuidString)
      if left.0 != right.0 { return left.0 < right.0 }
      if left.1 != right.1 { return left.1 < right.1 }
      return left.2 < right.2
    }
  }

  private func refreshCloudAccountStatus(containerIdentifier: String) async {
    do {
      switch try await CKContainer(identifier: containerIdentifier).accountStatus() {
      case .available: applySyncSignal(.accountAvailable)
      case .noAccount: applySyncSignal(.noICloudAccount)
      case .restricted: applySyncSignal(.restricted)
      case .couldNotDetermine, .temporarilyUnavailable:
        applySyncSignal(.temporarilyUnavailable)
      @unknown default: applySyncSignal(.error)
      }
    } catch {
      applySyncSignal(Self.signal(for: error))
    }
  }

  nonisolated private static func signal(for error: Error) -> ProductSyncSignal {
    let nsError = error as NSError
    guard nsError.domain == CKError.errorDomain, let code = CKError.Code(rawValue: nsError.code)
    else {
      return .error
    }
    switch code {
    case .networkUnavailable, .networkFailure: return .offline
    case .notAuthenticated: return .noICloudAccount
    case .permissionFailure: return .restricted
    case .quotaExceeded: return .quotaFull
    case .serviceUnavailable, .requestRateLimited, .zoneBusy:
      return .temporarilyUnavailable
    default: return .error
    }
  }

  private func markActiveProfile(_ identifier: UUID) async throws {
    try await perform { context in
      for record in try Self.fetch(Entity.profile, context: context) {
        record.setValue(
          (record.value(forKey: "profileGenerationID") as? String) == identifier.uuidString,
          forKey: "isActive"
        )
      }
      try Self.save(context)
    }
  }

  private func decodedRecords<Value: Decodable & Sendable>(
    _ entity: Entity,
    profileGenerationID: UUID? = nil
  ) async throws -> [Value] {
    try await perform { context in
      let predicate = profileGenerationID.map {
        NSPredicate(format: "profileGenerationID == %@", $0.uuidString)
      }
      return try Self.fetch(entity, predicate: predicate, context: context).map {
        try Self.decode($0, as: Value.self)
      }
    }
  }

  private func delete(_ entity: Entity, profileGenerationID: UUID) async throws {
    try await perform { context in
      let predicate = NSPredicate(
        format: "profileGenerationID == %@",
        profileGenerationID.uuidString
      )
      for record in try Self.fetch(entity, predicate: predicate, context: context) {
        context.delete(record)
      }
      try Self.save(context)
    }
  }

  private func perform<Value: Sendable>(
    _ work: @Sendable (NSManagedObjectContext) throws -> Value
  ) async throws -> Value {
    try await ready.value
    let context = box.container.newBackgroundContext()
    context.mergePolicy = NSMergePolicy(
      merge: .mergeByPropertyObjectTrumpMergePolicyType
    )
    context.undoManager = nil
    do {
      return try context.performAndWait { try work(context) }
    } catch let error as ProductStoreError {
      throw error
    } catch let error as JournalEntryError {
      throw error
    } catch {
      throw ProductStoreError.couldNotPersist
    }
  }

  private static func fetch(
    _ entity: Entity,
    predicate: NSPredicate? = nil,
    context: NSManagedObjectContext
  ) throws -> [NSManagedObject] {
    let request = NSFetchRequest<NSManagedObject>(entityName: entity.rawValue)
    request.predicate = predicate
    return try context.fetch(request)
  }

  private static func insert(
    _ entity: Entity,
    context: NSManagedObjectContext
  ) -> NSManagedObject {
    NSEntityDescription.insertNewObject(forEntityName: entity.rawValue, into: context)
  }

  private static func encode<Value: Encodable>(_ value: Value) throws -> Data {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .millisecondsSince1970
    encoder.outputFormatting = [.sortedKeys]
    return try encoder.encode(value)
  }

  private static func decode<Value: Decodable>(
    _ record: NSManagedObject,
    as type: Value.Type
  ) throws -> Value {
    guard let data = record.value(forKey: "payload") as? Data else {
      throw ProductStoreError.unreadableRecord(entity: record.entity.name ?? "unknown")
    }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .millisecondsSince1970
    do {
      return try decoder.decode(type, from: data)
    } catch {
      throw ProductStoreError.unreadableRecord(entity: record.entity.name ?? "unknown")
    }
  }

  private static func resolveJournalRecords(
    _ records: [NSManagedObject]
  ) throws -> (entries: [JournalEntry], conflicts: [JournalReplicaConflict]) {
    let decoded = try records.map { try decode($0, as: JournalEntry.self) }
    let grouped = Dictionary(grouping: decoded, by: \JournalEntry.id)
    var entries: [JournalEntry] = []
    var conflicts: [JournalReplicaConflict] = []
    for entryID in grouped.keys.sorted(by: { $0.uuidString < $1.uuidString }) {
      guard let replicas = grouped[entryID], let highest = replicas.map(\.revision).max() else {
        continue
      }
      var variants: [JournalEntry] = []
      for replica in replicas where replica.revision == highest {
        if !variants.contains(replica) { variants.append(replica) }
      }
      variants.sort(by: journalReplicaPrecedes)
      guard let canonical = variants.last else { continue }
      entries.append(canonical)
      if variants.count > 1 {
        conflicts.append(
          JournalReplicaConflict(
            entryID: entryID,
            profileGenerationID: canonical.profileGenerationID,
            revision: highest,
            variants: variants
          )
        )
      }
    }
    entries.sort {
      if $0.modifiedAt != $1.modifiedAt { return $0.modifiedAt > $1.modifiedAt }
      return $0.id.uuidString < $1.id.uuidString
    }
    return (entries, conflicts)
  }

  private static func pruneSupersededJournalRecords(
    _ records: [NSManagedObject],
    context: NSManagedObjectContext
  ) throws -> [NSManagedObject] {
    let decoded = try records.map { ($0, try decode($0, as: JournalEntry.self)) }
    let highestByEntry = Dictionary(grouping: decoded, by: { $0.1.id })
      .mapValues { values in values.map { $0.1.revision }.max() ?? 0 }
    var retained: [NSManagedObject] = []
    for (record, entry) in decoded {
      if entry.revision < highestByEntry[entry.id, default: entry.revision] {
        context.delete(record)
      } else {
        retained.append(record)
      }
    }
    return retained
  }

  private static func journalReplicaPrecedes(_ lhs: JournalEntry, _ rhs: JournalEntry) -> Bool {
    // At an unresolved delete/edit fork, keep private content visible while
    // retaining the tombstone. A later explicit revision resolves the fork.
    if lhs.isDeleted != rhs.isDeleted { return lhs.isDeleted && !rhs.isDeleted }
    if lhs.modifiedAt != rhs.modifiedAt { return lhs.modifiedAt < rhs.modifiedAt }
    if lhs.sourceInstallationID != rhs.sourceInstallationID {
      return lhs.sourceInstallationID.uuidString < rhs.sourceInstallationID.uuidString
    }
    let left = (try? encode(lhs).base64EncodedString()) ?? ""
    let right = (try? encode(rhs).base64EncodedString()) ?? ""
    return left < right
  }

  private static func write(
    _ entry: JournalEntry,
    audioData: Data?,
    to record: NSManagedObject
  ) throws {
    record.setValue(entry.id.uuidString, forKey: "entryID")
    record.setValue(entry.profileGenerationID.uuidString, forKey: "profileGenerationID")
    record.setValue(Int64(entry.revision), forKey: "revision")
    record.setValue(entry.modifiedAt, forKey: "modifiedAt")
    record.setValue(entry.deletedAt, forKey: "deletedAt")
    record.setValue(audioData, forKey: "audioData")
    record.setValue(try encode(entry), forKey: "payload")
  }

  private static func modifiedAt(_ record: NSManagedObject) -> Date {
    (record.value(forKey: "modifiedAt") as? Date) ?? Date(timeIntervalSince1970: 0)
  }

  private static func revision(_ record: NSManagedObject) -> Int64 {
    (record.value(forKey: "revision") as? NSNumber)?.int64Value ?? 0
  }

  private static func save(_ context: NSManagedObjectContext) throws {
    guard context.hasChanges else { return }
    do {
      try context.save()
    } catch {
      context.rollback()
      throw ProductStoreError.couldNotPersist
    }
  }
}

public struct CoreDataLocalProfileRepository: LocalProfileRepository, Sendable {
  public let store: CoreDataProductStore
  public init(store: CoreDataProductStore) { self.store = store }
  public func load() async throws -> LocalProfile? { try await store.loadActiveProfile() }
  public func save(_ profile: LocalProfile) async throws { try await store.saveProfile(profile) }
}

public struct CoreDataPracticeEventRepository: PracticeEventRepository, Sendable {
  public let store: CoreDataProductStore
  public init(store: CoreDataProductStore) { self.store = store }
  public func allEvents(profileGenerationID: UUID) async throws -> [PracticeEvent] {
    try await store.allEvents(profileGenerationID: profileGenerationID)
  }
  public func event(sessionID: UUID, profileGenerationID: UUID) async throws -> PracticeEvent? {
    try await store.event(sessionID: sessionID, profileGenerationID: profileGenerationID)
  }
  public func insertIfAbsent(_ event: PracticeEvent) async throws -> PracticeEvent {
    try await store.insertEventIfAbsent(event)
  }
  public func deleteAll(profileGenerationID: UUID) async throws {
    try await store.deleteEvents(profileGenerationID: profileGenerationID)
  }
}

public struct CoreDataGardenCustomizationRepository: GardenCustomizationRepository, Sendable {
  public let store: CoreDataProductStore
  public init(store: CoreDataProductStore) { self.store = store }
  public func load(profileGenerationID: UUID) async throws -> GardenCustomization {
    try await store.loadCustomization(profileGenerationID: profileGenerationID)
  }
  public func save(
    _ customization: GardenCustomization,
    profileGenerationID: UUID
  ) async throws {
    try await store.saveCustomization(customization, profileGenerationID: profileGenerationID)
  }
  public func deleteAll(profileGenerationID: UUID) async throws {
    try await store.deleteCustomization(profileGenerationID: profileGenerationID)
  }
}

public struct CoreDataJournalEntryRepository: JournalEntryRepository, Sendable {
  public let store: CoreDataProductStore
  public let audioDirectory: URL?

  public init(store: CoreDataProductStore, audioDirectory: URL? = nil) {
    self.store = store
    self.audioDirectory = audioDirectory
  }
  public func entries(
    profileGenerationID: UUID,
    includingDeleted: Bool
  ) async throws -> [JournalEntry] {
    let values = try await store.journalEntries(
      profileGenerationID: profileGenerationID,
      includingDeleted: includingDeleted
    )
    try await materializeAudio(for: values)
    return values
  }
  public func conflicts(profileGenerationID: UUID) async throws -> [JournalReplicaConflict] {
    let values = try await store.journalConflicts(profileGenerationID: profileGenerationID)
    try await materializeAudio(for: values.flatMap(\.variants))
    return values
  }
  public func save(
    _ entry: JournalEntry,
    expectedRevision: Int?
  ) async throws -> JournalWriteResult {
    let audioData = try audioDataForSave(entry)
    return try await store.saveJournalEntry(
      entry,
      expectedRevision: expectedRevision,
      audioData: audioData
    )
  }
  public func deleteAll(profileGenerationID: UUID) async throws {
    try await store.deleteJournalEntries(profileGenerationID: profileGenerationID)
  }

  private func audioDataForSave(_ entry: JournalEntry) throws -> Data? {
    guard let attachment = entry.audioAttachment else { return nil }
    guard let audioDirectory else { return nil }
    let url = try Self.attachmentURL(attachment, in: audioDirectory, createDirectory: false)
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw JournalAudioReplicaError.missingAttachment
    }
    let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
    guard values.isRegularFile == true, values.isSymbolicLink != true else {
      throw JournalAudioReplicaError.unsafeAttachmentPath
    }
    guard let data = try? Data(contentsOf: url, options: [.mappedIfSafe]) else {
      throw JournalAudioReplicaError.unreadableAttachment
    }
    try Self.validate(data, against: attachment)
    return data
  }

  private func materializeAudio(for entries: [JournalEntry]) async throws {
    guard let audioDirectory else { return }
    for entry in entries {
      guard let attachment = entry.audioAttachment else { continue }
      let url = try Self.attachmentURL(attachment, in: audioDirectory, createDirectory: true)
      let manager = FileManager.default
      if manager.fileExists(atPath: url.path) {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else {
          throw JournalAudioReplicaError.unsafeAttachmentPath
        }
        if let local = try? Data(contentsOf: url, options: [.mappedIfSafe]) {
          do {
            try Self.validate(local, against: attachment)
            continue
          } catch {
            // A valid replicated copy may repair this corrupt local file below.
          }
        }
      }
      guard let replicated = try await store.journalAudioData(for: entry) else {
        // Legacy metadata-only records remain readable without pretending the
        // unavailable voice bytes were restored.
        continue
      }
      try Self.validate(replicated, against: attachment)
      if manager.fileExists(atPath: url.path) {
        let values = try url.resourceValues(forKeys: [.isSymbolicLinkKey])
        guard values.isSymbolicLink != true else {
          throw JournalAudioReplicaError.unsafeAttachmentPath
        }
      }
      try replicated.write(to: url, options: .atomic)
      #if os(iOS)
        try manager.setAttributes(
          [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
          ofItemAtPath: url.path
        )
      #endif
    }
  }

  private static func attachmentURL(
    _ attachment: JournalAudioAttachment,
    in directory: URL,
    createDirectory: Bool
  ) throws -> URL {
    let root = directory.standardizedFileURL
    let manager = FileManager.default
    if manager.fileExists(atPath: root.path) {
      let values = try root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
      guard values.isDirectory == true, values.isSymbolicLink != true else {
        throw JournalAudioReplicaError.unsafeAudioDirectory
      }
    } else if createDirectory {
      try manager.createDirectory(at: root, withIntermediateDirectories: true)
    }
    let name = attachment.relativeFileName
    guard !name.isEmpty, name == URL(fileURLWithPath: name).lastPathComponent,
      !name.contains("/"), !name.contains("\\")
    else {
      throw JournalAudioReplicaError.unsafeAttachmentPath
    }
    let candidate = root.appending(path: name).standardizedFileURL
    guard candidate.deletingLastPathComponent() == root else {
      throw JournalAudioReplicaError.unsafeAttachmentPath
    }
    return candidate
  }

  private static func validate(
    _ data: Data,
    against attachment: JournalAudioAttachment
  ) throws {
    let checksum = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    guard Int64(data.count) == attachment.byteCount,
      checksum == attachment.checksumSHA256
    else {
      throw JournalAudioReplicaError.attachmentIntegrityMismatch
    }
  }
}

public struct CoreDataGuidedFavoritesRepository: GuidedFavoritesRepository, Sendable {
  public let store: CoreDataProductStore
  public init(store: CoreDataProductStore) { self.store = store }
  public func loadFavoritePracticeIDs() async throws -> Set<String> {
    try await store.loadFavoritePracticeIDs()
  }
  public func saveFavoritePracticeIDs(_ identifiers: Set<String>) async throws {
    try await store.saveFavoritePracticeIDs(identifiers)
  }
}
