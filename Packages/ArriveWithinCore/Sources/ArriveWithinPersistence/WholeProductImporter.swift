import ArriveWithinDomain
import CryptoKit
import Foundation

/// A validated, complete replacement prepared from an Arrive Within export.
/// It is safe to hold until the user confirms replacement; no store is changed
/// while the archive is being parsed or checked.
public struct PreparedProductDataRestore: Sendable {
  public let profile: LocalProfile
  public let events: [PracticeEvent]
  public let customization: GardenCustomization
  public let journalEntries: [JournalEntry]
  public let favoritePracticeIDs: Set<String>
  public let journalAudioByEntryID: [UUID: Data]

  public var practiceCount: Int { events.count }
  public var journalCount: Int { journalEntries.count }
  public var voiceFileCount: Int { journalAudioByEntryID.count }

  fileprivate init(
    profile: LocalProfile,
    events: [PracticeEvent],
    customization: GardenCustomization,
    journalEntries: [JournalEntry],
    favoritePracticeIDs: Set<String>,
    journalAudioByEntryID: [UUID: Data]
  ) {
    self.profile = profile
    self.events = events
    self.customization = customization
    self.journalEntries = journalEntries
    self.favoritePracticeIDs = favoritePracticeIDs
    self.journalAudioByEntryID = journalAudioByEntryID
  }
}

public enum WholeProductImportError: Error, Equatable, Sendable {
  case unsupportedArchive
  case unsafeArchive
  case unsupportedVersion
  case integrityMismatch
  case invalidContents
  case tooLarge
}

/// Imports only the exact uncompressed ZIP format produced by
/// `WholeProductExporter`. It rejects unsupported ZIP features and validates
/// every file and domain relationship before returning a replacement value.
public enum WholeProductImporter {
  public static let maximumArchiveBytes = 256 * 1_024 * 1_024
  public static let maximumArchiveEntryCount = 10_000
  public static let maximumPractices = 20_000
  public static let maximumJournalEntries = 4_096
  private static let requiredRootFiles: Set<String> = [
    "profile/profile.json",
    "journey/summary.json",
    "practices/events.json",
    "practices/events.csv",
    "garden/customization.json",
    "favorites/practices.json",
  ]

  private struct Manifest: Decodable {
    struct Counts: Decodable {
      let practices: Int
      let journalEntries: Int
      let voiceFiles: Int
      let favoritePractices: Int
    }

    struct FileRecord: Decodable {
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

  private struct CentralRecord {
    let name: String
    let checksum: UInt32
    let byteCount: Int
    let localOffset: Int
  }

  public static func prepare(_ archive: Data) throws -> PreparedProductDataRestore {
    guard archive.count <= maximumArchiveBytes else { throw WholeProductImportError.tooLarge }
    let files = try unpackStoredArchive(archive)
    guard files["manifest.json"] != nil else { throw WholeProductImportError.invalidContents }
    for path in requiredRootFiles where files[path] == nil {
      throw WholeProductImportError.invalidContents
    }

    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    let manifest: Manifest
    do {
      manifest = try decoder.decode(Manifest.self, from: files["manifest.json"]!)
    } catch {
      throw WholeProductImportError.invalidContents
    }
    guard manifest.schemaVersion == 1 else { throw WholeProductImportError.unsupportedVersion }
    guard manifest.product == "Arrive Within",
      manifest.exportType == "complete-user-readable-data",
      manifest.identifiersAndTimestampsAreLocalizationIndependent,
      manifest.counts.practices >= 0,
      manifest.counts.practices <= maximumPractices,
      manifest.counts.journalEntries >= 0,
      manifest.counts.journalEntries <= maximumJournalEntries,
      manifest.counts.voiceFiles >= 0,
      manifest.counts.voiceFiles <= manifest.counts.journalEntries,
      manifest.counts.favoritePractices >= 0,
      manifest.counts.favoritePractices <= 42
    else {
      throw WholeProductImportError.invalidContents
    }

    let listedFiles = files.filter { $0.key != "manifest.json" }
    guard manifest.files.count == listedFiles.count else {
      throw WholeProductImportError.integrityMismatch
    }
    var seenManifestPaths: Set<String> = []
    for record in manifest.files {
      guard seenManifestPaths.insert(record.path).inserted,
        let bytes = listedFiles[record.path],
        record.bytes == bytes.count,
        record.sha256 == sha256(bytes)
      else {
        throw WholeProductImportError.integrityMismatch
      }
    }
    guard seenManifestPaths == Set(listedFiles.keys) else {
      throw WholeProductImportError.integrityMismatch
    }

    let profile: LocalProfile
    let events: [PracticeEvent]
    let journey: JourneyProjection
    let customization: GardenCustomization
    let favoriteIDs: [String]
    do {
      profile = try decoder.decode(LocalProfile.self, from: files["profile/profile.json"]!)
      events = try decoder.decode([PracticeEvent].self, from: files["practices/events.json"]!)
      journey = try decoder.decode(JourneyProjection.self, from: files["journey/summary.json"]!)
      customization = try decoder.decode(
        GardenCustomization.self,
        from: files["garden/customization.json"]!
      )
      favoriteIDs = try decoder.decode([String].self, from: files["favorites/practices.json"]!)
    } catch {
      throw WholeProductImportError.invalidContents
    }

    guard files["practices/events.csv"] == Data(PracticeEventCSV.encode(events).utf8) else {
      throw WholeProductImportError.invalidContents
    }

    guard manifest.profileGenerationID == profile.profileGenerationID,
      events.count == manifest.counts.practices,
      manifest.counts.journalEntries >= 0,
      Set(favoriteIDs).count == favoriteIDs.count,
      Set(favoriteIDs).count == manifest.counts.favoritePractices,
      Set(favoriteIDs).allSatisfy(isGuidedPracticeID),
      events.allSatisfy({ $0.profileGenerationID == profile.profileGenerationID }),
      Set(events.map(\.id)).count == events.count,
      Set(events.map(\.sessionID)).count == events.count,
      events.allSatisfy(validEvent),
      journey == JourneyReducer.reduce(
        events: events,
        profileGenerationID: profile.profileGenerationID
      ),
      customization.selectedVariantByMilestone.allSatisfy({
        (1...30).contains($0.key) && !$0.value.isEmpty && $0.value.count <= 128
      })
    else {
      throw WholeProductImportError.invalidContents
    }

    let audioPaths = Set(files.keys.filter { $0.contains("/audio/") })
    var journalEntries: [JournalEntry] = []
    var journalAudio: [UUID: Data] = [:]
    var usedAudioFileNames: Set<String> = []
    var expectedPaths = requiredRootFiles.union([
      "manifest.json",
    ])
    let eventIDs = Set(events.map(\.id))
    let journalDirectories = Set(files.keys.compactMap(journalDirectory(from:)))
    guard journalDirectories.count == manifest.counts.journalEntries else {
      throw WholeProductImportError.invalidContents
    }

    for directory in journalDirectories.sorted() {
      let entryPath = "journal/\(directory)/entry.json"
      let markdownPath = "journal/\(directory)/entry.md"
      guard let entryData = files[entryPath], let markdownData = files[markdownPath],
        let markdownText = String(data: markdownData, encoding: .utf8)
      else {
        throw WholeProductImportError.invalidContents
      }
      let entry: JournalEntry
      do {
        entry = try decoder.decode(JournalEntry.self, from: entryData)
      } catch {
        throw WholeProductImportError.invalidContents
      }
      guard entry.id.uuidString.lowercased() == directory,
        entry.profileGenerationID == profile.profileGenerationID,
        entry.revision > 0,
        entry.revision <= JournalEntry.maximumPersistedRevision,
        !entry.isDeleted,
        entry.linkedPracticeEventID.map(eventIDs.contains) ?? true,
        markdownText == markdown(for: entry),
        journalEntries.allSatisfy({ $0.id != entry.id })
      else {
        throw WholeProductImportError.invalidContents
      }
      expectedPaths.insert(entryPath)
      expectedPaths.insert(markdownPath)

      if let attachment = entry.audioAttachment {
        guard usedAudioFileNames.insert(attachment.relativeFileName).inserted else {
          throw WholeProductImportError.invalidContents
        }
        let audioPath = "journal/\(directory)/audio/\(attachment.relativeFileName)"
        guard let audio = files[audioPath],
          Int64(audio.count) == attachment.byteCount,
          sha256(audio) == attachment.checksumSHA256
        else {
          throw WholeProductImportError.integrityMismatch
        }
        expectedPaths.insert(audioPath)
        journalAudio[entry.id] = audio
      }
      journalEntries.append(entry)
    }
    guard expectedPaths == Set(files.keys),
      audioPaths.count == manifest.counts.voiceFiles,
      journalAudio.count == manifest.counts.voiceFiles
    else {
      throw WholeProductImportError.invalidContents
    }

    return PreparedProductDataRestore(
      profile: profile,
      events: events,
      customization: customization,
      journalEntries: journalEntries.sorted { $0.id.uuidString < $1.id.uuidString },
      favoritePracticeIDs: Set(favoriteIDs),
      journalAudioByEntryID: journalAudio
    )
  }

  static func unpackStoredArchive(_ data: Data) throws -> [String: Data] {
    guard data.count >= 22 else { throw WholeProductImportError.unsupportedArchive }
    let eocdSearchStart = max(0, data.count - 65_557)
    var eocdOffset: Int?
    for offset in stride(from: data.count - 22, through: eocdSearchStart, by: -1) {
      if (try? uint32(data, at: offset)) == 0x0605_4B50 {
        eocdOffset = offset
        break
      }
    }
    guard let eocd = eocdOffset,
      try uint16(data, at: eocd + 4) == 0,
      try uint16(data, at: eocd + 6) == 0,
      try uint16(data, at: eocd + 20) == 0,
      eocd + 22 == data.count
    else {
      throw WholeProductImportError.unsupportedArchive
    }
    guard try uint16(data, at: eocd + 8) == uint16(data, at: eocd + 10) else {
      throw WholeProductImportError.unsupportedArchive
    }
    let entryCount = Int(try uint16(data, at: eocd + 10))
    let centralSize = Int(try uint32(data, at: eocd + 12))
    let centralOffset = Int(try uint32(data, at: eocd + 16))
    guard entryCount > 0, entryCount <= maximumArchiveEntryCount,
      centralOffset <= eocd,
      centralSize == eocd - centralOffset
    else {
      throw WholeProductImportError.tooLarge
    }

    var records: [CentralRecord] = []
    records.reserveCapacity(entryCount)
    var offset = centralOffset
    var previousName: String?
    for _ in 0..<entryCount {
      guard try uint32(data, at: offset) == 0x0201_4B50,
        try uint16(data, at: offset + 4) == 20,
        try uint16(data, at: offset + 6) == 20,
        try uint16(data, at: offset + 8) == 0x0800,
        try uint16(data, at: offset + 10) == 0,
        try uint16(data, at: offset + 30) == 0,
        try uint16(data, at: offset + 32) == 0,
        try uint16(data, at: offset + 34) == 0,
        try uint32(data, at: offset + 38) == 0
      else {
        throw WholeProductImportError.unsupportedArchive
      }
      let checksum = try uint32(data, at: offset + 16)
      let compressedSize = Int(try uint32(data, at: offset + 20))
      let uncompressedSize = Int(try uint32(data, at: offset + 24))
      let nameLength = Int(try uint16(data, at: offset + 28))
      let extraLength = Int(try uint16(data, at: offset + 30))
      let commentLength = Int(try uint16(data, at: offset + 32))
      let diskNumber = try uint16(data, at: offset + 34)
      let localOffset = Int(try uint32(data, at: offset + 42))
      let recordLength = 46 + nameLength + extraLength + commentLength
      guard diskNumber == 0, compressedSize == uncompressedSize,
        uncompressedSize <= maximumArchiveBytes,
        offset <= data.count - recordLength,
        nameLength > 0
      else {
        throw WholeProductImportError.unsupportedArchive
      }
      let nameData = data[(offset + 46)..<(offset + 46 + nameLength)]
      guard let name = String(data: nameData, encoding: .utf8),
        isAllowedArchivePath(name),
        previousName.map({ $0 < name }) ?? true
      else {
        throw WholeProductImportError.unsafeArchive
      }
      previousName = name
      records.append(
        CentralRecord(
          name: name,
          checksum: checksum,
          byteCount: uncompressedSize,
          localOffset: localOffset
        )
      )
      offset += recordLength
    }
    guard offset == eocd, Set(records.map(\.name)).count == records.count else {
      throw WholeProductImportError.unsupportedArchive
    }

    let localRecords = records.sorted { $0.localOffset < $1.localOffset }
    var localCursor = 0
    var files: [String: Data] = [:]
    for record in localRecords {
      let local = record.localOffset
      guard local == localCursor,
        try uint32(data, at: local) == 0x0403_4B50,
        try uint16(data, at: local + 4) == 20,
        try uint16(data, at: local + 6) == 0x0800,
        try uint16(data, at: local + 8) == 0,
        try uint32(data, at: local + 14) == record.checksum,
        Int(try uint32(data, at: local + 18)) == record.byteCount,
        Int(try uint32(data, at: local + 22)) == record.byteCount,
        try uint16(data, at: local + 26) > 0,
        try uint16(data, at: local + 28) == 0
      else {
        throw WholeProductImportError.unsupportedArchive
      }
      let nameLength = Int(try uint16(data, at: local + 26))
      let dataStart = local + 30 + nameLength
      guard dataStart <= centralOffset,
        record.byteCount <= centralOffset - dataStart,
        let localName = String(
          data: data[(local + 30)..<dataStart],
          encoding: .utf8
        ),
        localName == record.name
      else {
        throw WholeProductImportError.unsupportedArchive
      }
      let contents = data[dataStart..<(dataStart + record.byteCount)]
      guard crc32(contents) == record.checksum else {
        throw WholeProductImportError.integrityMismatch
      }
      files[record.name] = Data(contents)
      localCursor = dataStart + record.byteCount
    }
    guard localCursor == centralOffset else {
      throw WholeProductImportError.unsupportedArchive
    }
    return files
  }

  private static func isAllowedArchivePath(_ path: String) -> Bool {
    guard !path.isEmpty,
      path.utf8.count <= 1_024,
      !path.hasPrefix("/"),
      !path.contains("\\"),
      !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
    else {
      return false
    }
    let components = path.split(separator: "/", omittingEmptySubsequences: false)
    guard components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
      return false
    }
    let value = components.map(String.init)
    if requiredRootFiles.contains(path) || path == "manifest.json" { return true }
    guard value.count == 3 || value.count == 4,
      value[0] == "journal",
      let identifier = UUID(uuidString: value[1]),
      identifier.uuidString.lowercased() == value[1]
    else {
      return false
    }
    if value.count == 3 { return value[2] == "entry.json" || value[2] == "entry.md" }
    return value[2] == "audio" && !value[3].isEmpty && value[3] != "." && value[3] != ".."
      && !value[3].contains(":")
  }

  private static func journalDirectory(from path: String) -> String? {
    let components = path.split(separator: "/", omittingEmptySubsequences: false)
    guard components.count >= 3, components[0] == "journal",
      let id = UUID(uuidString: String(components[1]))
    else {
      return nil
    }
    return id.uuidString.lowercased()
  }

  private static func validEvent(_ event: PracticeEvent) -> Bool {
    if event.mode == .guided {
      guard let identifier = event.guidedContentID,
        isGuidedPracticeID(identifier),
        let version = event.guidedContentVersion,
        version > 0
      else {
        return false
      }
    }
    return true
  }

  private static func isGuidedPracticeID(_ identifier: String) -> Bool {
    guard identifier.count == 3, identifier.first == "G",
      let number = Int(identifier.dropFirst())
    else {
      return false
    }
    return (1...42).contains(number) && identifier == String(format: "G%02d", number)
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

  private static func crc32(_ data: Data) -> UInt32 {
    var crc = UInt32.max
    for byte in data {
      crc ^= UInt32(byte)
      for _ in 0..<8 {
        crc = (crc >> 1) ^ (0xEDB8_8320 & (0 &- (crc & 1)))
      }
    }
    return ~crc
  }

  private static func uint16(_ data: Data, at offset: Int) throws -> UInt16 {
    guard offset >= 0, offset <= data.count - 2 else {
      throw WholeProductImportError.unsupportedArchive
    }
    return UInt16(data[offset]) | (UInt16(data[offset + 1]) << 8)
  }

  private static func uint32(_ data: Data, at offset: Int) throws -> UInt32 {
    guard offset >= 0, offset <= data.count - 4 else {
      throw WholeProductImportError.unsupportedArchive
    }
    return UInt32(data[offset])
      | (UInt32(data[offset + 1]) << 8)
      | (UInt32(data[offset + 2]) << 16)
      | (UInt32(data[offset + 3]) << 24)
  }
}
