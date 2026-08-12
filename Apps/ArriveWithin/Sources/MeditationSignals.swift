import Foundation
import UIKit
import UserNotifications

enum TimerEndAlertAuthorization: Equatable {
  case notDetermined
  case denied
  case authorized
}

@MainActor
protocol TimerEndAlertControlling: AnyObject {
  func authorizationState() async -> TimerEndAlertAuthorization
  func requestAuthorization() async -> TimerEndAlertAuthorization
  func schedule(sessionID: UUID, after seconds: TimeInterval, locale: Locale) async throws
  func cancel(sessionID: UUID)
}

@MainActor
final class NativeTimerEndAlertController: TimerEndAlertControlling {
  private let center: UNUserNotificationCenter

  init(center: UNUserNotificationCenter = .current()) {
    self.center = center
  }

  func authorizationState() async -> TimerEndAlertAuthorization {
    Self.map(await center.notificationSettings().authorizationStatus)
  }

  func requestAuthorization() async -> TimerEndAlertAuthorization {
    do {
      _ = try await center.requestAuthorization(options: [.alert, .sound])
      return await authorizationState()
    } catch {
      return .denied
    }
  }

  func schedule(sessionID: UUID, after seconds: TimeInterval, locale: Locale) async throws {
    guard seconds > 0 else { return }
    let content = UNMutableNotificationContent()
    content.title = AppLocalization.string("notification.timer.end.title", locale: locale)
    content.body = AppLocalization.string("notification.timer.end.body", locale: locale)
    content.sound = .default
    let request = UNNotificationRequest(
      identifier: Self.identifier(for: sessionID),
      content: content,
      trigger: UNTimeIntervalNotificationTrigger(timeInterval: max(1, seconds), repeats: false)
    )
    try await center.add(request)
  }

  func cancel(sessionID: UUID) {
    center.removePendingNotificationRequests(withIdentifiers: [Self.identifier(for: sessionID)])
  }

  private static func identifier(for sessionID: UUID) -> String {
    "arrive-within.timer-end.\(sessionID.uuidString.lowercased())"
  }

  private static func map(_ status: UNAuthorizationStatus) -> TimerEndAlertAuthorization {
    switch status {
    case .notDetermined: .notDetermined
    case .denied: .denied
    case .authorized, .provisional, .ephemeral: .authorized
    @unknown default: .denied
    }
  }
}

@MainActor
final class NoOpTimerEndAlertController: TimerEndAlertControlling {
  var authorization: TimerEndAlertAuthorization

  init(authorization: TimerEndAlertAuthorization = .authorized) {
    self.authorization = authorization
  }

  func authorizationState() async -> TimerEndAlertAuthorization { authorization }
  func requestAuthorization() async -> TimerEndAlertAuthorization { authorization }
  func schedule(sessionID: UUID, after seconds: TimeInterval, locale: Locale) async throws {
    _ = sessionID
    _ = seconds
    _ = locale
  }
  func cancel(sessionID: UUID) { _ = sessionID }
}

@MainActor
protocol MeditationHapticControlling: AnyObject {
  func signalStart()
  func signalEnd()
}

@MainActor
final class NativeMeditationHapticController: MeditationHapticControlling {
  func signalStart() {
    UIImpactFeedbackGenerator(style: .soft).impactOccurred(intensity: 0.55)
  }

  func signalEnd() {
    UIImpactFeedbackGenerator(style: .soft).impactOccurred(intensity: 0.7)
  }
}

@MainActor
final class NoOpMeditationHapticController: MeditationHapticControlling {
  func signalStart() {}
  func signalEnd() {}
}
