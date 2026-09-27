import Foundation

public struct JournalTextDraft: Codable, Equatable, Sendable {
  public static let maximumTextUTF8Bytes = 262_144

  public let editorKey: String
  public let profileGenerationID: UUID
  public let linkedPracticeEventID: UUID?
  public let text: String
  public let modifiedAt: Date

  public init(
    editorKey: String,
    profileGenerationID: UUID,
    linkedPracticeEventID: UUID?,
    text: String,
    modifiedAt: Date = Date()
  ) throws {
    guard Self.isValidEditorKey(editorKey),
      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      text.utf8.count <= Self.maximumTextUTF8Bytes
    else {
      throw JournalTextDraftError.invalidDraft
    }
    self.editorKey = editorKey
    self.profileGenerationID = profileGenerationID
    self.linkedPracticeEventID = linkedPracticeEventID
    self.text = text
    self.modifiedAt = modifiedAt
  }

  private enum CodingKeys: String, CodingKey {
    case editorKey
    case profileGenerationID
    case linkedPracticeEventID
    case text
    case modifiedAt
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    try self.init(
      editorKey: container.decode(String.self, forKey: .editorKey),
      profileGenerationID: container.decode(UUID.self, forKey: .profileGenerationID),
      linkedPracticeEventID: container.decodeIfPresent(UUID.self, forKey: .linkedPracticeEventID),
      text: container.decode(String.self, forKey: .text),
      modifiedAt: container.decode(Date.self, forKey: .modifiedAt)
    )
  }

  private static func isValidEditorKey(_ value: String) -> Bool {
    if value == "new:unlinked" { return true }
    let parts = value.split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count == 2,
      parts[0] == "entry" || parts[0] == "practice",
      let identifier = UUID(uuidString: String(parts[1]))
    else {
      return false
    }
    return identifier.uuidString.lowercased() == parts[1].lowercased()
  }
}

public protocol JournalTextDraftRepository: Sendable {
  func load(editorKey: String, profileGenerationID: UUID) async throws -> JournalTextDraft?
  func save(_ draft: JournalTextDraft) async throws
  func delete(editorKey: String, profileGenerationID: UUID) async throws
  func deleteEntryDrafts(entryIDs: Set<UUID>, profileGenerationID: UUID) async throws
  func deleteAll() async throws
}

public enum JournalTextDraftError: Error, Equatable, Sendable {
  case invalidDraft
  case invalidStorage
  case unreadableStorage
  case storageLimitReached
  case couldNotPersist
}

public actor FileJournalTextDraftRepository: JournalTextDraftRepository {
  private struct Envelope: Codable {
    let schemaVersion: Int
    var drafts: [JournalTextDraft]
  }

  private static let maximumDraftCount = 32
  private static let maximumFileBytes = 9 * 1_024 * 1_024
  private static let fileName = "journal-drafts-v1.json"

  private let fileURL: URL
  private let fileManager: FileManager
  private let encoder: JSONEncoder
  private let decoder: JSONDecoder

  public init(fileURL: URL, fileManager: FileManager = .default) {
    self.fileURL = fileURL.standardizedFileURL
    self.fileManager = fileManager
    self.encoder = JSONEncoder()
    self.encoder.dateEncodingStrategy = .millisecondsSince1970
    self.encoder.outputFormatting = [.sortedKeys]
    self.decoder = JSONDecoder()
    self.decoder.dateDecodingStrategy = .millisecondsSince1970
  }

  public func load(
    editorKey: String,
    profileGenerationID: UUID
  ) throws -> JournalTextDraft? {
    guard Self.isValidEditorKey(editorKey) else { throw JournalTextDraftError.invalidDraft }
    return try readEnvelope().drafts.first {
      $0.editorKey == editorKey && $0.profileGenerationID == profileGenerationID
    }
  }

  public func save(_ draft: JournalTextDraft) throws {
    var envelope = try readEnvelope()
    if let index = envelope.drafts.firstIndex(where: {
      $0.editorKey == draft.editorKey
        && $0.profileGenerationID == draft.profileGenerationID
    }) {
      envelope.drafts[index] = draft
    } else {
      guard envelope.drafts.count < Self.maximumDraftCount else {
        throw JournalTextDraftError.storageLimitReached
      }
      envelope.drafts.append(draft)
    }
    envelope.drafts.sort {
      if $0.modifiedAt != $1.modifiedAt { return $0.modifiedAt < $1.modifiedAt }
      if $0.profileGenerationID != $1.profileGenerationID {
        return $0.profileGenerationID.uuidString < $1.profileGenerationID.uuidString
      }
      return $0.editorKey < $1.editorKey
    }
    try write(envelope)
  }

  public func delete(editorKey: String, profileGenerationID: UUID) throws {
    guard Self.isValidEditorKey(editorKey) else { throw JournalTextDraftError.invalidDraft }
    var envelope = try readEnvelope()
    let previousCount = envelope.drafts.count
    envelope.drafts.removeAll {
      $0.editorKey == editorKey && $0.profileGenerationID == profileGenerationID
    }
    if envelope.drafts.count != previousCount { try write(envelope) }
  }

  public func deleteEntryDrafts(entryIDs: Set<UUID>, profileGenerationID: UUID) throws {
    guard !entryIDs.isEmpty else { return }
    let editorKeys = Set(entryIDs.map { "entry:\($0.uuidString.lowercased())" })
    var envelope = try readEnvelope()
    let previousCount = envelope.drafts.count
    envelope.drafts.removeAll {
      $0.profileGenerationID == profileGenerationID && editorKeys.contains($0.editorKey)
    }
    if envelope.drafts.count != previousCount { try write(envelope) }
  }

  public func deleteAll() throws {
    guard fileManager.fileExists(atPath: fileURL.path) else { return }
    try validateExistingFile()
    do {
      try fileManager.removeItem(at: fileURL)
    } catch {
      throw JournalTextDraftError.couldNotPersist
    }
  }

  private func readEnvelope() throws -> Envelope {
    guard fileManager.fileExists(atPath: fileURL.path) else {
      return Envelope(schemaVersion: 1, drafts: [])
    }
    try validateExistingFile()
    do {
      let data = try Data(contentsOf: fileURL, options: [.mappedIfSafe])
      guard data.count <= Self.maximumFileBytes else {
        throw JournalTextDraftError.unreadableStorage
      }
      let envelope = try decoder.decode(Envelope.self, from: data)
      guard envelope.schemaVersion == 1,
        envelope.drafts.count <= Self.maximumDraftCount,
        Set(
          envelope.drafts.map {
            "\($0.profileGenerationID.uuidString.lowercased()):\($0.editorKey)"
          }
        ).count == envelope.drafts.count
      else {
        throw JournalTextDraftError.unreadableStorage
      }
      return envelope
    } catch let error as JournalTextDraftError {
      throw error
    } catch {
      throw JournalTextDraftError.unreadableStorage
    }
  }

  private func write(_ envelope: Envelope) throws {
    guard fileURL.lastPathComponent == Self.fileName,
      fileURL.isFileURL,
      fileURL.deletingLastPathComponent().path != "/"
    else {
      throw JournalTextDraftError.invalidStorage
    }
    let directory = fileURL.deletingLastPathComponent()
    do {
      try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
      let data = try encoder.encode(envelope)
      guard data.count <= Self.maximumFileBytes else {
        throw JournalTextDraftError.storageLimitReached
      }
      try data.write(to: fileURL, options: .atomic)
      #if os(iOS)
        try fileManager.setAttributes(
          [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
          ofItemAtPath: fileURL.path
        )
      #endif
    } catch let error as JournalTextDraftError {
      throw error
    } catch {
      throw JournalTextDraftError.couldNotPersist
    }
  }

  private func validateExistingFile() throws {
    guard fileURL.lastPathComponent == Self.fileName,
      fileURL.isFileURL,
      fileURL.deletingLastPathComponent().path != "/"
    else {
      throw JournalTextDraftError.invalidStorage
    }
    do {
      let values = try fileURL.resourceValues(
        forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]
      )
      guard values.isRegularFile == true, values.isSymbolicLink != true,
        (values.fileSize ?? 0) <= Self.maximumFileBytes
      else {
        throw JournalTextDraftError.unreadableStorage
      }
    } catch let error as JournalTextDraftError {
      throw error
    } catch {
      throw JournalTextDraftError.unreadableStorage
    }
  }

  private static func isValidEditorKey(_ value: String) -> Bool {
    (try? JournalTextDraft(
      editorKey: value,
      profileGenerationID: UUID(),
      linkedPracticeEventID: nil,
      text: "draft"
    )) != nil
  }
}
