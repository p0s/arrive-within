import Foundation
import Testing

@testable import ArriveWithin

@Suite("Device-local app settings")
struct AppSettingsTests {
  @Test("Deleting settings removes the file and restores system language")
  func deleteAllSettings() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-settings-delete-\(UUID().uuidString)")
    let file = directory.appending(path: "app-settings-v1.json")
    defer { try? FileManager.default.removeItem(at: directory) }
    let repository = FileAppSettingsRepository(fileURL: file)
    try await repository.saveLanguage(.german)
    #expect(FileManager.default.fileExists(atPath: file.path))
    try await repository.deleteAll()
    #expect(!FileManager.default.fileExists(atPath: file.path))
    #expect(try await repository.loadLanguage() == .system)
  }

  @Test("Explicit app locale selects the matching localization bundle")
  func explicitLocaleLocalization() {
    #expect(
      AppLocalization.string("guided.results.count.format", locale: Locale(identifier: "en_US"))
        == "%d practices"
    )
    #expect(
      AppLocalization.string("guided.results.count.format", locale: Locale(identifier: "de_DE"))
        == "%d Meditationen"
    )
    #expect(
      AppLocalization.string("notification.reminder.title", locale: Locale(identifier: "de_DE"))
        == "Ein Moment für dich"
    )
  }

  @Test("Language defaults to System and reopens from deterministic JSON")
  func languageRoundTrip() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let file = directory.appending(path: "app-settings-v1.json")
    defer { try? FileManager.default.removeItem(at: directory) }

    let repository = FileAppSettingsRepository(fileURL: file)
    #expect(try await repository.loadLanguage() == .system)

    try await repository.saveLanguage(.german)
    #expect(try await FileAppSettingsRepository(fileURL: file).loadLanguage() == .german)
    #expect(String(decoding: try Data(contentsOf: file), as: UTF8.self)
      == #"{"language":"german","schemaVersion":1}"#)

    let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
    #if targetEnvironment(simulator)
      // CoreSimulator accepts the protection request but does not expose the attribute.
      #expect(
        attributes[.protectionKey] == nil
          || attributes[.protectionKey] as? FileProtectionType
            == .completeUntilFirstUserAuthentication
      )
    #else
    #expect(
      attributes[.protectionKey] as? FileProtectionType
        == .completeUntilFirstUserAuthentication
    )
    #endif
  }

  @Test("Unsupported and malformed settings never become an implicit language choice")
  func invalidSettingsAreRejected() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let file = directory.appending(path: "app-settings-v1.json")
    defer { try? FileManager.default.removeItem(at: directory) }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

    try Data(#"{"language":"english","schemaVersion":2}"#.utf8).write(to: file)
    do {
      _ = try await FileAppSettingsRepository(fileURL: file).loadLanguage()
      Issue.record("Unsupported settings schema unexpectedly loaded")
    } catch let error as AppSettingsError {
      #expect(error == .unsupportedSchema)
    }

    try Data("not-json".utf8).write(to: file)
    do {
      _ = try await FileAppSettingsRepository(fileURL: file).loadLanguage()
      Issue.record("Malformed settings unexpectedly loaded")
    } catch let error as AppSettingsError {
      #expect(error == .unreadable)
    }
  }
}
