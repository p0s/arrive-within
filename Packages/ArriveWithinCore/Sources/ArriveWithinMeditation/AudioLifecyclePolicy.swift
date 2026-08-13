import ArriveWithinDomain
import Foundation

public enum MeditationAudioSystemEvent: Equatable, Sendable {
  case interruptionBegan
  case interruptionEnded
  case outputRouteLost
  case outputRouteAvailable
  case engineConfigurationChanged
  case mediaServicesReset
}

public enum MeditationAudioSystemAction: Equatable, Sendable {
  case pauseSession
  case stopPlayback
  case rebuildPlayback
  case resumePlayback
  case waitForUserResume
  case noChange
}

public enum AudioLifecyclePolicy {
  public static func actions(
    for mode: PracticeMode?,
    phase: MeditationSession.Phase?,
    event: MeditationAudioSystemEvent
  ) -> [MeditationAudioSystemAction] {
    let isRunning = phase == .running
    let keepsTimingWithoutAudio = mode == .timer || mode == .stopwatch

    switch event {
    case .interruptionBegan, .outputRouteLost:
      guard isRunning else { return [.stopPlayback] }
      if keepsTimingWithoutAudio {
        return [.stopPlayback, .rebuildPlayback]
      }
      return [.pauseSession, .stopPlayback, .waitForUserResume]

    case .interruptionEnded, .outputRouteAvailable:
      if isRunning, keepsTimingWithoutAudio { return [.resumePlayback] }
      return phase == .paused ? [.waitForUserResume] : [.noChange]

    case .engineConfigurationChanged, .mediaServicesReset:
      if isRunning {
        if keepsTimingWithoutAudio {
          return [.stopPlayback, .rebuildPlayback, .resumePlayback]
        }
        return [.pauseSession, .stopPlayback, .rebuildPlayback, .waitForUserResume]
      }
      return [.stopPlayback, .rebuildPlayback]
    }
  }
}
