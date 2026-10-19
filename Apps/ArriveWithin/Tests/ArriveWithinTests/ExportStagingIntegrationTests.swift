import Foundation
import XCTest

@testable import ArriveWithinPersistence

final class ExportStagingIntegrationTests: XCTestCase {
  func testPreparedExportRootReadsBackProtectionAndBackupExclusionOnIOS() throws {
    let parent = FileManager.default.temporaryDirectory
      .appending(path: "arrive-within-ios-export-staging-\(UUID().uuidString)")
    let root = parent.appending(path: "exports")
    defer { try? FileManager.default.removeItem(at: parent) }

    let manager = try ExportStagingManager(root: root)
    _ = try manager.prepare(named: "arrive-within-complete-1000.zip")

    let resourceValues = try root.resourceValues(forKeys: [.isExcludedFromBackupKey])
    XCTAssertEqual(resourceValues.isExcludedFromBackup, true)

    let attributes = try FileManager.default.attributesOfItem(atPath: root.path)
    #if targetEnvironment(simulator)
      XCTAssertTrue(
        attributes[.protectionKey] == nil
          || attributes[.protectionKey] as? FileProtectionType == .complete
      )
    #else
      XCTAssertEqual(attributes[.protectionKey] as? FileProtectionType, .complete)
    #endif
  }
}
