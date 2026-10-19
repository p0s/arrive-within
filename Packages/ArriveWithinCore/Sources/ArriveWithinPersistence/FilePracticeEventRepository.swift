import ArriveWithinDomain
import Foundation

public actor FilePracticeEventRepository: PracticeEventRepository {
  private struct Envelope: Codable, Sendable {
    let schemaVersion: Int
    var events: [PracticeEvent]
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

  public func allEvents(profileGenerationID: UUID) throws -> [PracticeEvent] {
    try load().events
      .filter { $0.profileGenerationID == profileGenerationID }
      .sorted { lhs, rhs in
        if lhs.endedAt != rhs.endedAt { return lhs.endedAt < rhs.endedAt }
        return lhs.id.uuidString < rhs.id.uuidString
      }
  }

  public func event(sessionID: UUID, profileGenerationID: UUID) throws -> PracticeEvent? {
    try load().events.first {
      $0.sessionID == sessionID && $0.profileGenerationID == profileGenerationID
    }
  }

  @discardableResult
  public func insertIfAbsent(_ event: PracticeEvent) throws -> PracticeEvent {
    var envelope = try load()
    if let existing = envelope.events.first(where: {
      $0.sessionID == event.sessionID && $0.profileGenerationID == event.profileGenerationID
    }) {
      return existing
    }
    if let conflicting = envelope.events.first(where: { $0.id == event.id }) {
      throw FilePersistenceError.conflictingEventIdentifier(existingSessionID: conflicting.sessionID)
    }
    envelope.events.append(event)
    try save(envelope)
    return event
  }

  public func deleteAll(profileGenerationID: UUID) throws {
    var envelope = try load()
    envelope.events.removeAll { $0.profileGenerationID == profileGenerationID }
    try save(envelope)
  }

  private func load() throws -> Envelope {
    guard fileManager.fileExists(atPath: fileURL.path) else {
      return Envelope(schemaVersion: 1, events: [])
    }
    do {
      let data = try Data(contentsOf: fileURL)
      let envelope = try decoder.decode(Envelope.self, from: data)
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

public enum FilePersistenceError: Error, Equatable, Sendable {
  case unsupportedSchema(Int)
  case unreadableLedger
  case conflictingEventIdentifier(existingSessionID: UUID)
  case couldNotPersist
}
