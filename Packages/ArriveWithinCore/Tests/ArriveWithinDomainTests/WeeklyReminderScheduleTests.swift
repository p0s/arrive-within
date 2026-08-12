import ArriveWithinDomain
import Foundation
import Testing

@Suite("Device-local weekly reminder contract")
struct WeeklyReminderScheduleTests {
  @Test("Weekly reminders reject invalid local times and preserve identity across edits")
  func validationAndReplacement() throws {
    let created = Date(timeIntervalSince1970: 1_786_320_000)
    #expect(throws: WeeklyReminderScheduleError.invalidLocalTime) {
      try WeeklyReminderSchedule(
        id: UUID(),
        weekday: .monday,
        hour: 24,
        minute: 0,
        createdAt: created,
        modifiedAt: created
      )
    }

    let original = try WeeklyReminderSchedule(
      id: UUID(uuidString: "B1000000-0000-4000-8000-000000000001")!,
      weekday: .monday,
      hour: 20,
      minute: 0,
      createdAt: created,
      modifiedAt: created
    )
    let edited = try original.replacing(
      weekday: .thursday,
      hour: 7,
      minute: 30,
      isEnabled: false,
      modifiedAt: created.addingTimeInterval(60)
    )

    #expect(edited.id == original.id)
    #expect(edited.createdAt == original.createdAt)
    #expect(edited.weekday == .thursday)
    #expect(edited.hour == 7)
    #expect(edited.minute == 30)
    #expect(!edited.isEnabled)
  }

  @Test("Reminder order is stable across weekdays, times, and identifiers")
  func deterministicOrder() throws {
    let date = Date(timeIntervalSince1970: 1_786_320_000)
    let laterMonday = try WeeklyReminderSchedule(
      id: UUID(uuidString: "B1000000-0000-4000-8000-000000000003")!,
      weekday: .monday,
      hour: 20,
      minute: 0,
      createdAt: date,
      modifiedAt: date
    )
    let earlierMonday = try WeeklyReminderSchedule(
      id: UUID(uuidString: "B1000000-0000-4000-8000-000000000002")!,
      weekday: .monday,
      hour: 7,
      minute: 30,
      createdAt: date,
      modifiedAt: date
    )
    let sunday = try WeeklyReminderSchedule(
      id: UUID(uuidString: "B1000000-0000-4000-8000-000000000001")!,
      weekday: .sunday,
      hour: 22,
      minute: 0,
      createdAt: date,
      modifiedAt: date
    )

    #expect(WeeklyReminderSchedule.sorted([laterMonday, earlierMonday, sunday]) == [
      sunday, earlierMonday, laterMonday,
    ])
  }
}
