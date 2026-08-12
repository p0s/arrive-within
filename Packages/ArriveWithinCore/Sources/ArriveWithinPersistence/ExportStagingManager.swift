import Foundation

public enum ExportStagingError: Error, Equatable, Sendable {
  case unsafeRoot
  case unsafeArtifact
  case couldNotPrepare
  case couldNotClean
}

/// Owns short-lived archives prepared for an Apple share sheet. It never sees
/// or removes copies the user has shared outside this exact app-owned root.
public struct ExportStagingManager: @unchecked Sendable {
  public static let defaultTimeToLive: TimeInterval = 3_600

  public let root: URL
  private let fileManager: FileManager

  public init(root: URL, fileManager: FileManager = .default) throws {
    let normalized = root.standardizedFileURL
    guard normalized.isFileURL, normalized.path != "/", normalized.lastPathComponent == "exports"
    else {
      throw ExportStagingError.unsafeRoot
    }
    self.root = normalized
    self.fileManager = fileManager
  }

  public func prepare(named name: String, now: Date = Date()) throws -> URL {
    guard isSafeArchiveName(name) else { throw ExportStagingError.unsafeArtifact }
    try purgeExpired(before: now.addingTimeInterval(-Self.defaultTimeToLive))
    try purgeAll()
    do {
      try fileManager.createDirectory(
        at: root,
        withIntermediateDirectories: true
      )
      #if os(iOS)
        try fileManager.setAttributes(
          [.protectionKey: FileProtectionType.complete],
          ofItemAtPath: root.path
        )
      #endif
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      var mutableRoot = root
      try mutableRoot.setResourceValues(values)
      return root.appending(path: name)
    } catch {
      throw ExportStagingError.couldNotPrepare
    }
  }

  public func purgeAll() throws {
    try purge { _ in true }
  }

  public func purgeReflection(entryID: UUID) throws {
    let prefix = "arrive-within-reflection-\(entryID.uuidString.lowercased())-r"
    try purge { $0.lastPathComponent.hasPrefix(prefix) && $0.lastPathComponent.hasSuffix(".zip") }
  }

  public func purgeExpired(before cutoff: Date) throws {
    try purge { url in
      guard let createdAt = archiveCreationDate(from: url.lastPathComponent) else {
        throw ExportStagingError.unsafeArtifact
      }
      return createdAt < cutoff
    }
  }

  public func remove(_ url: URL) throws {
    let target = url.standardizedFileURL
    guard target.deletingLastPathComponent().path == root.path,
      isSafeArchiveName(target.lastPathComponent)
    else { throw ExportStagingError.unsafeArtifact }
    // UIKit completion and SwiftUI sheet dismissal can both report the same
    // completed share. Cleanup is deliberately idempotent, but an existing
    // object must still pass the regular-file and no-symlink boundary.
    guard fileManager.fileExists(atPath: target.path) else { return }
    guard isDirectRegularChild(target) else { throw ExportStagingError.unsafeArtifact }
    do {
      try fileManager.removeItem(at: target)
    } catch let error as CocoaError where error.code == .fileNoSuchFile {
      return
    } catch {
      throw ExportStagingError.couldNotClean
    }
  }

  private func purge(_ shouldRemove: (URL) throws -> Bool) throws {
    guard fileManager.fileExists(atPath: root.path) else { return }
    do {
      let rootValues = try root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
      guard rootValues.isDirectory == true, rootValues.isSymbolicLink != true else {
        throw ExportStagingError.unsafeRoot
      }
      let contents = try fileManager.contentsOfDirectory(
        at: root,
        includingPropertiesForKeys: [
          .isRegularFileKey, .isSymbolicLinkKey,
        ]
      )
      for item in contents {
        guard isDirectRegularChild(item) else { throw ExportStagingError.unsafeArtifact }
      }
      for item in contents where try shouldRemove(item) { try fileManager.removeItem(at: item) }
    } catch let error as ExportStagingError {
      throw error
    } catch {
      throw ExportStagingError.couldNotClean
    }
  }

  private func isDirectRegularChild(_ candidate: URL) -> Bool {
    let target = candidate.standardizedFileURL
    guard target.deletingLastPathComponent().path == root.path else { return false }
    do {
      let values = try target.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
      return values.isRegularFile == true && values.isSymbolicLink != true
        && target.resolvingSymlinksInPath().standardizedFileURL.path == target.path
    } catch {
      return false
    }
  }

  private func isSafeArchiveName(_ name: String) -> Bool {
    !name.isEmpty && name == URL(fileURLWithPath: name).lastPathComponent
      && name.hasPrefix("arrive-within-") && name.hasSuffix(".zip")
      && !name.contains("..") && !name.contains("/") && !name.contains("\\")
  }

  private func archiveCreationDate(from name: String) -> Date? {
    guard isSafeArchiveName(name),
      let suffix = name.dropLast(4).split(separator: "-").last
    else { return nil }
    // Versions before the staging-lifecycle hardening ended reflection names
    // at their revision. They are exact app-owned artifacts, but have no
    // trustworthy age encoded in the name, so treat them as expired instead
    // of making an upgraded app permanently fail closed at startup.
    if suffix.hasPrefix("r"), Int(suffix.dropFirst()) != nil,
      name.hasPrefix("arrive-within-reflection-")
    {
      return .distantPast
    }
    guard let milliseconds = Int64(suffix), milliseconds >= 0 else { return nil }
    return Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1_000)
  }
}
