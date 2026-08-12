import ArriveWithinDomain
import CryptoKit
import Foundation

public struct ProductDataExportSnapshot: Sendable {
  public let profile: LocalProfile
  public let journey: JourneyProjection
  public let events: [PracticeEvent]
  public let customization: GardenCustomization
  public let journalEntries: [JournalEntry]
  public let favoritePracticeIDs: Set<String>
  public let syncStatus: ProductSyncStatus
  public let exportedAt: Date

  public init(
    profile: LocalProfile,
    journey: JourneyProjection,
    events: [PracticeEvent],
    customization: GardenCustomization,
    journalEntries: [JournalEntry],
    favoritePracticeIDs: Set<String>,
    syncStatus: ProductSyncStatus,
    exportedAt: Date
  ) {
    self.profile = profile
    self.journey = journey
    self.events = events
    self.customization = customization
    self.journalEntries = journalEntries
    self.favoritePracticeIDs = favoritePracticeIDs
    self.syncStatus = syncStatus
    self.exportedAt = exportedAt
  }
}

public enum ProductDataExportError: Error, Equatable, Sendable {
  case deletedJournalEntry
  case audioMissing
  case audioIntegrityMismatch
  case unsafeAudioPath
  case archiveFailed
}

public enum WholeProductExporter {
  private struct Manifest: Codable {
    struct Counts: Codable {
      let practices: Int
      let journalEntries: Int
      let voiceFiles: Int
      let favoritePractices: Int
    }

    struct FileRecord: Codable {
      let path: String
      let bytes: Int
      let sha256: String
    }

    let schemaVersion: Int
    let product: String
    let exportType: String
    let profileGenerationID: UUID
    let exportedAt: Date
    let syncStatusAtExport: ProductSyncStatus
    let identifiersAndTimestampsAreLocalizationIndependent: Bool
    let counts: Counts
    let files: [FileRecord]
  }

  public static func export(
    snapshot: ProductDataExportSnapshot,
    audioDirectory: URL,
    outputURL: URL,
    fileManager: FileManager = .default
  ) throws {
    var files: [(name: String, data: Data)] = []
    let encoder = makeEncoder()
    files.append(("profile/profile.json", try encoder.encode(snapshot.profile)))
    files.append(("journey/summary.json", try encoder.encode(snapshot.journey)))
    files.append(("practices/events.json", try encoder.encode(snapshot.events)))
    files.append(("practices/events.csv", Data(eventsCSV(snapshot.events).utf8)))
    files.append(("garden/customization.json", try encoder.encode(snapshot.customization)))
    files.append(
      (
        "favorites/practices.json",
        try encoder.encode(snapshot.favoritePracticeIDs.sorted())
      )
    )

    var voiceFileCount = 0
    for entry in snapshot.journalEntries.sorted(by: { $0.id.uuidString < $1.id.uuidString }) {
      guard !entry.isDeleted else { throw ProductDataExportError.deletedJournalEntry }
      let prefix = "journal/\(entry.id.uuidString.lowercased())"
      files.append(("\(prefix)/entry.json", try encoder.encode(entry)))
      files.append(("\(prefix)/entry.md", Data(markdown(for: entry).utf8)))
      if let attachment = entry.audioAttachment {
        let audioURL = audioDirectory.appending(path: attachment.relativeFileName)
        let root = audioDirectory.standardizedFileURL
        let candidate = audioURL.standardizedFileURL
        guard root.isFileURL, root.path != "/",
          attachment.relativeFileName
            == URL(fileURLWithPath: attachment.relativeFileName).lastPathComponent,
          candidate.deletingLastPathComponent().path == root.path
        else {
          throw ProductDataExportError.unsafeAudioPath
        }
        let rootValues = try root.resourceValues(
          forKeys: [.isDirectoryKey, .isSymbolicLinkKey]
        )
        let values = try candidate.resourceValues(
          forKeys: [.isRegularFileKey, .isSymbolicLinkKey]
        )
        guard rootValues.isDirectory == true, rootValues.isSymbolicLink != true,
          values.isRegularFile == true, values.isSymbolicLink != true,
          candidate.resolvingSymlinksInPath().standardizedFileURL.path == candidate.path
        else {
          throw ProductDataExportError.unsafeAudioPath
        }
        let audio = try Data(contentsOf: candidate)
        guard
          Int64(audio.count) == attachment.byteCount,
          sha256(audio) == attachment.checksumSHA256
        else {
          throw ProductDataExportError.audioIntegrityMismatch
        }
        files.append(("\(prefix)/audio/\(attachment.relativeFileName)", audio))
        voiceFileCount += 1
      }
    }

    let fileRecords = files.sorted(by: { $0.name < $1.name }).map {
      Manifest.FileRecord(path: $0.name, bytes: $0.data.count, sha256: sha256($0.data))
    }
    let manifest = Manifest(
      schemaVersion: 1,
      product: "Arrive Within",
      exportType: "complete-user-readable-data",
      profileGenerationID: snapshot.profile.profileGenerationID,
      exportedAt: snapshot.exportedAt,
      syncStatusAtExport: snapshot.syncStatus,
      identifiersAndTimestampsAreLocalizationIndependent: true,
      counts: Manifest.Counts(
        practices: snapshot.events.count,
        journalEntries: snapshot.journalEntries.count,
        voiceFiles: voiceFileCount,
        favoritePractices: snapshot.favoritePracticeIDs.count
      ),
      files: fileRecords
    )
    files.append(("manifest.json", try encoder.encode(manifest)))

    let archive: Data
    do {
      archive = try StoredZipArchive(files: files).data()
    } catch {
      throw ProductDataExportError.archiveFailed
    }
    try fileManager.createDirectory(
      at: outputURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try archive.write(to: outputURL, options: .atomic)
    #if os(iOS)
      try fileManager.setAttributes(
        [.protectionKey: FileProtectionType.complete],
        ofItemAtPath: outputURL.path
      )
    #endif
  }

  private static func makeEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return encoder
  }

  private static func eventsCSV(_ events: [PracticeEvent]) -> String {
    let header = [
      "event_id", "session_id", "profile_generation_id", "mode", "guided_content_id",
      "guided_content_version", "started_at_utc", "ended_at_utc", "active_milliseconds",
      "qualifies_for_growth", "practice_local_date", "calendar_id", "time_zone_id",
      "source_installation_id", "created_at_utc",
    ]
    let rows = events.map { event in
      [
        event.id.uuidString,
        event.sessionID.uuidString,
        event.profileGenerationID.uuidString,
        event.mode.rawValue,
        event.guidedContentID ?? "",
        event.guidedContentVersion.map(String.init) ?? "",
        event.startedAt.ISO8601Format(),
        event.endedAt.ISO8601Format(),
        String(event.activeMilliseconds),
        event.qualifiesForGrowth ? "true" : "false",
        event.practiceDay.localDate,
        event.practiceDay.calendarIdentifier,
        event.practiceDay.timeZoneIdentifier,
        event.sourceInstallationID.uuidString,
        event.createdAt.ISO8601Format(),
      ].map(csvField).joined(separator: ",")
    }
    return ([header.map(csvField).joined(separator: ",")] + rows).joined(separator: "\n") + "\n"
  }

  private static func csvField(_ value: String) -> String {
    "\"\(value.replacingOccurrences(of: "\"", with: "\"\""))\""
  }

  private static func markdown(for entry: JournalEntry) -> String {
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

  private static func sha256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}
