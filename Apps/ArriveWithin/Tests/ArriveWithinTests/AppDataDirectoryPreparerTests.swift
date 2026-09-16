import Foundation
import XCTest

@testable import ArriveWithin

final class AppDataDirectoryPreparerTests: XCTestCase {
  #if DEBUG
    func testVerificationNamespaceIsStableDistinctAndNeverUsesProductDirectory() throws {
      let support = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
      defer { try? FileManager.default.removeItem(at: support) }
      let product = support.appending(path: "ArriveWithin")
      try FileManager.default.createDirectory(at: product, withIntermediateDirectories: true)
      let sentinel = product.appending(path: "existing-data")
      try Data("preserve".utf8).write(to: sentinel)
      let namespace = UUID().uuidString
      let args = ["-ui-test-namespace", namespace]
      let root = try XCTUnwrap(
        AppDataDirectoryPreparer.verificationDirectory(in: support, arguments: args))
      XCTAssertEqual(
        root, try AppDataDirectoryPreparer.verificationDirectory(in: support, arguments: args))
      XCTAssertNotEqual(root, product)
      XCTAssertNotEqual(
        root,
        try AppDataDirectoryPreparer.verificationDirectory(
          in: support, arguments: ["-ui-test-namespace", UUID().uuidString]
        ))
      try AppDataDirectoryPreparer.prepare(root)
      XCTAssertEqual(try Data(contentsOf: sentinel), Data("preserve".utf8))
      XCTAssertNil(try AppDataDirectoryPreparer.verificationDirectory(in: support, arguments: []))
    }

    func testVerificationNamespaceRejectsMissingMalformedTraversalAndDuplicateValues() {
      let support = FileManager.default.temporaryDirectory
      for args in [
        ["-ui-test-namespace"],
        ["-ui-test-namespace", ""],
        ["-ui-test-namespace", "../ArriveWithin"],
        ["-ui-test-namespace", UUID().uuidString, "-ui-test-namespace", UUID().uuidString],
      ] {
        XCTAssertThrowsError(
          try AppDataDirectoryPreparer.verificationDirectory(in: support, arguments: args)
        ) {
          XCTAssertEqual($0 as? AppDataDirectoryPreparationError, .invalidVerificationNamespace)
        }
      }
    }
  #endif

  func testPrepareCreatesMissingDirectoryAndIsIdempotent() throws {
    let root = FileManager.default.temporaryDirectory
      .appending(
        path: "arrive-within-data-directory-test-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: root) }

    XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
    try AppDataDirectoryPreparer.prepare(root)
    try AppDataDirectoryPreparer.prepare(root)

    var isDirectory: ObjCBool = false
    XCTAssertTrue(FileManager.default.fileExists(atPath: root.path, isDirectory: &isDirectory))
    XCTAssertTrue(isDirectory.boolValue)
    XCTAssertEqual(
      try backupExclusion(at: root),
      true
    )
  }

  func testPrepareRepairsBackupExclusionOnExistingDirectory() throws {
    let root = FileManager.default.temporaryDirectory
      .appending(
        path: "arrive-within-data-directory-test-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: root) }

    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    var mutableRoot = root
    var values = URLResourceValues()
    values.isExcludedFromBackup = false
    try mutableRoot.setResourceValues(values)
    XCTAssertEqual(
      try backupExclusion(at: root),
      false
    )

    try AppDataDirectoryPreparer.prepare(root)

    XCTAssertEqual(
      try backupExclusion(at: root),
      true
    )
  }

  func testPrepareRejectsSymbolicLinkRoot() throws {
    let parent = FileManager.default.temporaryDirectory
      .appending(
        path: "arrive-within-data-directory-test-\(UUID().uuidString)", directoryHint: .isDirectory)
    let target = parent.appending(path: "target", directoryHint: .isDirectory)
    let root = parent.appending(path: "root", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: parent) }

    try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(at: root, withDestinationURL: target)

    XCTAssertThrowsError(try AppDataDirectoryPreparer.prepare(root)) { error in
      XCTAssertEqual(error as? AppDataDirectoryPreparationError, .unsafeDirectory)
    }
  }

  func testPrepareRejectsRegularFileRoot() throws {
    let root = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-data-directory-test-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    try Data("not-a-directory".utf8).write(to: root)

    XCTAssertThrowsError(try AppDataDirectoryPreparer.prepare(root)) { error in
      XCTAssertEqual(error as? AppDataDirectoryPreparationError, .unsafeDirectory)
    }
  }

  private func backupExclusion(at url: URL) throws -> Bool? {
    var refreshed = URL(fileURLWithPath: url.path, isDirectory: true)
    refreshed.removeAllCachedResourceValues()
    return try refreshed.resourceValues(
      forKeys: [.isExcludedFromBackupKey]
    ).isExcludedFromBackup
  }
}
