import Foundation

public struct PracticeMonthKey: Codable, Comparable, Hashable, Sendable {
  public let year: Int
  public let month: Int

  public init?(year: Int, month: Int) {
    guard (1...9_999).contains(year), (1...12).contains(month) else { return nil }
    self.year = year
    self.month = month
  }

  public init?(localDate: String) {
    guard let components = StoredLocalDate(localDate) else { return nil }
    self.init(year: components.year, month: components.month)
  }

  public static func < (lhs: Self, rhs: Self) -> Bool {
    lhs.year == rhs.year ? lhs.month < rhs.month : lhs.year < rhs.year
  }

  public func adding(months offset: Int) -> Self? {
    let current = (year - 1) * 12 + (month - 1)
    let (result, overflow) = current.addingReportingOverflow(offset)
    guard !overflow, result >= 0 else { return nil }
    return Self(year: result / 12 + 1, month: result % 12 + 1)
  }
}

public enum PracticeCalendarDayStatus: String, Codable, Equatable, Sendable {
  case empty
  case nonqualifying
  case qualifying
}

public struct PracticeCalendarDay: Codable, Equatable, Identifiable, Sendable {
  public let localDate: String
  public let day: Int
  public let status: PracticeCalendarDayStatus
  public let sessions: [PracticeHistoryItem]
  public let isToday: Bool
  public let isSelected: Bool

  public var id: String { localDate }
}

public struct MonthlyPracticeCalendar: Codable, Equatable, Sendable {
  public let month: PracticeMonthKey
  public let earliestMonth: PracticeMonthKey
  public let currentMonth: PracticeMonthKey
  public let leadingEmptyDayCount: Int
  public let days: [PracticeCalendarDay]

  public var canNavigateToPreviousMonth: Bool { month > earliestMonth }
  public var canNavigateToNextMonth: Bool { month < currentMonth }
}

public enum MonthlyPracticeCalendarReducer {
  public static func initialMonth(
    history: [PracticeHistoryItem],
    currentPracticeDay: PracticeDayKey
  ) -> PracticeMonthKey {
    let currentMonth = PracticeMonthKey(localDate: currentPracticeDay.localDate)!
    return history.compactMap { PracticeMonthKey(localDate: $0.practiceDay.localDate) }
      .filter { $0 <= currentMonth }
      .max() ?? currentMonth
  }

  public static func reduce(
    history: [PracticeHistoryItem],
    currentPracticeDay: PracticeDayKey,
    displayedMonth: PracticeMonthKey,
    selectedLocalDate: String? = nil,
    firstWeekday: Int
  ) -> MonthlyPracticeCalendar {
    let currentMonth = PracticeMonthKey(localDate: currentPracticeDay.localDate)!
    let historicalMonths = history.compactMap {
      PracticeMonthKey(localDate: $0.practiceDay.localDate)
    }.filter { $0 <= currentMonth }
    let earliestMonth = historicalMonths.min() ?? currentMonth
    let month = min(max(displayedMonth, earliestMonth), currentMonth)
    let groupedHistory = Dictionary(
      grouping: history.filter {
        PracticeMonthKey(localDate: $0.practiceDay.localDate) == month
      },
      by: { $0.practiceDay.localDate }
    )
    let dayCount = StoredLocalDate.daysInMonth(year: month.year, month: month.month)
    let days = (1...dayCount).map { day -> PracticeCalendarDay in
      let localDate = String(format: "%04d-%02d-%02d", month.year, month.month, day)
      let sessions = groupedHistory[localDate, default: []]
      let status: PracticeCalendarDayStatus
      if sessions.contains(where: \.qualifiesForGrowth) {
        status = .qualifying
      } else if sessions.isEmpty {
        status = .empty
      } else {
        status = .nonqualifying
      }
      return PracticeCalendarDay(
        localDate: localDate,
        day: day,
        status: status,
        sessions: sessions,
        isToday: localDate == currentPracticeDay.localDate,
        isSelected: localDate == selectedLocalDate
      )
    }

    return MonthlyPracticeCalendar(
      month: month,
      earliestMonth: earliestMonth,
      currentMonth: currentMonth,
      leadingEmptyDayCount: leadingEmptyDayCount(
        year: month.year,
        month: month.month,
        firstWeekday: firstWeekday
      ),
      days: days
    )
  }

  private static func leadingEmptyDayCount(
    year: Int,
    month: Int,
    firstWeekday: Int
  ) -> Int {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale(identifier: "en_US_POSIX")
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    guard
      let firstDay = calendar.date(
        from: DateComponents(year: year, month: month, day: 1, hour: 12)
      )
    else { return 0 }
    let weekday = calendar.component(.weekday, from: firstDay)
    let normalizedFirstWeekday = (1...7).contains(firstWeekday) ? firstWeekday : 1
    return (weekday - normalizedFirstWeekday + 7) % 7
  }
}

private struct StoredLocalDate {
  let year: Int
  let month: Int
  let day: Int

  init?(_ value: String) {
    let fields = value.split(separator: "-", omittingEmptySubsequences: false)
    guard fields.count == 3,
      fields[0].count == 4,
      fields[1].count == 2,
      fields[2].count == 2,
      let year = Int(fields[0]),
      let month = Int(fields[1]),
      let day = Int(fields[2]),
      (1...9_999).contains(year),
      (1...12).contains(month),
      (1...Self.daysInMonth(year: year, month: month)).contains(day)
    else { return nil }
    self.year = year
    self.month = month
    self.day = day
  }

  static func daysInMonth(year: Int, month: Int) -> Int {
    switch month {
    case 2: isLeapYear(year) ? 29 : 28
    case 4, 6, 9, 11: 30
    default: 31
    }
  }

  private static func isLeapYear(_ year: Int) -> Bool {
    year.isMultiple(of: 400) || (year.isMultiple(of: 4) && !year.isMultiple(of: 100))
  }
}
