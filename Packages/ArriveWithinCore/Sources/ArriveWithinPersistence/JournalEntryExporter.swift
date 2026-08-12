import ArriveWithinDomain
import CryptoKit
import Foundation

public enum JournalEntryExporter {
  private struct Manifest: Codable {
    let schemaVersion: Int
    let entryID: UUID
    let profileGenerationID: UUID
    let linkedPracticeEventID: UUID?
    let createdAt: Date
    let modifiedAt: Date
    let revision: Int
    let textLocaleIdentifier: String?
    let audioFileName: String?
    let audioChecksumSHA256: String?
    let transcriptLocaleIdentifier: String?
    let transcriptEngineIdentifier: String?
  }

  public static func export(
    entry: JournalEntry,
    audioDirectory: URL,
    outputURL: URL,
    fileManager: FileManager = .default
  ) throws {
    guard !entry.isDeleted, outputURL.pathExtension.lowercased() == "zip" else {
      throw JournalExportError.invalidEntry
    }
    var files: [(name: String, data: Data)] = []
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    files.append(("entry.json", try encoder.encode(entry)))
    files.append(("entry.md", Data(markdown(for: entry).utf8)))
    let manifest = Manifest(
      schemaVersion: 1,
      entryID: entry.id,
      profileGenerationID: entry.profileGenerationID,
      linkedPracticeEventID: entry.linkedPracticeEventID,
      createdAt: entry.createdAt,
      modifiedAt: entry.modifiedAt,
      revision: entry.revision,
      textLocaleIdentifier: entry.textLocaleIdentifier,
      audioFileName: entry.audioAttachment?.relativeFileName,
      audioChecksumSHA256: entry.audioAttachment?.checksumSHA256,
      transcriptLocaleIdentifier: entry.transcript?.localeIdentifier,
      transcriptEngineIdentifier: entry.transcript?.engineIdentifier
    )
    files.append(("manifest.json", try encoder.encode(manifest)))

    if let attachment = entry.audioAttachment {
      let audioURL = audioDirectory.appending(path: attachment.relativeFileName)
      try validateAudioFile(
        audioURL,
        named: attachment.relativeFileName,
        below: audioDirectory,
        fileManager: fileManager
      )
      let audioData = try Data(contentsOf: audioURL)
      let digest = SHA256.hash(data: audioData).map { String(format: "%02x", $0) }.joined()
      guard
        digest == attachment.checksumSHA256,
        Int64(audioData.count) == attachment.byteCount
      else {
        throw JournalExportError.audioIntegrityMismatch
      }
      files.append(("audio/\(attachment.relativeFileName)", audioData))
    }

    let archive = try StoredZipArchive(files: files).data()
    let directory = outputURL.deletingLastPathComponent()
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    try archive.write(to: outputURL, options: .atomic)
    #if os(iOS)
      try fileManager.setAttributes(
        [.protectionKey: FileProtectionType.complete],
        ofItemAtPath: outputURL.path
      )
    #endif
  }

  private static func validateAudioFile(
    _ audioURL: URL,
    named fileName: String,
    below audioDirectory: URL,
    fileManager: FileManager
  ) throws {
    let root = audioDirectory.standardizedFileURL
    let candidate = audioURL.standardizedFileURL
    guard root.isFileURL, root.path != "/",
      fileName == URL(fileURLWithPath: fileName).lastPathComponent,
      candidate.deletingLastPathComponent().path == root.path,
      fileManager.fileExists(atPath: candidate.path)
    else {
      throw JournalExportError.unsafeAudioPath
    }
    let rootValues = try root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
    let candidateValues = try candidate.resourceValues(
      forKeys: [.isRegularFileKey, .isSymbolicLinkKey]
    )
    guard rootValues.isDirectory == true, rootValues.isSymbolicLink != true,
      candidateValues.isRegularFile == true, candidateValues.isSymbolicLink != true,
      candidate.resolvingSymlinksInPath().standardizedFileURL.path == candidate.path
    else {
      throw JournalExportError.unsafeAudioPath
    }
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
    if let locale = entry.textLocaleIdentifier {
      lines.append("- Text locale: `\(locale)`")
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
      lines.append(contentsOf: [
        "",
        "## On-device transcript",
        "",
        transcript.text,
      ])
    }
    lines.append("")
    return lines.joined(separator: "\n")
  }
}

public enum JournalExportError: Error, Equatable, Sendable {
  case invalidEntry
  case unsafeAudioPath
  case audioMissing
  case audioIntegrityMismatch
  case fileTooLarge
  case tooManyFiles
  case invalidFileName
}

struct StoredZipArchive {
  private struct Record {
    let name: Data
    let content: Data
    let checksum: UInt32
    let localOffset: UInt32
  }

  let files: [(name: String, data: Data)]

  func data() throws -> Data {
    guard files.count <= Int(UInt16.max) else { throw JournalExportError.tooManyFiles }
    var archive = Data()
    var records: [Record] = []
    for file in files.sorted(by: { $0.name < $1.name }) {
      guard
        !file.name.isEmpty,
        !file.name.hasPrefix("/"),
        !file.name.contains(".."),
        let name = file.name.data(using: .utf8),
        name.count <= Int(UInt16.max),
        file.data.count <= Int(UInt32.max),
        archive.count <= Int(UInt32.max)
      else {
        throw JournalExportError.invalidFileName
      }
      let checksum = crc32(file.data)
      let offset = UInt32(archive.count)
      archive.appendLittleEndian(UInt32(0x0403_4B50))
      archive.appendLittleEndian(UInt16(20))
      archive.appendLittleEndian(UInt16(0x0800))
      archive.appendLittleEndian(UInt16(0))
      archive.appendLittleEndian(UInt16(0))
      archive.appendLittleEndian(UInt16(0x0021))
      archive.appendLittleEndian(checksum)
      archive.appendLittleEndian(UInt32(file.data.count))
      archive.appendLittleEndian(UInt32(file.data.count))
      archive.appendLittleEndian(UInt16(name.count))
      archive.appendLittleEndian(UInt16(0))
      archive.append(name)
      archive.append(file.data)
      records.append(Record(name: name, content: file.data, checksum: checksum, localOffset: offset))
    }

    guard archive.count <= Int(UInt32.max) else { throw JournalExportError.fileTooLarge }
    let centralOffset = UInt32(archive.count)
    for record in records {
      archive.appendLittleEndian(UInt32(0x0201_4B50))
      archive.appendLittleEndian(UInt16(20))
      archive.appendLittleEndian(UInt16(20))
      archive.appendLittleEndian(UInt16(0x0800))
      archive.appendLittleEndian(UInt16(0))
      archive.appendLittleEndian(UInt16(0))
      archive.appendLittleEndian(UInt16(0x0021))
      archive.appendLittleEndian(record.checksum)
      archive.appendLittleEndian(UInt32(record.content.count))
      archive.appendLittleEndian(UInt32(record.content.count))
      archive.appendLittleEndian(UInt16(record.name.count))
      archive.appendLittleEndian(UInt16(0))
      archive.appendLittleEndian(UInt16(0))
      archive.appendLittleEndian(UInt16(0))
      archive.appendLittleEndian(UInt16(0))
      archive.appendLittleEndian(UInt32(0))
      archive.appendLittleEndian(record.localOffset)
      archive.append(record.name)
    }
    guard archive.count <= Int(UInt32.max) else { throw JournalExportError.fileTooLarge }
    let centralSize = UInt32(archive.count) - centralOffset
    archive.appendLittleEndian(UInt32(0x0605_4B50))
    archive.appendLittleEndian(UInt16(0))
    archive.appendLittleEndian(UInt16(0))
    archive.appendLittleEndian(UInt16(records.count))
    archive.appendLittleEndian(UInt16(records.count))
    archive.appendLittleEndian(centralSize)
    archive.appendLittleEndian(centralOffset)
    archive.appendLittleEndian(UInt16(0))
    return archive
  }

  private func crc32(_ data: Data) -> UInt32 {
    var crc = UInt32.max
    for byte in data {
      crc ^= UInt32(byte)
      for _ in 0..<8 {
        crc = (crc >> 1) ^ (0xEDB8_8320 & (0 &- (crc & 1)))
      }
    }
    return ~crc
  }
}

extension Data {
  fileprivate mutating func appendLittleEndian<T: FixedWidthInteger>(_ value: T) {
    var littleEndian = value.littleEndian
    Swift.withUnsafeBytes(of: &littleEndian) { append(contentsOf: $0) }
  }
}
