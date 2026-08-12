import ArriveWithinDomain
import Foundation
import UserNotifications

enum ReminderNotificationAuthorization: Equatable {
  case notDetermined
  case denied
  case authorized
}

enum ReminderDeliveryStatus: Equatable {
  case inactive
  case permissionNotDetermined
  case permissionDenied
  case scheduled(Int)
  case needsAttention
}

@MainActor
protocol WeeklyReminderNotificationControlling: AnyObject {
  func authorizationState() async -> ReminderNotificationAuthorization
  func requestAuthorization() async -> ReminderNotificationAuthorization
  func pendingWeeklyReminderIdentifiers() async -> Set<String>
  func upsert(_ schedule: WeeklyReminderSchedule, locale: Locale) async throws
  func removeWeeklyReminderIdentifiers(_ identifiers: Set<String>)
}

enum WeeklyReminderNotificationIdentifier {
  static let prefix = "arrive-within.weekly-reminder."

  static func value(for scheduleID: UUID) -> String {
    prefix + scheduleID.uuidString.lowercased()
  }
}

@MainActor
final class NativeWeeklyReminderNotificationController: WeeklyReminderNotificationControlling {
  private let center: UNUserNotificationCenter

  init(center: UNUserNotificationCenter = .current()) {
    self.center = center
  }

  func authorizationState() async -> ReminderNotificationAuthorization {
    Self.map(await center.notificationSettings().authorizationStatus)
  }

  func requestAuthorization() async -> ReminderNotificationAuthorization {
    do {
      _ = try await center.requestAuthorization(options: [.alert, .sound])
      return await authorizationState()
    } catch {
      return .denied
    }
  }

  func pendingWeeklyReminderIdentifiers() async -> Set<String> {
    Set(
      await center.pendingNotificationRequests()
        .map(\.identifier)
        .filter { $0.hasPrefix(WeeklyReminderNotificationIdentifier.prefix) }
    )
  }

  func upsert(_ schedule: WeeklyReminderSchedule, locale: Locale) async throws {
    let content = UNMutableNotificationContent()
    content.title = AppLocalization.string("notification.reminder.title", locale: locale)
    content.body = AppLocalization.string("notification.reminder.body", locale: locale)
    content.sound = .default

    var components = DateComponents()
    components.weekday = schedule.weekday.rawValue
    components.hour = schedule.hour
    components.minute = schedule.minute
    let request = UNNotificationRequest(
      identifier: WeeklyReminderNotificationIdentifier.value(for: schedule.id),
      content: content,
      trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
    )
    try await center.add(request)
  }

  func removeWeeklyReminderIdentifiers(_ identifiers: Set<String>) {
    guard !identifiers.isEmpty else { return }
    center.removePendingNotificationRequests(withIdentifiers: identifiers.sorted())
  }

  private static func map(_ status: UNAuthorizationStatus) -> ReminderNotificationAuthorization {
    switch status {
    case .notDetermined: .notDetermined
    case .denied: .denied
    case .authorized, .provisional, .ephemeral: .authorized
    @unknown default: .denied
    }
  }
}

@MainActor
final class NoOpWeeklyReminderNotificationController: WeeklyReminderNotificationControlling {
  var authorization: ReminderNotificationAuthorization
  private(set) var pendingIdentifiers: Set<String>

  init(
    authorization: ReminderNotificationAuthorization = .authorized,
    pendingIdentifiers: Set<String> = []
  ) {
    self.authorization = authorization
    self.pendingIdentifiers = pendingIdentifiers
  }

  func authorizationState() async -> ReminderNotificationAuthorization { authorization }

  func requestAuthorization() async -> ReminderNotificationAuthorization { authorization }

  func pendingWeeklyReminderIdentifiers() async -> Set<String> { pendingIdentifiers }

  func upsert(_ schedule: WeeklyReminderSchedule, locale: Locale) async throws {
    _ = locale
    pendingIdentifiers.insert(WeeklyReminderNotificationIdentifier.value(for: schedule.id))
  }

  func removeWeeklyReminderIdentifiers(_ identifiers: Set<String>) {
    pendingIdentifiers.subtract(identifiers)
  }
}
