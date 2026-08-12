import ArriveWithinContent
import Foundation

public actor FileGuidedFavoritesRepository: GuidedFavoritesRepository {
  private struct Envelope: Codable, Sendable {
    let schemaVersion: Int
    let identifiers: [String]
  }

  private let fileURL: URL
  private let fileManager: FileManager

  public init(fileURL: URL, fileManager: FileManager = .default) {
    self.fileURL = fileURL
    self.fileManager = fileManager
  }

  public func loadFavoritePracticeIDs() throws -> Set<String> {
    guard fileManager.fileExists(atPath: fileURL.path) else { return [] }
    do {
      let envelope = try JSONDecoder().decode(Envelope.self, from: Data(contentsOf: fileURL))
      guard envelope.schemaVersion == 1 else {
        throw FilePersistenceError.unsupportedSchema(envelope.schemaVersion)
      }
      guard
        envelope.identifiers.allSatisfy({
          $0.range(of: #"^G(?:0[1-9]|[1-3][0-9]|4[0-2])$"#, options: .regularExpression)
            != nil
        })
      else {
        throw FilePersistenceError.unreadableLedger
      }
      return Set(envelope.identifiers)
    } catch let error as FilePersistenceError {
      throw error
    } catch {
      throw FilePersistenceError.unreadableLedger
    }
  }

  public func saveFavoritePracticeIDs(_ identifiers: Set<String>) throws {
    let directory = fileURL.deletingLastPathComponent()
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    do {
      let envelope = Envelope(schemaVersion: 1, identifiers: identifiers.sorted())
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
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
}
