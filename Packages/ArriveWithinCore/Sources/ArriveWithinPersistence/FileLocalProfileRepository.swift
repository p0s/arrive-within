import ArriveWithinDomain
import Foundation

public actor FileLocalProfileRepository: LocalProfileRepository {
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

  public func load() throws -> LocalProfile? {
    guard fileManager.fileExists(atPath: fileURL.path) else { return nil }
    do {
      let profile = try decoder.decode(LocalProfile.self, from: Data(contentsOf: fileURL))
      guard profile.schemaVersion == LocalProfile.currentSchemaVersion else {
        throw FilePersistenceError.unsupportedSchema(profile.schemaVersion)
      }
      return profile
    } catch let error as FilePersistenceError {
      throw error
    } catch {
      throw FilePersistenceError.unreadableLedger
    }
  }

  public func save(_ profile: LocalProfile) throws {
    let directory = fileURL.deletingLastPathComponent()
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    do {
      try encoder.encode(profile).write(to: fileURL, options: .atomic)
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
