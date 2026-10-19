@testable import ArriveWithinPersistence
import Foundation
import Testing

@Suite("Private export staging lifecycle")
struct ExportStagingManagerTests {
  @Test("Preparing a share keeps at most one owned regular archive")
  func prepareReplacesPriorArchive() throws {
    let parent = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-staging-\(UUID().uuidString)")
    let root = parent.appending(path: "exports")
    defer { try? FileManager.default.removeItem(at: parent) }
    let manager = try ExportStagingManager(root: root)
    let first = try manager.prepare(named: "arrive-within-complete-1000.zip")
    try Data([1]).write(to: first)
    let second = try manager.prepare(named: "arrive-within-complete-2000.zip")
    #expect(!FileManager.default.fileExists(atPath: first.path))
    try Data([2]).write(to: second)
    #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).count == 1)
    // macOS SwiftPM runs in a host sandbox/filesystem that does not reliably
    // round-trip NSURLIsExcludedFromBackupKey. The shipping iOS app must prove
    // that platform resource bit in its iOS integration lane; this portable
    // suite proves the manager attempts the setting and keeps lifecycle safety.
    #if os(iOS)
      let values = try root.resourceValues(forKeys: [.isExcludedFromBackupKey])
      #expect(values.isExcludedFromBackup == true)
    #endif
    try manager.remove(second)
    try manager.remove(second)
    #expect(!FileManager.default.fileExists(atPath: second.path))
  }

  @Test("Startup expiry uses the owned filename instead of file timestamp APIs")
  func expiryUsesArchiveName() throws {
    let parent = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-staging-expiry-\(UUID().uuidString)")
    let root = parent.appending(path: "exports")
    defer { try? FileManager.default.removeItem(at: parent) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let expired = root.appending(path: "arrive-within-complete-1000.zip")
    let legacy = root.appending(path: "arrive-within-reflection-00000000-0000-0000-0000-000000000001-r1.zip")
    let retained = root.appending(path: "arrive-within-reflection-00000000-0000-0000-0000-000000000001-r2-3000.zip")
    try Data([1]).write(to: expired)
    try Data([0]).write(to: legacy)
    try Data([2]).write(to: retained)
    let manager = try ExportStagingManager(root: root)
    try manager.purgeExpired(before: Date(timeIntervalSince1970: 2))
    #expect(!FileManager.default.fileExists(atPath: expired.path))
    #expect(!FileManager.default.fileExists(atPath: legacy.path))
    #expect(FileManager.default.fileExists(atPath: retained.path))
  }

  @Test("Cleanup rejects a symlink without touching its target")
  func symlinkFailsClosed() throws {
    let parent = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-staging-link-\(UUID().uuidString)")
    let root = parent.appending(path: "exports")
    let external = parent.appending(path: "outside.zip")
    defer { try? FileManager.default.removeItem(at: parent) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try Data([9]).write(to: external)
    try FileManager.default.createSymbolicLink(
      at: root.appending(path: "arrive-within-complete-1.zip"),
      withDestinationURL: external
    )
    let manager = try ExportStagingManager(root: root)
    #expect(throws: ExportStagingError.unsafeArtifact) { try manager.purgeAll() }
    #expect(FileManager.default.fileExists(atPath: external.path))
  }

  @Test("Deleting one reflection removes every owned revision and preserves another entry")
  func purgeOneReflection() throws {
    let parent = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-staging-reflection-\(UUID().uuidString)")
    let root = parent.appending(path: "exports")
    defer { try? FileManager.default.removeItem(at: parent) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let selected = UUID(uuidString: "00000000-0000-4000-8000-000000000001")!
    let other = UUID(uuidString: "00000000-0000-4000-8000-000000000002")!
    let selectedFiles = [
      root.appending(path: "arrive-within-reflection-\(selected.uuidString.lowercased())-r1-1000.zip"),
      root.appending(path: "arrive-within-reflection-\(selected.uuidString.lowercased())-r2-2000.zip"),
    ]
    let otherFile = root.appending(
      path: "arrive-within-reflection-\(other.uuidString.lowercased())-r1-3000.zip"
    )
    for file in selectedFiles + [otherFile] { try Data([1]).write(to: file) }

    let manager = try ExportStagingManager(root: root)
    try manager.purgeReflection(entryID: selected)

    #expect(selectedFiles.allSatisfy { !FileManager.default.fileExists(atPath: $0.path) })
    #expect(FileManager.default.fileExists(atPath: otherFile.path))
  }

  @Test("Cleanup rejects a directory masquerading as an archive")
  func directoryFailsClosed() throws {
    let parent = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-staging-directory-\(UUID().uuidString)")
    let root = parent.appending(path: "exports")
    let directory = root.appending(path: "arrive-within-complete-1000.zip")
    defer { try? FileManager.default.removeItem(at: parent) }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let manager = try ExportStagingManager(root: root)
    #expect(throws: ExportStagingError.unsafeArtifact) { try manager.purgeAll() }
    #expect(FileManager.default.fileExists(atPath: directory.path))
  }
}
