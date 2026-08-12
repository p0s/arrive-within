import ArriveWithinDomain
import Foundation
import Testing

@testable import ArriveWithin

@Suite("Redacted renderer diagnostics")
struct RendererDiagnosticsTests {
  @Test("Incoming events require the exact bounded typed bridge contract")
  func incomingEventContract() throws {
    let requestID = "60000000-0000-4000-8000-000000000001"
    #expect(
      RendererEventValidator.decode([
        "type": "diagnostic",
        "schemaVersion": 1,
        "requestID": requestID,
        "payload": ["code": "context-lost"],
      ]) == .observation(.diagnostic(.contextLost))
    )
    #expect(
      RendererEventValidator.decode([
        "type": "performance",
        "schemaVersion": 1,
        "requestID": requestID,
        "payload": ["frameMilliseconds": 12.4],
      ]) == .observation(.performance(frameMilliseconds: 12.4))
    )
    #expect(
      RendererEventValidator.decode([
        "type": "selected-quality",
        "schemaVersion": 1,
        "requestID": requestID,
        "payload": ["quality": "low", "reason": "frame-budget"],
      ]) == .observation(.selectedQuality(.low))
    )
    #expect(
      RendererEventValidator.decode([
        "type": "inventory",
        "schemaVersion": 1,
        "requestID": requestID,
        "payload": [
          "direction": "twilight-refuge",
          "drawCalls": 42,
          "triangles": 8_100,
          "geometries": 18,
          "textures": 6,
          "programs": 4,
          "rebuildCount": 1,
          "context": "available",
          "effectivePixelRatio": 2.0,
        ],
      ])
        == .observation(
          .inventory(
            RendererInventory(
              direction: "twilight-refuge",
              drawCalls: 42,
              triangles: 8_100,
              geometries: 18,
              textures: 6,
              programs: 4,
              rebuildCount: 1,
              context: "available",
              effectivePixelRatio: 2
            )
          )
        )
    )
  }

  @Test("Incoming events reject extra fields, booleans as timings, unknown codes, and invalid IDs")
  func incomingEventRejections() {
    let requestID = "60000000-0000-4000-8000-000000000001"
    let base: [String: Any] = [
      "type": "performance",
      "schemaVersion": 1,
      "requestID": requestID,
      "payload": ["frameMilliseconds": 8.2],
    ]
    var extra = base
    extra["journalText"] = "must never cross the renderer bridge"
    #expect(RendererEventValidator.decode(extra) == nil)
    #expect(
      RendererEventValidator.decode([
        "type": "performance",
        "schemaVersion": 1,
        "requestID": requestID,
        "payload": ["frameMilliseconds": true],
      ]) == nil
    )
    #expect(
      RendererEventValidator.decode([
        "type": "diagnostic",
        "schemaVersion": 1,
        "requestID": requestID,
        "payload": ["code": "journal-exported"],
      ]) == nil
    )
    var invalidID = base
    invalidID["requestID"] = "latest"
    #expect(RendererEventValidator.decode(invalidID) == nil)
    #expect(
      RendererEventValidator.decode([
        "type": "inventory",
        "schemaVersion": 1,
        "requestID": requestID,
        "payload": [
          "direction": "twilight-refuge",
          "drawCalls": -1,
          "triangles": 8_100,
          "geometries": 18,
          "textures": 6,
          "programs": 4,
          "rebuildCount": 1,
          "context": "available",
          "effectivePixelRatio": 2.0,
        ],
      ]) == nil
    )
  }

  @Test("The recorder is bounded, rounds timing, and preserves only typed safe fields")
  func boundedTypedRecords() throws {
    var recorder = RendererDiagnosticsRecorder()
    recorder.record(.diagnostic(.contextLost))
    recorder.record(.performance(frameMilliseconds: 12.345))
    recorder.record(.selectedQuality(.low))
    recorder.record(.diagnostic(.contextRestored))
    recorder.record(
      .inventory(
        RendererInventory(
          direction: "twilight-refuge",
          drawCalls: 42,
          triangles: 8_100,
          geometries: 18,
          textures: 6,
          programs: 4,
          rebuildCount: 1,
          context: "available",
          effectivePixelRatio: 2
        )
      )
    )
    for value in 0..<40 {
      recorder.record(.performance(frameMilliseconds: Double(value)))
    }

    let snapshot = recorder.snapshot(
      rendererReady: true,
      nativeFallbackActive: false,
      selectedQuality: .low,
      contextRecoveryCount: 1
    )

    #expect(snapshot.records.count == RendererDiagnosticsRecorder.maximumRecordCount)
    #expect(snapshot.records.last?.frameMilliseconds == 39)
    #expect(snapshot.contextRecoveryCount == 1)
    #expect(snapshot.latestInventory?.direction == "twilight-refuge")
    #expect(snapshot.latestInventory?.drawCalls == 42)
  }

  @Test("Twenty recovery inventories stay bounded and return to one selected world")
  func repeatedRecoveryInventory() throws {
    var recorder = RendererDiagnosticsRecorder()
    for cycle in 1...20 {
      recorder.record(.diagnostic(.contextLost))
      recorder.record(.diagnostic(.contextRestored))
      recorder.record(
        .inventory(
          RendererInventory(
            direction: "twilight-refuge",
            drawCalls: 42,
            triangles: 8_100,
            geometries: 18,
            textures: 6,
            programs: 4,
            rebuildCount: cycle + 1,
            context: "available",
            effectivePixelRatio: 2
          )
        )
      )
    }

    let snapshot = recorder.snapshot(
      rendererReady: true,
      nativeFallbackActive: false,
      selectedQuality: .balanced,
      contextRecoveryCount: 20
    )
    #expect(snapshot.records.count == RendererDiagnosticsRecorder.maximumRecordCount)
    #expect(snapshot.contextRecoveryCount == 20)
    #expect(snapshot.latestInventory?.direction == "twilight-refuge")
    #expect(snapshot.latestInventory?.rebuildCount == 21)
    #expect(snapshot.latestInventory?.context == "available")
  }

  @Test("Export contains no product identifiers, journal content, or exact timestamps")
  func exportIsPublicSafeAndSmall() throws {
    var recorder = RendererDiagnosticsRecorder()
    recorder.record(.diagnostic(.ready))
    recorder.record(.error(.contextRecoveryTimedOut))
    recorder.record(.performance(frameMilliseconds: 8.27))
    let snapshot = recorder.snapshot(
      rendererReady: false,
      nativeFallbackActive: true,
      selectedQuality: .balanced,
      contextRecoveryCount: 0
    )
    let outputURL = FileManager.default.temporaryDirectory
      .appending(path: "renderer-diagnostics-\(UUID().uuidString).json")
    try RendererDiagnosticsExporter.export(snapshot, to: outputURL)
    let data = try Data(contentsOf: outputURL)
    let text = try #require(String(data: data, encoding: .utf8))

    #expect(data.count <= RendererDiagnosticsExporter.maximumByteCount)
    #expect(text.contains("context-recovery-timed-out"))
    #expect(!text.contains("gardenID"))
    #expect(!text.contains("profileGenerationID"))
    #expect(!text.contains("journal"))
    #expect(!text.contains("practiceEvent"))
    #expect(!text.contains("timestamp"))
  }
}
