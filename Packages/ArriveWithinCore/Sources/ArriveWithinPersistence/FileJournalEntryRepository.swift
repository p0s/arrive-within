import ArriveWithinDomain
import Foundation

public actor FileJournalEntryRepository: JournalEntryRepository {
  private struct Envelope: Codable, Sendable {
    let schemaVersion: Int
    var entries: [JournalEntry]
  }

  private let fileURL: URL
  private let fileManager: FileManager
  private let encoder: JSONEncoder
  private let decoder: JSONDecoder

  public init(fileURL: URL, fileManager: FileManager = .default) {
    self.fileURL = fileURL
    self.fileManager = fileManager
    self.encoder = Self.makeEncoder()
    self.decoder = Self.makeDecoder()
  }

  public func entries(
    profileGenerationID: UUID,
    includingDeleted: Bool = false
  ) throws -> [JournalEntry] {
    try load().entries
      .filter {
        $0.profileGenerationID == profileGenerationID && (includingDeleted || !$0.isDeleted)
      }
      .sorted { lhs, rhs in
        if lhs.modifiedAt != rhs.modifiedAt { return lhs.modifiedAt > rhs.modifiedAt }
        return lhs.id.uuidString < rhs.id.uuidString
      }
  }

  public func conflicts(profileGenerationID _: UUID) -> [JournalReplicaConflict] { [] }

  public func save(
    _ entry: JournalEntry,
    expectedRevision: Int?
  ) throws -> JournalWriteResult {
    var envelope = try load()
    if let index = envelope.entries.firstIndex(where: { $0.id == entry.id }) {
      let current = envelope.entries[index]
      guard current.profileGenerationID == entry.profileGenerationID else {
        throw JournalEntryError.identityChanged
      }
      guard expectedRevision == current.revision, entry.revision == current.revision else {
        return .conflict(current: current, attempted: entry)
      }
      let saved = try entry.persisted(revision: current.revision + 1)
      envelope.entries[index] = saved
      try save(envelope)
      return .saved(saved)
    }
    guard expectedRevision == nil, entry.revision == 0 else {
      throw JournalEntryError.missingExpectedEntry
    }
    let saved = try entry.persisted(revision: 1)
    envelope.entries.append(saved)
    try save(envelope)
    return .saved(saved)
  }

  public func deleteAll(profileGenerationID: UUID) throws {
    var envelope = try load()
    envelope.entries.removeAll { $0.profileGenerationID == profileGenerationID }
    try save(envelope)
  }

  private func load() throws -> Envelope {
    guard fileManager.fileExists(atPath: fileURL.path) else {
      return Envelope(schemaVersion: 1, entries: [])
    }
    do {
      let envelope = try decoder.decode(Envelope.self, from: Data(contentsOf: fileURL))
      guard envelope.schemaVersion == 1 else {
        throw FilePersistenceError.unsupportedSchema(envelope.schemaVersion)
      }
      return envelope
    } catch let error as FilePersistenceError {
      throw error
    } catch {
      throw FilePersistenceError.unreadableLedger
    }
  }

  private func save(_ envelope: Envelope) throws {
    let directory = fileURL.deletingLastPathComponent()
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    do {
      try encoder.encode(envelope).write(to: fileURL, options: .atomic)
      #if os(iOS)
        try fileManager.setAttributes(
          [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
          ofItemAtPath: fileURL.path
        )
      #endif
    } catch {
      throw FilePersistenceError.couldNotPersist
    }
  }

  private static func makeEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .millisecondsSince1970
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }

  private static func makeDecoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .millisecondsSince1970
    return decoder
  }
}
