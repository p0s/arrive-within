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
  case waitForUserResume
  case noChange
}

public enum AudioLifecyclePolicy {
  public static func actions(
    for phase: MeditationSession.Phase?,
    event: MeditationAudioSystemEvent
  ) -> [MeditationAudioSystemAction] {
    let isRunning = phase == .running

    switch event {
    case .interruptionBegan, .outputRouteLost:
      guard isRunning else { return [.stopPlayback] }
      return [.pauseSession, .stopPlayback, .waitForUserResume]

    case .interruptionEnded, .outputRouteAvailable:
      return phase == .paused ? [.waitForUserResume] : [.noChange]

    case .engineConfigurationChanged, .mediaServicesReset:
      if isRunning {
        return [.pauseSession, .stopPlayback, .rebuildPlayback, .waitForUserResume]
      }
      return [.stopPlayback, .rebuildPlayback]
    }
  }
}
