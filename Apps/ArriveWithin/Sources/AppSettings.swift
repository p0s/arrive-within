import Foundation

enum AppLanguage: String, Codable, CaseIterable, Identifiable, Sendable {
  case system
  case english
  case german

  var id: Self { self }

  var locale: Locale {
    switch self {
    case .system: .autoupdatingCurrent
    case .english: Locale(identifier: "en_US")
    case .german: Locale(identifier: "de_DE")
    }
  }

  var languageCode: String {
    locale.language.languageCode?.identifier == "de" ? "de" : "en"
  }
}

protocol AppSettingsRepository: Sendable {
  func loadLanguage() async throws -> AppLanguage
  func saveLanguage(_ language: AppLanguage) async throws
  func deleteAll() async throws
}

actor EphemeralAppSettingsRepository: AppSettingsRepository {
  private var language: AppLanguage

  init(language: AppLanguage = .system) {
    self.language = language
  }

  func loadLanguage() -> AppLanguage { language }

  func saveLanguage(_ language: AppLanguage) {
    self.language = language
  }

  func deleteAll() { language = .system }
}

actor FileAppSettingsRepository: AppSettingsRepository {
  private struct Envelope: Codable {
    let schemaVersion: Int
    let language: AppLanguage
  }

  private let fileURL: URL
  private let fileManager: FileManager

  init(fileURL: URL, fileManager: FileManager = .default) {
    self.fileURL = fileURL
    self.fileManager = fileManager
  }

  func loadLanguage() throws -> AppLanguage {
    guard fileManager.fileExists(atPath: fileURL.path) else { return .system }
    do {
      let envelope = try JSONDecoder().decode(Envelope.self, from: Data(contentsOf: fileURL))
      guard envelope.schemaVersion == 1 else { throw AppSettingsError.unsupportedSchema }
      return envelope.language
    } catch let error as AppSettingsError {
      throw error
    } catch {
      throw AppSettingsError.unreadable
    }
  }

  func saveLanguage(_ language: AppLanguage) throws {
    do {
      try fileManager.createDirectory(
        at: fileURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
      try encoder.encode(Envelope(schemaVersion: 1, language: language))
        .write(to: fileURL, options: .atomic)
      try fileManager.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: fileURL.path
      )
    } catch {
      throw AppSettingsError.couldNotPersist
    }
  }

  func deleteAll() throws {
    guard fileManager.fileExists(atPath: fileURL.path) else { return }
    do {
      let values = try fileURL.resourceValues(
        forKeys: [.isRegularFileKey, .isSymbolicLinkKey]
      )
      guard values.isRegularFile == true, values.isSymbolicLink != true else {
        throw AppSettingsError.couldNotPersist
      }
      try fileManager.removeItem(at: fileURL)
    } catch let error as AppSettingsError {
      throw error
    } catch {
      throw AppSettingsError.couldNotPersist
    }
  }
}

enum AppSettingsError: Error, Equatable {
  case unsupportedSchema
  case unreadable
  case couldNotPersist
}
