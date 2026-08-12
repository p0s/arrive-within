import Foundation
import XCTest

@testable import ArriveWithin

final class AppDataDirectoryPreparerTests: XCTestCase {
  func testPrepareCreatesMissingDirectoryAndIsIdempotent() throws {
    let root = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-data-directory-test-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: root) }

    XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
    try AppDataDirectoryPreparer.prepare(root)
    try AppDataDirectoryPreparer.prepare(root)

    var isDirectory: ObjCBool = false
    XCTAssertTrue(FileManager.default.fileExists(atPath: root.path, isDirectory: &isDirectory))
    XCTAssertTrue(isDirectory.boolValue)
  }
}
