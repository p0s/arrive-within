import ArriveWithinDomain
import Foundation

public enum GardenBridgeMessageType: String, Codable, Sendable {
  case stateSnapshot = "state-snapshot"
  case stateDelta = "state-delta"
  case ready
  case interaction
  case performance
  case selectedQuality = "selected-quality"
  case diagnostic
  case error
}

public struct GardenBridgeEnvelope<Payload: Codable & Sendable>: Codable, Sendable {
  public let type: GardenBridgeMessageType
  public let schemaVersion: Int
  public let requestID: UUID
  public let payload: Payload

  public init(
    type: GardenBridgeMessageType,
    schemaVersion: Int = GardenState.currentSchemaVersion,
    requestID: UUID,
    payload: Payload
  ) {
    self.type = type
    self.schemaVersion = schemaVersion
    self.requestID = requestID
    self.payload = payload
  }
}

public struct GardenSnapshotPayload: Codable, Sendable {
  public let state: GardenState

  public init(state: GardenState) {
    self.state = state
  }
}

public enum GardenBridgeCodec {
  public static let maximumMessageBytes = 64 * 1_024

  public static func encodeSnapshot(
    _ state: GardenState,
    requestID: UUID
  ) throws -> Data {
    guard state.schemaVersion == GardenState.currentSchemaVersion else {
      throw GardenBridgeError.unsupportedSchema(state.schemaVersion)
    }
    let envelope = GardenBridgeEnvelope(
      type: GardenBridgeMessageType.stateSnapshot,
      requestID: requestID,
      payload: GardenSnapshotPayload(state: state)
    )
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .millisecondsSince1970
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(envelope)
    guard data.count <= maximumMessageBytes else {
      throw GardenBridgeError.messageTooLarge(actualBytes: data.count)
    }
    return data
  }

  public static func decodeSnapshot(_ data: Data) throws -> GardenBridgeEnvelope<GardenSnapshotPayload> {
    guard data.count <= maximumMessageBytes else {
      throw GardenBridgeError.messageTooLarge(actualBytes: data.count)
    }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .millisecondsSince1970
    let envelope = try decoder.decode(GardenBridgeEnvelope<GardenSnapshotPayload>.self, from: data)
    guard envelope.type == .stateSnapshot else {
      throw GardenBridgeError.unexpectedMessageType(envelope.type)
    }
    guard envelope.schemaVersion == GardenState.currentSchemaVersion,
      envelope.payload.state.schemaVersion == GardenState.currentSchemaVersion
    else {
      throw GardenBridgeError.unsupportedSchema(envelope.schemaVersion)
    }
    return envelope
  }
}

public enum GardenBridgeError: Error, Equatable, Sendable {
  case messageTooLarge(actualBytes: Int)
  case unsupportedSchema(Int)
  case unexpectedMessageType(GardenBridgeMessageType)
}
