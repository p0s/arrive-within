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
  func loadGardenRenderStyle() async throws -> GardenRenderStyle
  func saveGardenRenderStyle(_ style: GardenRenderStyle) async throws
  func deleteAll() async throws
}

actor EphemeralAppSettingsRepository: AppSettingsRepository {
  private var language: AppLanguage
  private var gardenRenderStyle: GardenRenderStyle

  init(language: AppLanguage = .system, gardenRenderStyle: GardenRenderStyle = .twilight) {
    self.language = language
    self.gardenRenderStyle = gardenRenderStyle
  }

  func loadLanguage() -> AppLanguage { language }

  func saveLanguage(_ language: AppLanguage) {
    self.language = language
  }

  func loadGardenRenderStyle() -> GardenRenderStyle { gardenRenderStyle }

  func saveGardenRenderStyle(_ style: GardenRenderStyle) { gardenRenderStyle = style }

  func deleteAll() {
    language = .system
    gardenRenderStyle = .twilight
  }
}

actor FileAppSettingsRepository: AppSettingsRepository {
  private struct Envelope: Codable {
    let schemaVersion: Int
    let language: AppLanguage
    let gardenRenderStyle: GardenRenderStyle?
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
      guard (1...2).contains(envelope.schemaVersion) else { throw AppSettingsError.unsupportedSchema }
      return envelope.language
    } catch let error as AppSettingsError {
      throw error
    } catch {
      throw AppSettingsError.unreadable
    }
  }

  func saveLanguage(_ language: AppLanguage) throws {
    let style = (try? loadGardenRenderStyle()) ?? .twilight
    try write(language: language, gardenRenderStyle: style)
  }

  func loadGardenRenderStyle() throws -> GardenRenderStyle {
    guard fileManager.fileExists(atPath: fileURL.path) else { return .twilight }
    do {
      let envelope = try JSONDecoder().decode(Envelope.self, from: Data(contentsOf: fileURL))
      guard (1...2).contains(envelope.schemaVersion) else { throw AppSettingsError.unsupportedSchema }
      return envelope.gardenRenderStyle ?? .twilight
    } catch let error as AppSettingsError {
      throw error
    } catch {
      throw AppSettingsError.unreadable
    }
  }

  func saveGardenRenderStyle(_ style: GardenRenderStyle) throws {
    let language = (try? loadLanguage()) ?? .system
    try write(language: language, gardenRenderStyle: style)
  }

  private func write(language: AppLanguage, gardenRenderStyle: GardenRenderStyle) throws {
    do {
      try fileManager.createDirectory(
        at: fileURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
      try encoder.encode(
        Envelope(schemaVersion: 2, language: language, gardenRenderStyle: gardenRenderStyle)
      )
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
