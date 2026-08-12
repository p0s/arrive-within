import ArriveWithinMeditation
import Foundation

public actor FileMeditationSessionRepository: MeditationSessionRepository {
  private struct Envelope: Codable, Sendable {
    let schemaVersion: Int
    var sessions: [MeditationSession]
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

  public func activeSession(profileGenerationID: UUID) throws -> MeditationSession? {
    try load().sessions
      .filter {
        $0.profileGenerationID == profileGenerationID
          && [.prepared, .running, .paused, .completing].contains($0.phase)
      }
      .sorted { $0.preparedAt > $1.preparedAt }
      .first
  }

  public func save(_ session: MeditationSession) throws {
    var envelope = try load()
    envelope.sessions.removeAll {
      $0.id == session.id || $0.profileGenerationID == session.profileGenerationID
    }
    envelope.sessions.append(session)
    try persist(envelope)
  }

  public func remove(sessionID: UUID, profileGenerationID: UUID) throws {
    var envelope = try load()
    envelope.sessions.removeAll {
      $0.id == sessionID && $0.profileGenerationID == profileGenerationID
    }
    try persist(envelope)
  }

  private func load() throws -> Envelope {
    guard fileManager.fileExists(atPath: fileURL.path) else {
      return Envelope(schemaVersion: 1, sessions: [])
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

  private func persist(_ envelope: Envelope) throws {
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
