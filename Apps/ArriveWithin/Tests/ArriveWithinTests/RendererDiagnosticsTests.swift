import ArriveWithinDomain
import Foundation
import Testing

@testable import ArriveWithin

@Suite("Bounded renderer diagnostics")
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

    #expect(recorder.records.count == RendererDiagnosticsRecorder.maximumRecordCount)
    #expect(recorder.records.last?.frameMilliseconds == 39)
    #expect(recorder.latestInventory?.direction == "twilight-refuge")
    #expect(recorder.latestInventory?.drawCalls == 42)
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

    #expect(recorder.records.count == RendererDiagnosticsRecorder.maximumRecordCount)
    #expect(recorder.latestInventory?.direction == "twilight-refuge")
    #expect(recorder.latestInventory?.rebuildCount == 21)
    #expect(recorder.latestInventory?.context == "available")
  }
}
