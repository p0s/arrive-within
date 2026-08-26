@preconcurrency import ActivityKit
import ArriveWithinDomain
import Foundation
import UIKit

struct MeditationLiveActivitySnapshot: Equatable, Sendable {
  enum Phase: Equatable, Sendable {
    case running
    case paused
  }

  let sessionID: UUID
  let mode: PracticeMode
  let modeName: String
  let timerLabel: String
  let statusName: String
  let phase: Phase
  let elapsedMilliseconds: Int64
  let targetDurationMilliseconds: Int64?
  let runningSince: Date?
}

@MainActor
protocol MeditationLiveActivityControlling: AnyObject {
  func synchronize(_ snapshot: MeditationLiveActivitySnapshot) async
  func end(sessionID: UUID) async
  func endAll() async
}

@MainActor
final class NoOpMeditationLiveActivityController: MeditationLiveActivityControlling {
  func synchronize(_ snapshot: MeditationLiveActivitySnapshot) async { _ = snapshot }
  func end(sessionID: UUID) async { _ = sessionID }
  func endAll() async {}
}

@MainActor
final class SystemMeditationLiveActivityController: MeditationLiveActivityControlling {
  func synchronize(_ snapshot: MeditationLiveActivitySnapshot) async {
    guard UIDevice.current.userInterfaceIdiom == .phone else { return }

    for activity in Activity<MeditationActivityAttributes>.activities
    where activity.attributes.sessionID != snapshot.sessionID {
      await activity.end(nil, dismissalPolicy: .immediate)
    }

    let content = ActivityContent(state: contentState(for: snapshot), staleDate: nil)
    if let activity = Activity<MeditationActivityAttributes>.activities.first(
      where: { $0.attributes.sessionID == snapshot.sessionID }
    ) {
      await activity.update(content)
      return
    }

    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    _ = try? Activity.request(
      attributes: MeditationActivityAttributes(sessionID: snapshot.sessionID),
      content: content,
      pushType: nil
    )
  }

  func end(sessionID: UUID) async {
    for activity in Activity<MeditationActivityAttributes>.activities
    where activity.attributes.sessionID == sessionID {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }

  func endAll() async {
    for activity in Activity<MeditationActivityAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }

  private func contentState(
    for snapshot: MeditationLiveActivitySnapshot
  ) -> MeditationActivityAttributes.ContentState {
    MeditationActivityAttributes.ContentState(
      modeName: snapshot.modeName,
      timerLabel: snapshot.timerLabel,
      statusName: snapshot.statusName,
      phase: snapshot.phase == .running ? .running : .paused,
      elapsedMilliseconds: snapshot.elapsedMilliseconds,
      targetDurationMilliseconds: snapshot.targetDurationMilliseconds,
      runningSince: snapshot.phase == .running ? snapshot.runningSince : nil
    )
  }
}
