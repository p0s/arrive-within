import ArriveWithinDomain
import ArriveWithinGardenBridge
import CoreFoundation
import Foundation

enum RendererDiagnosticCode: String, Codable, Equatable, Sendable {
  case ready
  case snapshotApplied = "snapshot-applied"
  case contextLost = "context-lost"
  case contextRestored = "context-restored"
  case contextRecoveryTimedOut = "context-recovery-timed-out"
  case startupFailed = "startup-failed"
  case invalidSnapshot = "invalid-snapshot"
  case bundleValidationFailed = "bundle-validation-failed"
  case navigationBlocked = "navigation-blocked"
  case webContentProcessTerminated = "web-content-process-terminated"
  case memoryPressureFallback = "memory-pressure-fallback"
  case snapshotEncodingFailed = "snapshot-encoding-failed"
  case snapshotDisplayFailed = "snapshot-display-failed"
  case viewResetFailed = "view-reset-failed"
  case testContextInjectionUnavailable = "test-context-injection-unavailable"
}

enum RendererObservation: Equatable, Sendable {
  case diagnostic(RendererDiagnosticCode)
  case error(RendererDiagnosticCode)
  case performance(frameMilliseconds: Double)
  case selectedQuality(GardenQualityHint)
  case inventory(RendererInventory)
}

struct RendererInventory: Codable, Equatable, Sendable {
  let direction: String
  let drawCalls: Int
  let triangles: Int
  let geometries: Int
  let textures: Int
  let programs: Int
  let rebuildCount: Int
  let context: String
  let effectivePixelRatio: Double
}

enum ValidatedRendererEvent: Equatable, Sendable {
  case ready
  case interaction
  case observation(RendererObservation)
}

enum RendererEventValidator {
  static func decode(_ body: [String: Any]) -> ValidatedRendererEvent? {
    guard Set(body.keys) == ["type", "schemaVersion", "requestID", "payload"],
      JSONSerialization.isValidJSONObject(body),
      let encodedBody = try? JSONSerialization.data(withJSONObject: body),
      encodedBody.count <= GardenBridgeCodec.maximumMessageBytes,
      body["schemaVersion"] as? Int == GardenState.currentSchemaVersion,
      let type = body["type"] as? String,
      let requestID = body["requestID"] as? String,
      UUID(uuidString: requestID) != nil,
      let payload = body["payload"] as? [String: Any]
    else { return nil }

    switch type {
    case "ready":
      guard Set(payload.keys) == ["webgl2"], payload["webgl2"] as? Bool == true
      else { return nil }
      return .ready
    case "interaction":
      guard Set(payload.keys) == ["kind"],
        let kind = payload["kind"] as? String,
        ["orbit", "reset"].contains(kind)
      else { return nil }
      return .interaction
    case "performance":
      guard Set(payload.keys) == ["frameMilliseconds"],
        let frameMilliseconds = finiteDouble(payload["frameMilliseconds"]),
        (0...100).contains(frameMilliseconds)
      else { return nil }
      return .observation(.performance(frameMilliseconds: frameMilliseconds))
    case "selected-quality":
      guard Set(payload.keys) == ["quality", "reason"],
        let rawQuality = payload["quality"] as? String,
        let quality = GardenQualityHint(rawValue: rawQuality),
        let reason = payload["reason"] as? String,
        ["frame-budget", "state-ceiling"].contains(reason)
      else { return nil }
      return .observation(.selectedQuality(quality))
    case "inventory":
      guard
        Set(payload.keys) == [
          "direction", "drawCalls", "triangles", "geometries", "textures",
          "programs", "rebuildCount", "context", "effectivePixelRatio",
        ],
        payload["direction"] as? String == "twilight-refuge",
        let drawCalls = boundedInteger(payload["drawCalls"], range: 0...10_000),
        let triangles = boundedInteger(payload["triangles"], range: 0...10_000_000),
        let geometries = boundedInteger(payload["geometries"], range: 0...100_000),
        let textures = boundedInteger(payload["textures"], range: 0...100_000),
        let programs = boundedInteger(payload["programs"], range: 0...100_000),
        let rebuildCount = boundedInteger(payload["rebuildCount"], range: 0...100_000),
        let context = payload["context"] as? String,
        ["available", "lost", "disposed"].contains(context),
        let effectivePixelRatio = finiteDouble(payload["effectivePixelRatio"]),
        (0.25...4).contains(effectivePixelRatio)
      else { return nil }
      return .observation(
        .inventory(
          RendererInventory(
            direction: "twilight-refuge",
            drawCalls: drawCalls,
            triangles: triangles,
            geometries: geometries,
            textures: textures,
            programs: programs,
            rebuildCount: rebuildCount,
            context: context,
            effectivePixelRatio: effectivePixelRatio
          )
        )
      )
    case "diagnostic":
      guard Set(payload.keys) == ["code"],
        let rawCode = payload["code"] as? String,
        let code = RendererDiagnosticCode(rawValue: rawCode),
        [.snapshotApplied, .contextLost, .contextRestored].contains(code)
      else { return nil }
      return .observation(.diagnostic(code))
    case "error":
      let allowedKeys: Set<String> = ["code", "message", "recoverable"]
      guard Set(payload.keys).isSubset(of: allowedKeys),
        let rawCode = payload["code"] as? String,
        let code = RendererDiagnosticCode(rawValue: rawCode),
        [.startupFailed, .invalidSnapshot].contains(code),
        payload["recoverable"] as? Bool != nil,
        (payload["message"] as? String).map({ $0.count <= 160 }) ?? true
      else { return nil }
      return .observation(.error(code))
    default:
      return nil
    }
  }

  private static func finiteDouble(_ value: Any?) -> Double? {
    guard let number = value as? NSNumber,
      CFGetTypeID(number) != CFBooleanGetTypeID()
    else { return nil }
    let value = number.doubleValue
    return value.isFinite ? value : nil
  }

  private static func boundedInteger(_ value: Any?, range: ClosedRange<Int>) -> Int? {
    guard let number = value as? NSNumber,
      CFGetTypeID(number) != CFBooleanGetTypeID()
    else { return nil }
    let double = number.doubleValue
    guard double.isFinite, double.rounded() == double,
      double >= Double(range.lowerBound), double <= Double(range.upperBound)
    else { return nil }
    return Int(double)
  }
}

struct RendererDiagnosticRecord: Codable, Equatable, Sendable {
  enum Kind: String, Codable, Sendable {
    case diagnostic
    case error
    case performance
    case selectedQuality = "selected-quality"
  }

  let sequence: Int
  let kind: Kind
  let code: RendererDiagnosticCode?
  let frameMilliseconds: Double?
  let quality: GardenQualityHint?
}

struct RendererDiagnosticsSnapshot: Codable, Equatable, Sendable {
  let schemaVersion: Int
  let rendererContractVersion: Int
  let rendererReady: Bool
  let nativeFallbackActive: Bool
  let selectedQuality: GardenQualityHint
  let contextRecoveryCount: Int
  let latestInventory: RendererInventory?
  let records: [RendererDiagnosticRecord]
}

struct RendererDiagnosticsRecorder: Sendable {
  static let maximumRecordCount = 32

  private(set) var records: [RendererDiagnosticRecord] = []
  private(set) var latestInventory: RendererInventory?
  private var nextSequence = 1

  mutating func record(_ observation: RendererObservation) {
    let record: RendererDiagnosticRecord
    switch observation {
    case .inventory(let inventory):
      latestInventory = inventory
      return
    case .diagnostic(let code):
      record = RendererDiagnosticRecord(
        sequence: nextSequence,
        kind: .diagnostic,
        code: code,
        frameMilliseconds: nil,
        quality: nil
      )
    case .error(let code):
      record = RendererDiagnosticRecord(
        sequence: nextSequence,
        kind: .error,
        code: code,
        frameMilliseconds: nil,
        quality: nil
      )
    case .performance(let frameMilliseconds):
      let bounded = min(1_000, max(0, frameMilliseconds))
      record = RendererDiagnosticRecord(
        sequence: nextSequence,
        kind: .performance,
        code: nil,
        frameMilliseconds: (bounded * 10).rounded() / 10,
        quality: nil
      )
    case .selectedQuality(let quality):
      record = RendererDiagnosticRecord(
        sequence: nextSequence,
        kind: .selectedQuality,
        code: nil,
        frameMilliseconds: nil,
        quality: quality
      )
    }
    nextSequence += 1
    records.append(record)
    if records.count > Self.maximumRecordCount {
      records.removeFirst(records.count - Self.maximumRecordCount)
    }
  }

  func snapshot(
    rendererReady: Bool,
    nativeFallbackActive: Bool,
    selectedQuality: GardenQualityHint,
    contextRecoveryCount: Int
  ) -> RendererDiagnosticsSnapshot {
    RendererDiagnosticsSnapshot(
      schemaVersion: 1,
      rendererContractVersion: GardenState.currentSchemaVersion,
      rendererReady: rendererReady,
      nativeFallbackActive: nativeFallbackActive,
      selectedQuality: selectedQuality,
      contextRecoveryCount: max(0, contextRecoveryCount),
      latestInventory: latestInventory,
      records: records
    )
  }
}

enum RendererDiagnosticsExporter {
  static let maximumByteCount = 32 * 1_024

  static func export(_ snapshot: RendererDiagnosticsSnapshot, to outputURL: URL) throws {
    guard outputURL.pathExtension.lowercased() == "json" else {
      throw RendererDiagnosticsExportError.invalidDestination
    }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    let data = try encoder.encode(snapshot)
    guard data.count <= maximumByteCount else {
      throw RendererDiagnosticsExportError.reportTooLarge
    }
    try data.write(to: outputURL, options: .atomic)
  }
}

enum RendererDiagnosticsExportError: Error, Equatable {
  case invalidDestination
  case reportTooLarge
}
