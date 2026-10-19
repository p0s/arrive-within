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
  case duplicateAudioFileName
  case archiveTooLarge
  case archiveFailed
}

public enum WholeProductExporter {
  private struct PendingAudioFile {
    let name: String
    let url: URL
    let attachment: JournalAudioAttachment
    let byteCount: Int
  }

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
    guard snapshot.events.count <= WholeProductImporter.maximumPractices,
      snapshot.journalEntries.count <= WholeProductImporter.maximumJournalEntries,
      snapshot.favoritePracticeIDs.count <= 42
    else {
      throw ProductDataExportError.archiveTooLarge
    }
    let voiceFileCount = snapshot.journalEntries.reduce(into: 0) { count, entry in
      if entry.audioAttachment != nil { count += 1 }
    }
    let (journalFileCount, journalOverflow) = snapshot.journalEntries.count
      .multipliedReportingOverflow(by: 2)
    let (journalAndRootCount, entryOverflow) = 7.addingReportingOverflow(journalFileCount)
    let (entryCount, voiceOverflow) = journalAndRootCount.addingReportingOverflow(voiceFileCount)
    guard !journalOverflow, !entryOverflow, !voiceOverflow,
      entryCount <= WholeProductImporter.maximumArchiveEntryCount
    else {
      throw ProductDataExportError.archiveTooLarge
    }

    var files: [(name: String, data: Data)] = []
    var pendingAudioFiles: [PendingAudioFile] = []
    var estimatedArchiveBytes = 22
    var estimatedEntryCount = 0
    let encoder = makeEncoder()
    func reserveArchiveEntry(name: String, byteCount: Int) throws {
      guard let nameByteCount = name.data(using: .utf8)?.count,
        nameByteCount <= Int(UInt16.max),
        byteCount >= 0, byteCount <= Int(UInt32.max)
      else {
        throw ProductDataExportError.archiveTooLarge
      }
      let (nextCount, countOverflow) = estimatedEntryCount.addingReportingOverflow(1)
      let (nameHeadersByteCount, nameHeadersOverflow) =
        nameByteCount.multipliedReportingOverflow(by: 2)
      let (overhead, overheadOverflow) = 76.addingReportingOverflow(nameHeadersByteCount)
      let (entryBytes, entryOverflow) = byteCount.addingReportingOverflow(overhead)
      let (nextBytes, bytesOverflow) = estimatedArchiveBytes.addingReportingOverflow(entryBytes)
      guard !countOverflow, !nameHeadersOverflow, !overheadOverflow,
        !entryOverflow, !bytesOverflow,
        nextCount <= WholeProductImporter.maximumArchiveEntryCount,
        nextBytes <= WholeProductImporter.maximumArchiveBytes,
        nextBytes <= Int(UInt32.max)
      else {
        throw ProductDataExportError.archiveTooLarge
      }
      estimatedEntryCount = nextCount
      estimatedArchiveBytes = nextBytes
    }
    func appendAdmittedFile(name: String, data: Data) throws {
      try reserveArchiveEntry(name: name, byteCount: data.count)
      files.append((name, data))
    }

    try appendAdmittedFile(
      name: "profile/profile.json",
      data: encoder.encode(snapshot.profile)
    )
    try appendAdmittedFile(
      name: "journey/summary.json",
      data: encoder.encode(snapshot.journey)
    )
    try appendAdmittedFile(
      name: "practices/events.json",
      data: encoder.encode(snapshot.events)
    )
    try appendAdmittedFile(
      name: "practices/events.csv",
      data: Data(PracticeEventCSV.encode(snapshot.events).utf8)
    )
    try appendAdmittedFile(
      name: "garden/customization.json",
      data: encoder.encode(snapshot.customization)
    )
    try appendAdmittedFile(
      name: "favorites/practices.json",
      data: encoder.encode(snapshot.favoritePracticeIDs.sorted())
    )

    var usedAudioFileNames: Set<String> = []
    for entry in snapshot.journalEntries.sorted(by: { $0.id.uuidString < $1.id.uuidString }) {
      guard !entry.isDeleted else { throw ProductDataExportError.deletedJournalEntry }
      let prefix = "journal/\(entry.id.uuidString.lowercased())"
      try appendAdmittedFile(
        name: "\(prefix)/entry.json",
        data: encoder.encode(entry)
      )
      try appendAdmittedFile(
        name: "\(prefix)/entry.md",
        data: Data(markdown(for: entry).utf8)
      )
      if let attachment = entry.audioAttachment {
        guard usedAudioFileNames.insert(attachment.relativeFileName).inserted else {
          throw ProductDataExportError.duplicateAudioFileName
        }
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
        guard let byteCount = Int(exactly: attachment.byteCount), byteCount >= 0 else {
          throw ProductDataExportError.audioIntegrityMismatch
        }
        let audioName = "\(prefix)/audio/\(attachment.relativeFileName)"
        // Admit the metadata-declared size and ZIP overhead before reading the audio bytes.
        try reserveArchiveEntry(name: audioName, byteCount: byteCount)
        pendingAudioFiles.append(
          PendingAudioFile(
            name: audioName,
            url: candidate,
            attachment: attachment,
            byteCount: byteCount
          )
        )
      }
    }

    let fileRecords = (
      files.map {
        Manifest.FileRecord(path: $0.name, bytes: $0.data.count, sha256: sha256($0.data))
      }
        + pendingAudioFiles.map {
          Manifest.FileRecord(
            path: $0.name,
            bytes: $0.byteCount,
            sha256: $0.attachment.checksumSHA256
          )
        }
    ).sorted(by: { $0.path < $1.path })
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
        voiceFiles: pendingAudioFiles.count,
        favoritePractices: snapshot.favoritePracticeIDs.count
      ),
      files: fileRecords
    )
    let manifestData = try encoder.encode(manifest)
    try reserveArchiveEntry(name: "manifest.json", byteCount: manifestData.count)
    files.append(("manifest.json", manifestData))

    for audioFile in pendingAudioFiles {
      let values = try audioFile.url.resourceValues(
        forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]
      )
      guard values.isRegularFile == true, values.isSymbolicLink != true,
        audioFile.url.resolvingSymlinksInPath().standardizedFileURL.path
          == audioFile.url.standardizedFileURL.path
      else {
        throw ProductDataExportError.unsafeAudioPath
      }
      guard values.fileSize == audioFile.byteCount else {
        throw ProductDataExportError.audioIntegrityMismatch
      }
      let audio = try Data(contentsOf: audioFile.url)
      guard audio.count == audioFile.byteCount,
        Int64(audio.count) == audioFile.attachment.byteCount,
        sha256(audio) == audioFile.attachment.checksumSHA256
      else {
        throw ProductDataExportError.audioIntegrityMismatch
      }
      files.append((audioFile.name, audio))
    }

    let archive: Data
    do {
      archive = try StoredZipArchive(files: files).data(
        maximumArchiveBytes: WholeProductImporter.maximumArchiveBytes,
        maximumEntryCount: WholeProductImporter.maximumArchiveEntryCount
      )
    } catch JournalExportError.tooManyFiles, JournalExportError.fileTooLarge {
      throw ProductDataExportError.archiveTooLarge
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
