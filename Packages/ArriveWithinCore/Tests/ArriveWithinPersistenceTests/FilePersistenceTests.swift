import ArriveWithinContent
import ArriveWithinDomain
import ArriveWithinMeditation
@testable import ArriveWithinPersistence
import ArriveWithinTestSupport
import CryptoKit
import Foundation
import Testing

@Suite("Versioned local event persistence")
struct FilePersistenceTests {
  @Test("Local identity survives repository recreation")
  func profileRoundTrip() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let url = directory.appending(path: "profile.json")
    let profile = try LocalProfile(
      profileGenerationID: ArriveWithinFixtures.generationID,
      gardenID: ArriveWithinFixtures.gardenID,
      gardenSeed: 424_242,
      installationID: ArriveWithinFixtures.installationID,
      createdAt: Date(timeIntervalSince1970: 1_786_320_000),
      hasCompletedFirstUse: true
    )

    try await FileLocalProfileRepository(fileURL: url).save(profile)
    let restored = try await FileLocalProfileRepository(fileURL: url).load()

    #expect(restored == profile)
  }

  @Test("Events survive repository recreation and duplicate inserts")
  func roundTripAndDedupe() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let file = directory.appending(path: "events.json")
    defer { try? FileManager.default.removeItem(at: directory) }
    let start = Date(timeIntervalSince1970: 1_786_320_000)
    let event = try ArriveWithinFixtures.event(
      ordinal: 1,
      localDate: "2026-08-10",
      start: start
    )

    let firstRepository = FilePracticeEventRepository(fileURL: file)
    _ = try await firstRepository.insertIfAbsent(event)
    _ = try await firstRepository.insertIfAbsent(event)

    let reopened = FilePracticeEventRepository(fileURL: file)
    let events = try await reopened.allEvents(
      profileGenerationID: ArriveWithinFixtures.generationID)

    #expect(events == [event])
  }

  @Test("Deleting one generation cannot affect another")
  func generationDeletion() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let file = directory.appending(path: "events.json")
    defer { try? FileManager.default.removeItem(at: directory) }
    let start = Date(timeIntervalSince1970: 1_786_320_000)
    let oldGeneration = ArriveWithinFixtures.generationID
    let newGeneration = UUID(uuidString: "40000000-0000-4000-8000-000000000002")!
    let oldEvent = try ArriveWithinFixtures.event(
      ordinal: 1,
      localDate: "2026-08-10",
      start: start,
      generationID: oldGeneration
    )
    let newEvent = try ArriveWithinFixtures.event(
      ordinal: 2,
      localDate: "2026-08-11",
      start: start.addingTimeInterval(86_400),
      generationID: newGeneration
    )
    let repository = FilePracticeEventRepository(fileURL: file)
    _ = try await repository.insertIfAbsent(oldEvent)
    _ = try await repository.insertIfAbsent(newEvent)

    try await repository.deleteAll(profileGenerationID: oldGeneration)

    #expect(try await repository.allEvents(profileGenerationID: oldGeneration).isEmpty)
    #expect(try await repository.allEvents(profileGenerationID: newGeneration) == [newEvent])
  }

  @Test("Validated timer preferences survive repository recreation")
  func timerPreferencesRoundTrip() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let file = directory.appending(path: "meditation-preferences.json")
    defer { try? FileManager.default.removeItem(at: directory) }
    let audio = try MeditationAudioConfiguration(
      intervalBellMinutes: 5,
      ambienceID: "still-air-v1",
      ambienceVolume: 0.24,
      otherAudioPolicy: .mixWithOthers
    )
    let preferences = try TimerPreferences(
      durationMinutes: 20,
      preparation: .tenSeconds,
      audio: audio
    )

    try await FileMeditationPreferencesRepository(fileURL: file)
      .saveTimerPreferences(preferences)
    let restored = try await FileMeditationPreferencesRepository(fileURL: file)
      .loadTimerPreferences()

    #expect(restored == preferences)
  }

  @Test("Weekly reminders remain device-local, deterministic, and duplicate-safe")
  func weeklyReminderRoundTrip() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let file = directory.appending(path: "weekly-reminders.json")
    defer { try? FileManager.default.removeItem(at: directory) }
    let date = Date(timeIntervalSince1970: 1_786_320_000)
    let monday = try WeeklyReminderSchedule(
      id: UUID(uuidString: "B1000000-0000-4000-8000-000000000001")!,
      weekday: .monday,
      hour: 20,
      minute: 0,
      createdAt: date,
      modifiedAt: date
    )
    let friday = try WeeklyReminderSchedule(
      id: UUID(uuidString: "B1000000-0000-4000-8000-000000000002")!,
      weekday: .friday,
      hour: 7,
      minute: 30,
      createdAt: date,
      modifiedAt: date
    )
    let repository = FileWeeklyReminderScheduleRepository(fileURL: file)

    try await repository.saveWeeklyReminderSchedules([friday, monday])
    #expect(
      try await FileWeeklyReminderScheduleRepository(fileURL: file)
        .loadWeeklyReminderSchedules() == [monday, friday]
    )

    let duplicate = try WeeklyReminderSchedule(
      id: UUID(uuidString: "B1000000-0000-4000-8000-000000000003")!,
      weekday: .monday,
      hour: 20,
      minute: 0,
      createdAt: date,
      modifiedAt: date
    )
    await #expect(
      throws: WeeklyReminderScheduleError.duplicateLocalTime(
        weekday: .monday,
        hour: 20,
        minute: 0
      )
    ) {
      try await repository.saveWeeklyReminderSchedules([monday, duplicate])
    }

    try await repository.deleteAllWeeklyReminderSchedules()
    #expect(try await repository.loadWeeklyReminderSchedules().isEmpty)
  }

  @Test("Guided favorites remain a validated deterministic set")
  func guidedFavoritesRoundTrip() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let file = directory.appending(path: "guided-favorites.json")
    defer { try? FileManager.default.removeItem(at: directory) }
    let repository = FileGuidedFavoritesRepository(fileURL: file)

    try await repository.saveFavoritePracticeIDs(["G41", "G01", "G01"])
    let restored = try await FileGuidedFavoritesRepository(fileURL: file)
      .loadFavoritePracticeIDs()

    #expect(restored == ["G01", "G41"])
  }

  @Test("Garden customization remains generation-scoped and ownership-valid")
  func gardenCustomizationRoundTrip() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let file = directory.appending(path: "garden-customization.json")
    defer { try? FileManager.default.removeItem(at: directory) }
    let repository = FileGardenCustomizationRepository(fileURL: file)
    let otherGeneration = UUID(uuidString: "40000000-0000-4000-8000-000000000002")!

    try await repository.save(
      GardenCustomization(selectedVariantByMilestone: [1: "m01-b", 8: "m08-a"]),
      profileGenerationID: ArriveWithinFixtures.generationID
    )
    try await repository.save(
      GardenCustomization(selectedVariantByMilestone: [1: "m01-a"]),
      profileGenerationID: otherGeneration
    )

    #expect(
      try await FileGardenCustomizationRepository(fileURL: file).load(
        profileGenerationID: ArriveWithinFixtures.generationID
      ).selectedVariantByMilestone == [1: "m01-b", 8: "m08-a"]
    )
    try await repository.deleteAll(profileGenerationID: ArriveWithinFixtures.generationID)
    #expect(
      try await repository.load(profileGenerationID: ArriveWithinFixtures.generationID)
        == GardenCustomization()
    )
    #expect(
      try await repository.load(profileGenerationID: otherGeneration).selectedVariantByMilestone
        == [1: "m01-a"]
    )
  }

  @Test("Journal writes are generation-scoped, revision-checked, and tombstoned privately")
  func journalRoundTripConflictAndTombstone() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let file = directory.appending(path: "journal.json")
    defer { try? FileManager.default.removeItem(at: directory) }
    let createdAt = Date(timeIntervalSince1970: 1_786_320_000)
    let repository = FileJournalEntryRepository(fileURL: file)
    let draft = try JournalEntry(
      id: UUID(uuidString: "A1000000-0000-4000-8000-000000000001")!,
      profileGenerationID: ArriveWithinFixtures.generationID,
      linkedPracticeEventID: UUID(uuidString: "A2000000-0000-4000-8000-000000000001"),
      createdAt: createdAt,
      sourceInstallationID: ArriveWithinFixtures.installationID,
      modifiedAt: createdAt,
      text: "The breath felt spacious.",
      textLocaleIdentifier: "en-US"
    )

    guard case .saved(let first) = try await repository.save(draft, expectedRevision: nil)
    else {
      Issue.record("The initial journal entry was not saved.")
      return
    }
    #expect(first.revision == 1)

    let edited = try first.replacingContent(
      text: "The breath felt spacious and steady.",
      textLocaleIdentifier: "en-US",
      audioAttachment: nil,
      transcript: nil,
      transcriptionState: .notRequested,
      modifiedAt: createdAt.addingTimeInterval(60)
    )
    guard case .saved(let second) = try await repository.save(
      edited,
      expectedRevision: first.revision
    ) else {
      Issue.record("The journal edit was not saved.")
      return
    }
    #expect(second.revision == 2)

    let stale = try first.replacingContent(
      text: "A stale edit that must not overwrite newer text.",
      textLocaleIdentifier: "en-US",
      audioAttachment: nil,
      transcript: nil,
      transcriptionState: .notRequested,
      modifiedAt: createdAt.addingTimeInterval(120)
    )
    guard case .conflict(let current, let attempted) = try await repository.save(
      stale,
      expectedRevision: first.revision
    ) else {
      Issue.record("A stale edit overwrote the current journal entry.")
      return
    }
    #expect(current == second)
    #expect(attempted.text.hasPrefix("A stale edit"))

    let tombstone = try second.tombstoned(at: createdAt.addingTimeInterval(180))
    guard case .saved(let deleted) = try await repository.save(
      tombstone,
      expectedRevision: second.revision
    ) else {
      Issue.record("The journal tombstone was not saved.")
      return
    }
    #expect(deleted.isDeleted)
    #expect(deleted.text.isEmpty)
    #expect(
      try await FileJournalEntryRepository(fileURL: file).entries(
        profileGenerationID: ArriveWithinFixtures.generationID,
        includingDeleted: false
      ).isEmpty
    )
    #expect(
      try await repository.entries(
        profileGenerationID: ArriveWithinFixtures.generationID,
        includingDeleted: true
      ) == [deleted]
    )
  }

  @Test("A journal entry exports as a deterministic user-readable ZIP")
  func journalEntryExport() throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let output = directory.appending(path: "reflection.zip")
    defer { try? FileManager.default.removeItem(at: directory) }
    let createdAt = Date(timeIntervalSince1970: 1_786_320_000)
    let entry = try JournalEntry(
      id: UUID(uuidString: "A1000000-0000-4000-8000-000000000002")!,
      profileGenerationID: ArriveWithinFixtures.generationID,
      createdAt: createdAt,
      sourceInstallationID: ArriveWithinFixtures.installationID,
      revision: 2,
      modifiedAt: createdAt.addingTimeInterval(60),
      text: "A quiet, user-readable note.",
      textLocaleIdentifier: "en-US"
    )

    try JournalEntryExporter.export(
      entry: entry,
      audioDirectory: directory.appending(path: "audio"),
      outputURL: output
    )
    let archive = try Data(contentsOf: output)

    #expect(archive.starts(with: [0x50, 0x4B, 0x03, 0x04]))
    #expect(archive.range(of: Data("entry.md".utf8)) != nil)
    #expect(archive.range(of: Data("entry.json".utf8)) != nil)
    #expect(archive.range(of: Data("manifest.json".utf8)) != nil)
    #expect(archive.range(of: Data("A quiet, user-readable note.".utf8)) != nil)
    #expect(archive.suffix(22).starts(with: [0x50, 0x4B, 0x05, 0x06]))

    #if os(macOS)
      let validator = Process()
      validator.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
      validator.arguments = ["-t", output.path]
      validator.standardOutput = FileHandle.nullDevice
      validator.standardError = FileHandle.nullDevice
      try validator.run()
      validator.waitUntilExit()
      #expect(validator.terminationStatus == 0)
    #endif
  }

  @Test("Journal export rejects a symlinked voice file")
  func journalEntryExportRejectsSymlink() throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-export-symlink-\(UUID().uuidString)", directoryHint: .isDirectory)
    let audioDirectory = directory.appending(path: "audio", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: audioDirectory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let external = directory.appending(path: "private.m4a")
    let bytes = Data([0x01, 0x02, 0x03, 0x04])
    try bytes.write(to: external)
    let audioName = "reflection.m4a"
    try FileManager.default.createSymbolicLink(
      at: audioDirectory.appending(path: audioName),
      withDestinationURL: external
    )
    let date = Date(timeIntervalSince1970: 1_786_320_000)
    let attachment = try JournalAudioAttachment(
      relativeFileName: audioName,
      durationMilliseconds: 1_000,
      byteCount: Int64(bytes.count),
      checksumSHA256: SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(),
      recordedAt: date
    )
    let entry = try JournalEntry(
      id: UUID(),
      profileGenerationID: ArriveWithinFixtures.generationID,
      createdAt: date,
      sourceInstallationID: ArriveWithinFixtures.installationID,
      modifiedAt: date,
      text: "Voice export",
      audioAttachment: attachment
    )
    #expect(throws: JournalExportError.unsafeAudioPath) {
      try JournalEntryExporter.export(
        entry: entry,
        audioDirectory: audioDirectory,
        outputURL: directory.appending(path: "reflection.zip")
      )
    }
  }

  @Test("The production Core Data model is local-first, idempotent, and reset-safe")
  func coreDataStoreRoundTripResetAndDeletion() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-coredata-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try CoreDataProductStore(
      configuration: ProductStoreConfiguration(
        storeURL: directory.appending(path: "product-v1.sqlite")
      )
    )
    let profileRepository = CoreDataLocalProfileRepository(store: store)
    let eventRepository = CoreDataPracticeEventRepository(store: store)
    let customizationRepository = CoreDataGardenCustomizationRepository(store: store)
    let journalRepository = CoreDataJournalEntryRepository(store: store)
    let favoritesRepository = CoreDataGuidedFavoritesRepository(store: store)
    let start = Date(timeIntervalSince1970: 1_786_320_000)
    let profile = try LocalProfile(
      profileGenerationID: ArriveWithinFixtures.generationID,
      gardenID: ArriveWithinFixtures.gardenID,
      gardenSeed: 424_242,
      installationID: ArriveWithinFixtures.installationID,
      createdAt: start,
      hasCompletedFirstUse: true
    )
    let event = try ArriveWithinFixtures.event(
      ordinal: 1,
      localDate: "2026-08-10",
      start: start
    )
    let journal = try JournalEntry(
      id: UUID(uuidString: "A1000000-0000-4000-8000-000000000003")!,
      profileGenerationID: profile.profileGenerationID,
      linkedPracticeEventID: event.id,
      createdAt: start,
      sourceInstallationID: profile.installationID,
      modifiedAt: start,
      text: "This old generation must not return after reset.",
      textLocaleIdentifier: "en-US"
    )

    try await profileRepository.save(profile)
    _ = try await eventRepository.insertIfAbsent(event)
    _ = try await eventRepository.insertIfAbsent(event)
    try await customizationRepository.save(
      GardenCustomization(selectedVariantByMilestone: [1: "m01-b"]),
      profileGenerationID: profile.profileGenerationID
    )
    guard case .saved(let savedJournal) = try await journalRepository.save(
      journal,
      expectedRevision: nil
    ) else {
      Issue.record("The Core Data journal insert did not save.")
      return
    }
    try await favoritesRepository.saveFavoritePracticeIDs(["G01", "G41"])

    #expect(try await profileRepository.load() == profile)
    #expect(try await eventRepository.allEvents(profileGenerationID: profile.profileGenerationID) == [event])
    #expect(savedJournal.revision == 1)
    #expect(try await favoritesRepository.loadFavoritePracticeIDs() == ["G01", "G41"])
    #expect(await store.syncStatus() == .localOnly)
    #expect(
      try await store.counts()
        == ProductDataCounts(
          profileGenerations: 1,
          practiceEvents: 1,
          journalEntries: 1,
          favoritePractices: 2,
          customizations: 1
        )
    )

    let reopenedStore = try CoreDataProductStore(
      configuration: ProductStoreConfiguration(
        storeURL: directory.appending(path: "product-v1.sqlite")
      )
    )
    #expect(try await reopenedStore.loadActiveProfile() == profile)
    #expect(
      try await reopenedStore.allEvents(
        profileGenerationID: profile.profileGenerationID
      ) == [event]
    )
    #expect(
      try await reopenedStore.journalEntries(
        profileGenerationID: profile.profileGenerationID,
        includingDeleted: false
      ) == [savedJournal]
    )

    let newGenerationID = UUID(uuidString: "40000000-0000-4000-8000-000000000002")!
    let resetAt = start.addingTimeInterval(3_600)
    let reset = try profile.resetting(
      profileGenerationID: newGenerationID,
      gardenID: UUID(uuidString: "50000000-0000-4000-8000-000000000002")!,
      gardenSeed: 987_654,
      at: resetAt
    )
    try await store.resetProfile(from: profile, to: reset)

    #expect(try await profileRepository.load() == reset)
    #expect(try await eventRepository.allEvents(profileGenerationID: profile.profileGenerationID).isEmpty)
    #expect(
      try await journalRepository.entries(
        profileGenerationID: profile.profileGenerationID,
        includingDeleted: true
      ).isEmpty
    )
    #expect(
      try await customizationRepository.load(profileGenerationID: profile.profileGenerationID)
        == GardenCustomization()
    )
    #expect(try await favoritesRepository.loadFavoritePracticeIDs() == ["G01", "G41"])

    // A late record from an old offline generation may arrive, but the active
    // profile and all projections remain bound to the new generation.
    _ = try await eventRepository.insertIfAbsent(event)
    #expect(try await eventRepository.allEvents(profileGenerationID: reset.profileGenerationID).isEmpty)
    #expect(try await profileRepository.load()?.profileGenerationID == reset.profileGenerationID)

    try await store.deleteAllProductRecords()
    #expect(try await profileRepository.load() == nil)
    #expect(
      try await store.counts()
        == ProductDataCounts(
          profileGenerations: 0,
          practiceEvents: 0,
          journalEntries: 0,
          favoritePractices: 0,
          customizations: 0
        )
    )
  }

  @Test("Complete data export is deterministic, readable, and includes verified voice files")
  func completeDataExport() throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let audioDirectory = directory.appending(path: "journal-audio", directoryHint: .isDirectory)
    let firstOutput = directory.appending(path: "complete-a.zip")
    let secondOutput = directory.appending(path: "complete-b.zip")
    try FileManager.default.createDirectory(at: audioDirectory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let start = Date(timeIntervalSince1970: 1_786_320_000)
    let profile = try LocalProfile(
      profileGenerationID: ArriveWithinFixtures.generationID,
      gardenID: ArriveWithinFixtures.gardenID,
      gardenSeed: 424_242,
      installationID: ArriveWithinFixtures.installationID,
      createdAt: start,
      hasCompletedFirstUse: true
    )
    let event = try ArriveWithinFixtures.event(
      ordinal: 1,
      localDate: "2026-08-10",
      start: start
    )
    let audio = Data([0x00, 0x11, 0x22, 0x33, 0x44, 0x55])
    let audioName = "A1000000-0000-4000-8000-000000000004.m4a"
    try audio.write(to: audioDirectory.appending(path: audioName))
    let checksum = SHA256.hash(data: audio).map { String(format: "%02x", $0) }.joined()
    let attachment = try JournalAudioAttachment(
      relativeFileName: audioName,
      durationMilliseconds: 1_000,
      byteCount: Int64(audio.count),
      checksumSHA256: checksum,
      recordedAt: start
    )
    let entry = try JournalEntry(
      id: UUID(uuidString: "A1000000-0000-4000-8000-000000000004")!,
      profileGenerationID: profile.profileGenerationID,
      linkedPracticeEventID: event.id,
      createdAt: start,
      sourceInstallationID: profile.installationID,
      revision: 1,
      modifiedAt: start,
      text: "A reflection included in the complete archive.",
      textLocaleIdentifier: "en-US",
      audioAttachment: attachment
    )
    let snapshot = ProductDataExportSnapshot(
      profile: profile,
      journey: JourneyReducer.reduce(
        events: [event],
        profileGenerationID: profile.profileGenerationID
      ),
      events: [event],
      customization: GardenCustomization(selectedVariantByMilestone: [1: "m01-b"]),
      journalEntries: [entry],
      favoritePracticeIDs: ["G01"],
      syncStatus: .localOnly,
      exportedAt: start
    )

    try WholeProductExporter.export(
      snapshot: snapshot,
      audioDirectory: audioDirectory,
      outputURL: firstOutput
    )
    try WholeProductExporter.export(
      snapshot: snapshot,
      audioDirectory: audioDirectory,
      outputURL: secondOutput
    )
    let archive = try Data(contentsOf: firstOutput)
    let secondArchive = try Data(contentsOf: secondOutput)

    #expect(archive == secondArchive)
    #expect(archive.range(of: Data("manifest.json".utf8)) != nil)
    #expect(archive.range(of: Data("practices/events.csv".utf8)) != nil)
    #expect(archive.range(of: Data("journal/a1000000-0000-4000-8000-000000000004/entry.md".utf8)) != nil)
    #expect(archive.range(of: Data(audioName.utf8)) != nil)
    #expect(archive.range(of: Data("complete-user-readable-data".utf8)) != nil)

    #if os(macOS)
      let validator = Process()
      validator.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
      validator.arguments = ["-t", firstOutput.path]
      validator.standardOutput = FileHandle.nullDevice
      validator.standardError = FileHandle.nullDevice
      try validator.run()
      validator.waitUntilExit()
      #expect(validator.terminationStatus == 0)
    #endif
  }

  @Test("Concurrent CloudKit-style journal revisions remain preserved until explicit resolution")
  func immutableJournalReplicaConflictResolution() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-journal-replicas-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try CoreDataProductStore(
      configuration: ProductStoreConfiguration(
        storeURL: directory.appending(path: "product-v1.sqlite")
      )
    )
    let repository = CoreDataJournalEntryRepository(store: store)
    let start = Date(timeIntervalSince1970: 1_786_320_000)
    let entry = try JournalEntry(
      id: UUID(uuidString: "A1000000-0000-4000-8000-000000000006")!,
      profileGenerationID: ArriveWithinFixtures.generationID,
      createdAt: start,
      sourceInstallationID: ArriveWithinFixtures.installationID,
      modifiedAt: start,
      text: "Original private reflection.",
      textLocaleIdentifier: "en-US"
    )
    guard case .saved(let revisionOne) = try await repository.save(
      entry,
      expectedRevision: nil
    ) else {
      Issue.record("Initial immutable journal revision did not save.")
      return
    }
    let localCandidate = try revisionOne.replacingContent(
      text: "Edit from the first offline device.",
      textLocaleIdentifier: "en-US",
      audioAttachment: nil,
      transcript: nil,
      transcriptionState: .notRequested,
      modifiedAt: start.addingTimeInterval(60)
    )
    guard case .saved(let localRevisionTwo) = try await repository.save(
      localCandidate,
      expectedRevision: 1
    ) else {
      Issue.record("Local second revision did not save.")
      return
    }
    let remoteRevisionTwo = try revisionOne.replacingContent(
      text: "Different edit from the second offline device.",
      textLocaleIdentifier: "en-US",
      audioAttachment: nil,
      transcript: nil,
      transcriptionState: .notRequested,
      modifiedAt: start.addingTimeInterval(120)
    ).persisted(revision: 2)
    try await store.preserveJournalReplica(remoteRevisionTwo)
    try await store.preserveJournalReplica(remoteRevisionTwo)

    let conflicts = try await repository.conflicts(
      profileGenerationID: entry.profileGenerationID
    )
    #expect(conflicts.count == 1)
    #expect(conflicts.first?.revision == 2)
    #expect(conflicts.first?.variants.count == 2)
    #expect(
      try await repository.entries(
        profileGenerationID: entry.profileGenerationID,
        includingDeleted: false
      ).first?.text == remoteRevisionTwo.text
    )
    #expect(try await store.counts().journalEntries == 1)
    #expect(try await store.counts().journalConflicts == 1)

    guard case .saved(let resolved) = try await repository.save(
      localRevisionTwo,
      expectedRevision: 2
    ) else {
      Issue.record("Explicit conflict resolution did not create a later revision.")
      return
    }
    #expect(resolved.revision == 3)
    #expect(resolved.text == localRevisionTwo.text)
    #expect(
      try await repository.conflicts(profileGenerationID: entry.profileGenerationID).isEmpty
    )
    #expect(
      try await repository.entries(
        profileGenerationID: entry.profileGenerationID,
        includingDeleted: false
      ) == [resolved]
    )
  }

  @Test("Whole-product controls export, reset, and delete without old-generation resurrection")
  func productDataControls() async throws {
    let parent = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-controls-\(UUID().uuidString)", directoryHint: .isDirectory)
    let root = parent.appending(path: "ArriveWithin", directoryHint: .isDirectory)
    let audioDirectory = root.appending(path: "journal-audio", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: audioDirectory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: parent) }
    let store = try CoreDataProductStore(
      configuration: ProductStoreConfiguration(
        storeURL: root.appending(path: "product-v1.sqlite")
      )
    )
    let controls = try ProductDataController(store: store, dataDirectory: root)
    let profileRepository = CoreDataLocalProfileRepository(store: store)
    let eventRepository = CoreDataPracticeEventRepository(store: store)
    let journalRepository = CoreDataJournalEntryRepository(store: store)
    let start = Date(timeIntervalSince1970: 1_786_320_000)
    let profile = try LocalProfile(
      profileGenerationID: ArriveWithinFixtures.generationID,
      gardenID: ArriveWithinFixtures.gardenID,
      gardenSeed: 424_242,
      installationID: ArriveWithinFixtures.installationID,
      createdAt: start,
      hasCompletedFirstUse: true
    )
    let event = try ArriveWithinFixtures.event(
      ordinal: 1,
      localDate: "2026-08-10",
      start: start
    )
    let audio = Data([0x10, 0x20, 0x30, 0x40])
    let audioName = "journal-reset-proof.m4a"
    try audio.write(to: audioDirectory.appending(path: audioName))
    let checksum = SHA256.hash(data: audio).map { String(format: "%02x", $0) }.joined()
    let attachment = try JournalAudioAttachment(
      relativeFileName: audioName,
      durationMilliseconds: 1_000,
      byteCount: Int64(audio.count),
      checksumSHA256: checksum,
      recordedAt: start
    )
    let entry = try JournalEntry(
      id: UUID(uuidString: "A1000000-0000-4000-8000-000000000005")!,
      profileGenerationID: profile.profileGenerationID,
      createdAt: start,
      sourceInstallationID: profile.installationID,
      modifiedAt: start,
      text: "Reset removes this private reflection.",
      audioAttachment: attachment
    )
    try await profileRepository.save(profile)
    _ = try await eventRepository.insertIfAbsent(event)
    _ = try await journalRepository.save(entry, expectedRevision: nil)
    try Data("session".utf8).write(to: root.appending(path: "session-state-v1.json"))
    try Data("preferences".utf8).write(
      to: root.appending(path: "meditation-preferences-v1.json")
    )

    let export = try await controls.exportAll(profile: profile, at: start)
    #expect(FileManager.default.fileExists(atPath: export.path))
    #expect(try await controls.counts().practiceEvents == 1)

    let reset = try await controls.resetGarden(
      profile: profile,
      newProfileGenerationID: UUID(uuidString: "40000000-0000-4000-8000-000000000003")!,
      newGardenID: UUID(uuidString: "50000000-0000-4000-8000-000000000003")!,
      newGardenSeed: 111_222,
      at: start.addingTimeInterval(3_600)
    )
    #expect(!reset.cleanupPending)
    #expect(reset.profile.previousProfileGenerationID == profile.profileGenerationID)
    #expect(!FileManager.default.fileExists(atPath: audioDirectory.appending(path: audioName).path))
    #expect(!FileManager.default.fileExists(atPath: export.path))
    #expect(!FileManager.default.fileExists(atPath: root.appending(path: "session-state-v1.json").path))
    #expect(FileManager.default.fileExists(atPath: root.appending(path: "meditation-preferences-v1.json").path))
    #expect(try await eventRepository.allEvents(profileGenerationID: profile.profileGenerationID).isEmpty)

    let obsoleteMarker = root.appending(path: "deletion-state-v1.json")
    try Data(
      #"{"schemaVersion":1,"state":"pendingPrivateCloudConfirmation","requestedAt":0}"#.utf8
    ).write(to: obsoleteMarker)
    let markerWasPending = await controls.hasPendingPrivateCloudDeletion()
    #expect(markerWasPending)
    await controls.discardObsoleteCloudDeletionMarkerForLocalStore()
    let markerRemainsPending = await controls.hasPendingPrivateCloudDeletion()
    #expect(!markerRemainsPending)
    #expect(!FileManager.default.fileExists(atPath: obsoleteMarker.path))

    let deletion = try await controls.deleteAllData()
    #expect(deletion == .localDeletionComplete)
    #expect(try await profileRepository.load() == nil)
    #expect(try await controls.counts().practiceEvents == 0)
    #expect(!FileManager.default.fileExists(atPath: export.path))
    #expect(!FileManager.default.fileExists(atPath: root.appending(path: "meditation-preferences-v1.json").path))
  }

  @Test("Baseline build 1 data upgrades deterministically to selected build 7")
  func baselineBuildOneUpgradeToSelectedBuildSeven() async throws {
    let expectedHashes = [
      "app-settings-v1.json":
        "b7e313cdd744bbe52657fa8b184ca006bf6e19fead7259bd72d9ad8abcf2eb8f",
      "deletion-state-v1.json":
        "b0c3c42a6c9f687f258c2fe233a01388b8d0508ded533fd76aab61ed78b5f95a",
      "meditation-preferences-v1.json":
        "712701704673c8b9b71769853038aa1d1ff5864f8b0aad1c1acd09611e8ffd52",
      "product-v1.sqlite":
        "426940e2e9e30de4b07e8261fa6ce0ef72126fb7b1d2fdab60d77dfeb6a2f7d1",
      "session-state-v1.json":
        "c5e3e746df2359335692c12099970070b414fc4ac779753c8eb6bfeec7aee707",
      "weekly-reminders-v1.json":
        "21fc734e4ec1aeb73fda54a1a099b10eaffdde434c4b9ca693dd8c79d4987efa",
    ]
    let fixture = try #require(Bundle.module.resourceURL)
      .appending(path: "Fixtures/baseline-build-1", directoryHint: .isDirectory)
    for (name, hash) in expectedHashes {
      #expect(try sha256(of: fixture.appending(path: name)) == hash)
    }

    let parent = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-build1-upgrade-\(UUID().uuidString)", directoryHint: .isDirectory)
    let root = parent.appending(path: "ArriveWithin", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: parent) }
    try FileManager.default.copyItem(at: fixture, to: root)

    let profileID = UUID(uuidString: "40000000-0000-4000-8000-000000000001")!
    let eventID = UUID(uuidString: "70000000-0000-4000-8000-000000000001")!
    let sessionID = UUID(uuidString: "80000000-0000-4000-8000-000000000001")!
    let journalID = UUID(uuidString: "90000000-0000-4000-8000-000000000001")!
    let store = try CoreDataProductStore(
      configuration: ProductStoreConfiguration(
        storeURL: root.appending(path: "product-v1.sqlite")
      )
    )
    let profile = try #require(try await store.loadActiveProfile())
    let events = try await store.allEvents(profileGenerationID: profileID)
    let journal = try await store.allJournalEntries(includingDeleted: true)
    let projection = JourneyReducer.reduce(events: events, profileGenerationID: profileID)

    #expect(profile.profileGenerationID == profileID)
    #expect(profile.gardenSeed == 424_242)
    #expect(events.map(\.id) == [eventID])
    #expect(events.first?.sessionID == sessionID)
    #expect(projection.journeyDay == 1)
    #expect(projection.statistics.qualifyingSessions == 1)
    #expect(
      try await store.loadCustomization(profileGenerationID: profileID)
        == GardenCustomization(selectedVariantByMilestone: [1: "m01-b"])
    )
    #expect(try await store.loadFavoritePracticeIDs() == ["G01", "G41"])
    #expect(journal.map(\.id) == [journalID])
    #expect(journal.first?.text == "A synthetic baseline reflection.")
    #expect(
      try await store.counts()
        == ProductDataCounts(
          profileGenerations: 1,
          practiceEvents: 1,
          journalEntries: 1,
          favoritePractices: 2,
          customizations: 1
        )
    )

    let preferences = try await FileMeditationPreferencesRepository(
      fileURL: root.appending(path: "meditation-preferences-v1.json")
    ).loadTimerPreferences()
    #expect(preferences.durationMinutes == 20)
    #expect(preferences.preparation == .tenSeconds)
    #expect(preferences.audio.ambienceID == "still-air-v1")
    #expect(
      try await FileMeditationSessionRepository(
        fileURL: root.appending(path: "session-state-v1.json")
      ).activeSession(profileGenerationID: profileID)?.id == sessionID
    )
    #expect(
      try await FileWeeklyReminderScheduleRepository(
        fileURL: root.appending(path: "weekly-reminders-v1.json")
      ).loadWeeklyReminderSchedules().first?.weekday == .monday
    )
    #expect(
      try sha256(of: root.appending(path: "app-settings-v1.json"))
        == expectedHashes["app-settings-v1.json"]
    )

    let duplicate = try #require(events.first)
    #expect(try await store.insertEventIfAbsent(duplicate) == duplicate)
    #expect(try await store.allEvents(profileGenerationID: profileID).count == 1)

    let controls = try ProductDataController(store: store, dataDirectory: root)
    #expect(await controls.hasPendingPrivateCloudDeletion())
    await controls.discardObsoleteCloudDeletionMarkerForLocalStore()
    let markerStillPending = await controls.hasPendingPrivateCloudDeletion()
    #expect(!markerStillPending)
    #expect(!FileManager.default.fileExists(atPath: root.appending(path: "deletion-state-v1.json").path))

    for name in [
      "app-settings-v1.json",
      "meditation-preferences-v1.json",
      "session-state-v1.json",
      "weekly-reminders-v1.json",
    ] {
      #expect(try sha256(of: root.appending(path: name)) == expectedHashes[name])
    }

    let reopened = try CoreDataProductStore(
      configuration: ProductStoreConfiguration(
        storeURL: root.appending(path: "product-v1.sqlite")
      )
    )
    #expect(try await reopened.loadActiveProfile() == profile)
    #expect(try await reopened.allEvents(profileGenerationID: profileID) == events)
    #expect(try await reopened.allJournalEntries(includingDeleted: true) == journal)
    #expect(try await reopened.loadFavoritePracticeIDs() == ["G01", "G41"])
  }

  private func sha256(of url: URL) throws -> String {
    SHA256.hash(data: try Data(contentsOf: url))
      .map { String(format: "%02x", $0) }
      .joined()
  }

  @Test("Journal voice bytes replicate safely, repair local loss, and are scrubbed by deletion")
  func journalVoiceAssetReplicaLifecycle() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-audio-replica-\(UUID().uuidString)", directoryHint: .isDirectory)
    let audioDirectory = directory.appending(path: "journal-audio", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: audioDirectory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try CoreDataProductStore(
      configuration: ProductStoreConfiguration(
        storeURL: directory.appending(path: "product-v1.sqlite")
      )
    )
    let repository = CoreDataJournalEntryRepository(
      store: store,
      audioDirectory: audioDirectory
    )
    let audio = Data((0..<8_192).map { UInt8($0 % 251) })
    let checksum = SHA256.hash(data: audio).map { String(format: "%02x", $0) }.joined()
    let fileName = "journal-cloud-asset.m4a"
    let file = audioDirectory.appending(path: fileName)
    try audio.write(to: file)
    let start = Date(timeIntervalSince1970: 1_786_320_000)
    let attachment = try JournalAudioAttachment(
      relativeFileName: fileName,
      durationMilliseconds: 2_000,
      byteCount: Int64(audio.count),
      checksumSHA256: checksum,
      recordedAt: start
    )
    let entry = try JournalEntry(
      id: UUID(uuidString: "A1000000-0000-4000-8000-000000000007")!,
      profileGenerationID: ArriveWithinFixtures.generationID,
      createdAt: start,
      sourceInstallationID: ArriveWithinFixtures.installationID,
      modifiedAt: start,
      text: "Voice bytes stay private and recoverable.",
      textLocaleIdentifier: "en-US",
      audioAttachment: attachment
    )
    guard case .saved(let saved) = try await repository.save(entry, expectedRevision: nil) else {
      Issue.record("Voice-backed journal entry did not save.")
      return
    }
    #expect(try await store.journalAudioData(for: saved) == audio)

    try FileManager.default.removeItem(at: file)
    #expect(!FileManager.default.fileExists(atPath: file.path))
    #expect(
      try await repository.entries(
        profileGenerationID: entry.profileGenerationID,
        includingDeleted: false
      ) == [saved]
    )
    #expect(try Data(contentsOf: file) == audio)

    try Data("corrupt".utf8).write(to: file, options: .atomic)
    _ = try await repository.entries(
      profileGenerationID: entry.profileGenerationID,
      includingDeleted: false
    )
    #expect(try Data(contentsOf: file) == audio)

    let tombstone = try saved.tombstoned(at: start.addingTimeInterval(60))
    guard case .saved(let deleted) = try await repository.save(
      tombstone,
      expectedRevision: saved.revision
    ) else {
      Issue.record("Voice-backed journal tombstone did not save.")
      return
    }
    #expect(try await store.journalAudioData(for: saved) == nil)
    #expect(try await store.journalAudioData(for: deleted) == nil)
    #expect(
      try await repository.entries(
        profileGenerationID: entry.profileGenerationID,
        includingDeleted: false
      ).isEmpty
    )
  }

  @Test("Sync-state truth distinguishes local, active, unavailable, and quota states")
  func productSyncStateTruth() {
    for signal in [
      ProductSyncSignal.accountAvailable,
      .operationStarted,
      .operationSucceeded,
      .offline,
      .noICloudAccount,
      .restricted,
      .quotaFull,
      .temporarilyUnavailable,
      .error,
    ] {
      #expect(
        ProductSyncStateReducer.reduce(
          current: .localOnly,
          signal: signal,
          cloudBacked: false
        ) == .localOnly
      )
    }

    var state = ProductSyncStateReducer.reduce(
      current: .available,
      signal: .operationStarted,
      cloudBacked: true
    )
    #expect(state == .syncing)
    state = ProductSyncStateReducer.reduce(
      current: state,
      signal: .operationSucceeded,
      cloudBacked: true
    )
    #expect(state == .upToDate)
    #expect(
      ProductSyncStateReducer.reduce(
        current: state,
        signal: .accountAvailable,
        cloudBacked: true
      ) == .upToDate
    )
    #expect(
      ProductSyncStateReducer.reduce(
        current: state,
        signal: .quotaFull,
        cloudBacked: true
      ) == .quotaFull
    )
  }
}
