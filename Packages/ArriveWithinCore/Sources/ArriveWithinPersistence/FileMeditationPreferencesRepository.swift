import ArriveWithinMeditation
import Foundation

public actor FileMeditationPreferencesRepository: MeditationPreferencesRepository {
  private let fileURL: URL
  private let fileManager: FileManager
  private let encoder: JSONEncoder
  private let decoder: JSONDecoder

  public init(fileURL: URL, fileManager: FileManager = .default) {
    self.fileURL = fileURL
    self.fileManager = fileManager
    self.encoder = JSONEncoder()
    self.encoder.outputFormatting = [.sortedKeys]
    self.decoder = JSONDecoder()
  }

  public func loadTimerPreferences() throws -> TimerPreferences {
    guard fileManager.fileExists(atPath: fileURL.path) else { return .standard }
    do {
      return try decoder.decode(TimerPreferences.self, from: Data(contentsOf: fileURL))
    } catch let error as MeditationConfigurationError {
      throw error
    } catch {
      throw FilePersistenceError.unreadableLedger
    }
  }

  public func saveTimerPreferences(_ preferences: TimerPreferences) throws {
    let directory = fileURL.deletingLastPathComponent()
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    do {
      try encoder.encode(preferences).write(to: fileURL, options: .atomic)
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
