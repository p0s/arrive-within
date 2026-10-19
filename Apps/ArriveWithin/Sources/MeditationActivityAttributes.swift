import ActivityKit
import Foundation

struct MeditationActivityAttributes: ActivityAttributes {
  enum Phase: String, Codable, Hashable {
    case running
    case paused
  }

  struct ContentState: Codable, Hashable {
    let modeName: String
    let timerLabel: String
    let statusName: String
    let phase: Phase
    let elapsedMilliseconds: Int64
    let targetDurationMilliseconds: Int64?
    let runningSince: Date?
  }

  let sessionID: UUID
}
