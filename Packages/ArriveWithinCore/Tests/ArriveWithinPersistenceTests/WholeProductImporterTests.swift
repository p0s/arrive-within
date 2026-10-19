import ArriveWithinDomain
@testable import ArriveWithinPersistence
import ArriveWithinTestSupport
import CryptoKit
import Foundation
import Testing

@Suite("Whole-product archive restoration")
struct WholeProductImporterTests {
  @Test("A complete export restores the exact saved product snapshot and voice bytes")
  func validatesAndPreparesCompleteExport() throws {
    let archive = try makeArchive()
    let prepared = try WholeProductImporter.prepare(archive)

    #expect(prepared.profile.profileGenerationID == ArriveWithinFixtures.generationID)
    #expect(prepared.events.count == 1)
    #expect(prepared.events.first?.id == ArriveWithinFixtures.deterministicUUID(namespace: 0x30, ordinal: 1))
    #expect(prepared.customization == GardenCustomization(selectedVariantByMilestone: [1: "m01-b"]))
    #expect(prepared.favoritePracticeIDs == ["G01"])
    #expect(prepared.journalEntries.count == 1)
    #expect(prepared.journalEntries.first?.text == "A reflection included in the archive.")
    #expect(prepared.voiceFileCount == 1)
    #expect(prepared.journalAudioByEntryID.values.first == Data([0x10, 0x20, 0x30, 0x40]))
  }

  @Test("Truncated, encrypted, or damaged archives are rejected before replacement")
  func rejectsUnsupportedAndDamagedArchives() throws {
    let archive = try makeArchive()
    #expect(throws: WholeProductImportError.self) {
      try WholeProductImporter.prepare(Data([0x50, 0x4b, 0x03]))
    }

    var encrypted = archive
    encrypted[6] ^= 0x01
    #expect(throws: WholeProductImportError.self) {
      try WholeProductImporter.prepare(encrypted)
    }

    var damaged = archive
    damaged[damaged.count / 2] ^= 0x01
    #expect(throws: WholeProductImportError.self) {
      try WholeProductImporter.prepare(damaged)
    }

    let safeName = Data("favorites/practices.json".utf8)
    let unsafeName = Data((String(repeating: "../", count: 7) + "xxx").utf8)
    #expect(unsafeName.count == safeName.count)
    let firstName = try #require(archive.range(of: safeName))
    let secondName = try #require(
      archive.range(of: safeName, options: [], in: firstName.upperBound..<archive.endIndex)
    )
    let centralName = try #require(
      archive.range(of: safeName, options: [], in: secondName.upperBound..<archive.endIndex)
    )
    var pathTraversal = archive
    pathTraversal.replaceSubrange(firstName, with: unsafeName)
    pathTraversal.replaceSubrange(centralName, with: unsafeName)
    #expect(throws: WholeProductImportError.self) {
      try WholeProductImporter.prepare(pathTraversal)
    }
  }

  @Test("An imported revision at the integer ceiling is rejected")
  func rejectsRevisionOverflowBoundary() throws {
    let archive = try makeArchive()
    let rebuilt = try rebuildArchive(archive) { files, _ in
      let path = try #require(files.keys.first(where: { $0.hasSuffix("/entry.json") }))
      let entryData = try #require(files[path])
      let decodedEntry = try JSONSerialization.jsonObject(with: entryData)
      var entry = try #require(decodedEntry as? [String: Any])
      entry["revision"] = Int.max
      files[path] = try JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys])
    }

    #expect(throws: WholeProductImportError.invalidContents) {
      try WholeProductImporter.prepare(rebuilt)
    }
  }

  @Test("Two imported voice entries cannot alias one materialized filename")
  func rejectsDuplicateAudioFileNames() throws {
    let archive = try makeArchive()
    let rebuilt = try rebuildArchive(archive) { files, counts in
      let encodedProfile = try #require(files["profile/profile.json"])
      let decoder = JSONDecoder()
      decoder.dateDecodingStrategy = .iso8601
      let profile = try decoder.decode(LocalProfile.self, from: encodedProfile)
      let eventData = try #require(files["practices/events.json"])
      let events = try decoder.decode([PracticeEvent].self, from: eventData)
      let event = try #require(events.first)
      let voice = Data([0xA1, 0xB2, 0xC3, 0xD4])
      let fileName = "restore-voice.m4a"
      let checksum = SHA256.hash(data: voice).map { String(format: "%02x", $0) }.joined()
      let attachment = try JournalAudioAttachment(
        relativeFileName: fileName,
        durationMilliseconds: 1_500,
        byteCount: Int64(voice.count),
        checksumSHA256: checksum,
        recordedAt: event.endedAt
      )
      let entry = try JournalEntry(
        id: ArriveWithinFixtures.deterministicUUID(namespace: 0xA1, ordinal: 2),
        profileGenerationID: profile.profileGenerationID,
        linkedPracticeEventID: event.id,
        createdAt: event.endedAt,
        sourceInstallationID: profile.installationID,
        revision: 1,
        modifiedAt: event.endedAt,
        text: "A second voice reflection.",
        audioAttachment: attachment
      )
      let encoder = JSONEncoder()
      encoder.dateEncodingStrategy = .iso8601
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
      let directory = entry.id.uuidString.lowercased()
      files["journal/\(directory)/entry.json"] = try encoder.encode(entry)
      files["journal/\(directory)/entry.md"] = Data(markdown(for: entry).utf8)
      files["journal/\(directory)/audio/\(fileName)"] = voice
      counts["journalEntries"] = 2
      counts["voiceFiles"] = 2
    }

    #expect(throws: WholeProductImportError.invalidContents) {
      try WholeProductImporter.prepare(rebuilt)
    }
  }

  @Test("The readable event CSV must describe the same events as the canonical JSON")
  func rejectsContradictoryEventCsv() throws {
    let archive = try makeArchive()
    let rebuilt = try rebuildArchive(archive) { files, _ in
      files["practices/events.csv"] = Data("event_id\nnot-the-exported-event\n".utf8)
    }

    #expect(throws: WholeProductImportError.invalidContents) {
      try WholeProductImporter.prepare(rebuilt)
    }
  }

  @Test("A complete stored ZIP must end at its directory record")
  func rejectsTrailingArchiveBytes() throws {
    var archive = try makeArchive()
    archive.append(0)

    #expect(throws: WholeProductImportError.unsupportedArchive) {
      try WholeProductImporter.prepare(archive)
    }
  }

  private func makeArchive() throws -> Data {
    let root = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-restore-importer-\(UUID().uuidString)", directoryHint: .isDirectory)
    let audioDirectory = root.appending(path: "journal-audio", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: audioDirectory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

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
    let voice = Data([0x10, 0x20, 0x30, 0x40])
    let name = "restore-voice.m4a"
    try voice.write(to: audioDirectory.appending(path: name))
    let checksum = SHA256.hash(data: voice).map { String(format: "%02x", $0) }.joined()
    let attachment = try JournalAudioAttachment(
      relativeFileName: name,
      durationMilliseconds: 1_000,
      byteCount: Int64(voice.count),
      checksumSHA256: checksum,
      recordedAt: start
    )
    let entry = try JournalEntry(
      id: ArriveWithinFixtures.deterministicUUID(namespace: 0xA1, ordinal: 1),
      profileGenerationID: profile.profileGenerationID,
      linkedPracticeEventID: event.id,
      createdAt: start,
      sourceInstallationID: profile.installationID,
      revision: 1,
      modifiedAt: start,
      text: "A reflection included in the archive.",
      audioAttachment: attachment
    )
    let events = [event]
    let snapshot = ProductDataExportSnapshot(
      profile: profile,
      journey: JourneyReducer.reduce(events: events, profileGenerationID: profile.profileGenerationID),
      events: events,
      customization: GardenCustomization(selectedVariantByMilestone: [1: "m01-b"]),
      journalEntries: [entry],
      favoritePracticeIDs: ["G01"],
      syncStatus: .localOnly,
      exportedAt: start
    )
    let output = root.appending(path: "backup.zip")
    try WholeProductExporter.export(
      snapshot: snapshot,
      audioDirectory: audioDirectory,
      outputURL: output
    )
    return try Data(contentsOf: output)
  }

  private func rebuildArchive(
    _ archive: Data,
    mutate: (inout [String: Data], inout [String: Any]) throws -> Void
  ) throws -> Data {
    var files = try WholeProductImporter.unpackStoredArchive(archive)
    let manifestData = try #require(files["manifest.json"])
    var manifest = try #require(
      JSONSerialization.jsonObject(with: manifestData) as? [String: Any]
    )
    var counts = try #require(manifest["counts"] as? [String: Any])
    try mutate(&files, &counts)
    manifest["counts"] = counts
    manifest["files"] = files
      .filter { $0.key != "manifest.json" }
      .sorted { $0.key < $1.key }
      .map { path, bytes in
        [
          "path": path,
          "bytes": bytes.count,
          "sha256": SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(),
        ] as [String: Any]
      }
    files["manifest.json"] = try JSONSerialization.data(
      withJSONObject: manifest,
      options: [.sortedKeys]
    )
    return try StoredZipArchive(files: files.map { (name: $0.key, data: $0.value) }).data()
  }

  private func markdown(for entry: JournalEntry) -> String {
    var lines = [
      "# Arrive Within reflection",
      "",
      "- Entry ID: `\(entry.id.uuidString)`",
      "- Created: \(entry.createdAt.ISO8601Format())",
      "- Modified: \(entry.modifiedAt.ISO8601Format())",
    ]
    if let linked = entry.linkedPracticeEventID {
      lines.append("- Practice event: `\(linked.uuidString)`")
    }
    lines.append(contentsOf: ["", "## Reflection", "", entry.text])
    if let attachment = entry.audioAttachment {
      lines.append(contentsOf: [
        "",
        "## Voice reflection",
        "",
        "- File: `audio/\(attachment.relativeFileName)`",
        "- SHA-256: `\(attachment.checksumSHA256)`",
      ])
    }
    if let transcript = entry.transcript {
      lines.append(contentsOf: ["", "## On-device transcript", "", transcript.text])
    }
    lines.append("")
    return lines.joined(separator: "\n")
  }
}
