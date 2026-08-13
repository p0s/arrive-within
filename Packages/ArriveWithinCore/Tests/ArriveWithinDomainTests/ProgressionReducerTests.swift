import ArriveWithinDomain
import ArriveWithinTestSupport
import Foundation
import Testing

@Suite("Deterministic garden progression")
struct ProgressionReducerTests {
  @Test("Local garden phases use stable native clock boundaries")
  func localGardenDayPhaseBoundaries() throws {
    let timeZone = try #require(TimeZone(identifier: "Asia/Singapore"))
    let phase: (Int) throws -> GardenDayPhase = { hour in
      GardenDayPhase.presentation(
        at: try localDate(
          year: 2026,
          month: 8,
          day: 13,
          hour: hour,
          minute: 0,
          timeZone: timeZone
        ),
        timeZone: timeZone
      )
    }

    #expect(try phase(4) == .night)
    #expect(try phase(5) == .dawn)
    #expect(try phase(8) == .day)
    #expect(try phase(17) == .dusk)
    #expect(try phase(20) == .night)

    var projection = context()
    projection.localDayPhase = .night
    let state = ProgressionReducer.reduce(events: [], context: projection)
    #expect(state.localDayPhase == .night)
  }

  @Test("Sub-three-minute sessions remain history-only")
  func shortSessionDoesNotGrow() throws {
    let start = Date(timeIntervalSince1970: 1_786_320_000)
    let event = try ArriveWithinFixtures.event(
      ordinal: 1,
      localDate: "2026-08-10",
      start: start,
      activeMilliseconds: 179_999
    )

    let state = ProgressionReducer.reduce(events: [event], context: context())

    #expect(state.qualifyingSessionCount == 0)
    #expect(state.journeyDay == 0)
    #expect(state.microGrowthOrdinal == 0)
  }

  @Test("Same-day qualifying sessions add micro-growth without skipping days")
  func sameDaySessions() throws {
    let start = Date(timeIntervalSince1970: 1_786_320_000)
    let first = try ArriveWithinFixtures.event(
      ordinal: 1,
      localDate: "2026-08-10",
      start: start
    )
    let second = try ArriveWithinFixtures.event(
      ordinal: 2,
      localDate: "2026-08-10",
      start: start.addingTimeInterval(3_600),
      activeMilliseconds: 300_000
    )

    let state = ProgressionReducer.reduce(events: [second, first], context: context())

    #expect(state.qualifyingSessionCount == 2)
    #expect(state.journeyDay == 1)
    #expect(state.highestMilestone == 0)
    #expect(state.microGrowthOrdinal == 2)
    #expect(state.latestGrowthEvent?.beforeJourneyDay == 1)
    #expect(state.latestGrowthEvent?.afterJourneyDay == 1)
  }

  @Test("Two practice days unlock Earth I deterministically")
  func secondPracticeDayUnlocksFirstMilestone() throws {
    let firstStart = Date(timeIntervalSince1970: 1_786_320_000)
    let secondStart = firstStart.addingTimeInterval(86_400)
    let first = try ArriveWithinFixtures.event(
      ordinal: 1,
      localDate: "2026-08-10",
      start: firstStart,
      activeMilliseconds: 180_000
    )
    let second = try ArriveWithinFixtures.event(
      ordinal: 2,
      localDate: "2026-08-11",
      start: secondStart,
      activeMilliseconds: 300_000
    )
    var projection = context()
    projection.customization = GardenCustomization(selectedVariantByMilestone: [1: "m01-a"])

    let state = ProgressionReducer.reduce(events: [second, first], context: projection)

    #expect(state.journeyDay == 2)
    #expect(state.highestMilestone == 1)
    #expect(state.unlockedVariants == ["m01-a", "m01-b"])
    #expect(state.activeCustomization == [1: "m01-a"])
    #expect(state.totalQualifyingSeconds == 480)
  }

  @Test("Duplicate session callbacks reduce exactly once")
  func duplicateSessionIsIgnored() throws {
    let start = Date(timeIntervalSince1970: 1_786_320_000)
    let sessionID = ArriveWithinFixtures.deterministicUUID(namespace: 0x20, ordinal: 1)
    let first = try ArriveWithinFixtures.event(
      ordinal: 1,
      localDate: "2026-08-10",
      start: start,
      sessionID: sessionID
    )
    let duplicate = try ArriveWithinFixtures.event(
      ordinal: 2,
      localDate: "2026-08-10",
      start: start.addingTimeInterval(1),
      sessionID: sessionID
    )

    let state = ProgressionReducer.reduce(events: [duplicate, first], context: context())

    #expect(state.qualifyingSessionCount == 1)
    #expect(state.totalQualifyingSeconds == 180)
  }

  @Test("Growth credit is capped at sixty minutes")
  func durationCap() throws {
    let start = Date(timeIntervalSince1970: 1_786_320_000)
    let event = try ArriveWithinFixtures.event(
      ordinal: 1,
      localDate: "2026-08-10",
      start: start,
      activeMilliseconds: 7_200_000
    )

    let state = ProgressionReducer.reduce(events: [event], context: context())

    #expect(state.totalQualifyingSeconds == 3_600)
  }

  @Test("Stored DST practice-day interval is stable")
  func daylightSavingInterval() throws {
    let timeZone = try #require(TimeZone(identifier: "America/Los_Angeles"))
    let date = Date(timeIntervalSince1970: 1_773_011_400)
    let day = try PracticeDayKey.containing(date, timeZone: timeZone)
    let oneHourLater = try PracticeDayKey.containing(
      date.addingTimeInterval(3_600),
      timeZone: timeZone
    )

    #expect(day.intervalEndUTC.timeIntervalSince(day.intervalStartUTC) == 23 * 3_600)
    #expect(day == oneHourLater)
  }

  @Test("Travel, midnight, and both daylight-saving boundaries keep stored day truth")
  func travelMidnightAndDaylightSavingBoundaries() throws {
    let losAngeles = try #require(TimeZone(identifier: "America/Los_Angeles"))
    let tokyo = try #require(TimeZone(identifier: "Asia/Tokyo"))

    let beforeMidnight = try localDate(
      year: 2026,
      month: 3,
      day: 7,
      hour: 23,
      minute: 58,
      timeZone: losAngeles
    )
    let afterMidnight = try localDate(
      year: 2026,
      month: 3,
      day: 8,
      hour: 0,
      minute: 2,
      timeZone: losAngeles
    )
    let afterTravel = try localDate(
      year: 2026,
      month: 3,
      day: 9,
      hour: 8,
      minute: 0,
      timeZone: tokyo
    )
    let currentDayDate = try localDate(
      year: 2026,
      month: 3,
      day: 10,
      hour: 12,
      minute: 0,
      timeZone: tokyo
    )

    let events = try [
      event(ordinal: 1, start: beforeMidnight, timeZone: losAngeles),
      event(ordinal: 2, start: afterMidnight, timeZone: losAngeles),
      event(ordinal: 3, start: afterTravel, timeZone: tokyo),
    ]
    let currentDay = try PracticeDayKey.containing(currentDayDate, timeZone: tokyo)
    let projection = JourneyReducer.reduce(
      events: events.reversed(),
      profileGenerationID: ArriveWithinFixtures.generationID,
      currentPracticeDay: currentDay
    )

    #expect(events.map(\.practiceDay.localDate) == ["2026-03-07", "2026-03-08", "2026-03-09"])
    #expect(events.map(\.practiceDay.timeZoneIdentifier) == [
      "America/Los_Angeles",
      "America/Los_Angeles",
      "Asia/Tokyo",
    ])
    #expect(projection.journeyDay == 3)
    #expect(projection.statistics.currentStreak == 3)
    #expect(projection.statistics.bestStreak == 3)
    #expect(projection.history.map(\.practiceDay) == events.reversed().map(\.practiceDay))
    #expect(projection.currentPracticeDay == currentDay)

    let march = try #require(PracticeMonthKey(year: 2026, month: 3))
    let calendar = MonthlyPracticeCalendarReducer.reduce(
      history: projection.history,
      currentPracticeDay: currentDay,
      displayedMonth: march,
      selectedLocalDate: "2026-03-08",
      firstWeekday: 2
    )
    #expect(calendar.days.filter { !$0.sessions.isEmpty }.map(\.localDate) == [
      "2026-03-07", "2026-03-08", "2026-03-09",
    ])
    #expect(calendar.days[7].isSelected)
    #expect(calendar.days[7].sessions[0].practiceDay.timeZoneIdentifier == "America/Los_Angeles")
    #expect(calendar.days[8].sessions[0].practiceDay.timeZoneIdentifier == "Asia/Tokyo")

    let springDay = events[1].practiceDay
    #expect(springDay.intervalEndUTC.timeIntervalSince(springDay.intervalStartUTC) == 23 * 3_600)
    let fallDate = try localDate(
      year: 2026,
      month: 11,
      day: 1,
      hour: 12,
      minute: 0,
      timeZone: losAngeles
    )
    let fallDay = try PracticeDayKey.containing(fallDate, timeZone: losAngeles)
    #expect(fallDay.intervalEndUTC.timeIntervalSince(fallDay.intervalStartUTC) == 25 * 3_600)

    let encoded = try JSONEncoder().encode(events[2].practiceDay)
    let reopened = try JSONDecoder().decode(PracticeDayKey.self, from: encoded)
    #expect(reopened == events[2].practiceDay)
    #expect(reopened.timeZoneIdentifier == "Asia/Tokyo")
  }

  @Test("Monthly calendar respects leap years and locale first weekdays")
  func monthlyCalendarLeapYearAndFirstWeekday() throws {
    let currentDate = try localDate(
      year: 2024,
      month: 2,
      day: 29,
      hour: 12,
      minute: 0,
      timeZone: ArriveWithinFixtures.utc
    )
    let currentDay = try PracticeDayKey.containing(
      currentDate,
      timeZone: ArriveWithinFixtures.utc
    )
    let february = try #require(PracticeMonthKey(year: 2024, month: 2))

    let sundayFirst = MonthlyPracticeCalendarReducer.reduce(
      history: [],
      currentPracticeDay: currentDay,
      displayedMonth: february,
      firstWeekday: 1
    )
    let mondayFirst = MonthlyPracticeCalendarReducer.reduce(
      history: [],
      currentPracticeDay: currentDay,
      displayedMonth: february,
      firstWeekday: 2
    )

    #expect(sundayFirst.days.count == 29)
    #expect(sundayFirst.leadingEmptyDayCount == 4)
    #expect(mondayFirst.leadingEmptyDayCount == 3)
    #expect(mondayFirst.days.last?.localDate == "2024-02-29")
    #expect(mondayFirst.days.last?.isToday == true)
  }

  @Test("Monthly calendar derives qualifying, saved-only, empty, today, and selected states")
  func monthlyCalendarDayStatesAndBounds() throws {
    let qualifyingStart = try localDate(
      year: 2026,
      month: 1,
      day: 31,
      hour: 8,
      minute: 0,
      timeZone: ArriveWithinFixtures.utc
    )
    let savedOnlyStart = try localDate(
      year: 2026,
      month: 2,
      day: 1,
      hour: 8,
      minute: 0,
      timeZone: ArriveWithinFixtures.utc
    )
    let currentDate = try localDate(
      year: 2026,
      month: 2,
      day: 3,
      hour: 12,
      minute: 0,
      timeZone: ArriveWithinFixtures.utc
    )
    let events = try [
      ArriveWithinFixtures.event(
        ordinal: 41,
        localDate: "2026-01-31",
        start: qualifyingStart
      ),
      ArriveWithinFixtures.event(
        ordinal: 42,
        localDate: "2026-02-01",
        start: savedOnlyStart,
        activeMilliseconds: 120_000
      ),
    ]
    let currentDay = try PracticeDayKey.containing(
      currentDate,
      timeZone: ArriveWithinFixtures.utc
    )
    let journey = JourneyReducer.reduce(
      events: events,
      profileGenerationID: ArriveWithinFixtures.generationID,
      currentPracticeDay: currentDay
    )
    let february = try #require(PracticeMonthKey(year: 2026, month: 2))
    let calendar = MonthlyPracticeCalendarReducer.reduce(
      history: journey.history,
      currentPracticeDay: currentDay,
      displayedMonth: february,
      selectedLocalDate: "2026-02-01",
      firstWeekday: 2
    )

    #expect(calendar.earliestMonth == PracticeMonthKey(year: 2026, month: 1))
    #expect(calendar.currentMonth == february)
    #expect(calendar.canNavigateToPreviousMonth)
    #expect(!calendar.canNavigateToNextMonth)
    #expect(calendar.days[0].status == .nonqualifying)
    #expect(calendar.days[0].isSelected)
    #expect(calendar.days[0].sessions.map(\.id) == [events[1].id])
    #expect(calendar.days[1].status == .empty)
    #expect(calendar.days[2].status == .empty)
    #expect(calendar.days[2].isToday)

    let january = MonthlyPracticeCalendarReducer.reduce(
      history: journey.history,
      currentPracticeDay: currentDay,
      displayedMonth: try #require(PracticeMonthKey(year: 2026, month: 1)),
      firstWeekday: 2
    )
    #expect(january.days[30].status == .qualifying)
    #expect(!january.canNavigateToPreviousMonth)
    #expect(january.canNavigateToNextMonth)
  }

  @Test("All fifteen authored milestones unlock on their exact practice days")
  func everyMilestoneBoundary() throws {
    #expect(GardenMilestones.all.count == 15)
    #expect(GardenMilestones.all.map(\.practiceDay) == Array(stride(from: 2, through: 30, by: 2)))
    #expect(Set(GardenMilestones.all.flatMap { $0.variants.map(\.id) }).count == 30)

    for milestone in GardenMilestones.all {
      let state = ProgressionReducer.reduce(
        events: try eventsForPracticeDays(milestone.practiceDay),
        context: context()
      )
      #expect(state.journeyDay == milestone.practiceDay)
      #expect(state.highestMilestone == milestone.id)
      #expect(state.unlockedVariants.count == milestone.id * 2)
    }
  }

  @Test("A customization can select only a variant authored for that milestone")
  func customizationOwnership() throws {
    var projection = context()
    projection.customization = GardenCustomization(
      selectedVariantByMilestone: [1: "m02-a", 2: "m02-b"]
    )

    let state = ProgressionReducer.reduce(
      events: try eventsForPracticeDays(4),
      context: projection
    )

    #expect(state.activeCustomization == [2: "m02-b"])
  }

  @Test("Journey statistics, streaks, mode split, and completion dates are deterministic")
  func journeyStatistics() throws {
    let offsets = [0, 1, 3, 3, 4, 5]
    let durations: [Int64] = [180_000, 300_000, 60_000, 600_000, 240_000, 360_000]
    let modes: [PracticeMode] = [.guided, .timer, .stopwatch, .guided, .timer, .stopwatch]
    let base = Date(timeIntervalSince1970: 1_786_320_000)
    let events = try offsets.indices.map { index in
      let start = base.addingTimeInterval(Double(offsets[index]) * 86_400 + Double(index))
      let day = try PracticeDayKey.containing(start, timeZone: ArriveWithinFixtures.utc)
      return try ArriveWithinFixtures.event(
        ordinal: index + 1,
        localDate: day.localDate,
        start: start,
        activeMilliseconds: durations[index],
        mode: modes[index]
      )
    }
    let today = try PracticeDayKey.containing(
      base.addingTimeInterval(6 * 86_400),
      timeZone: ArriveWithinFixtures.utc
    )

    let projection = JourneyReducer.reduce(
      events: events.reversed(),
      profileGenerationID: ArriveWithinFixtures.generationID,
      currentPracticeDay: today
    )

    #expect(projection.journeyDay == 5)
    #expect(projection.completedMilestones.map(\.milestone.id) == [1, 2])
    #expect(projection.completedMilestones[0].completedLocalDate == "2026-08-11")
    #expect(projection.nextMilestone?.practiceDay == 6)
    #expect(projection.statistics.totalSessions == 6)
    #expect(projection.statistics.qualifyingSessions == 5)
    #expect(projection.statistics.qualifyingPracticeDays == 5)
    #expect(projection.statistics.totalActiveSeconds == 1_740)
    #expect(projection.statistics.averageActiveSeconds == 290)
    #expect(projection.statistics.medianActiveSeconds == 270)
    #expect(projection.statistics.currentStreak == 3)
    #expect(projection.statistics.bestStreak == 3)
    #expect(projection.statistics.modeBreakdown == PracticeModeBreakdown(guided: 2, timer: 2, stopwatch: 2))
    #expect(projection.history.count == 6)
    #expect(projection.history.first?.mode == .stopwatch)
    #expect(projection.history.first?.practiceDay.localDate == "2026-08-15")
    #expect(projection.history.last?.mode == .guided)

    let afterGap = try PracticeDayKey.containing(
      base.addingTimeInterval(10 * 86_400),
      timeZone: ArriveWithinFixtures.utc
    )
    #expect(
      JourneyReducer.reduce(
        events: events,
        profileGenerationID: ArriveWithinFixtures.generationID,
        currentPracticeDay: afterGap
      ).statistics.currentStreak == 0
    )
  }

  @Test("Post-day-thirty sessions add permanent micro-growth without a level treadmill")
  func postDayThirtyGrowth() throws {
    let firstThirty = try eventsForPracticeDays(30)
    let latestStart = Date(timeIntervalSince1970: 1_786_320_000).addingTimeInterval(29 * 86_400)
    let latestDate = try PracticeDayKey.containing(latestStart, timeZone: ArriveWithinFixtures.utc).localDate
    let additional = try (31...38).map { ordinal in
      try ArriveWithinFixtures.event(
        ordinal: ordinal,
        localDate: latestDate,
        start: latestStart.addingTimeInterval(Double(ordinal - 30) * 1_000),
        activeMilliseconds: 240_000
      )
    }

    let state = ProgressionReducer.reduce(events: firstThirty + additional, context: context())

    #expect(state.journeyDay == 30)
    #expect(state.highestMilestone == 15)
    #expect(state.unlockedVariants.count == 30)
    #expect(state.qualifyingSessionCount == 38)
    #expect(state.microGrowthOrdinal == 38)
  }

  @Test("Ten years and thousands of immutable events remain deterministic")
  func tenYearScaleProjection() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale(identifier: "en_US_POSIX")
    calendar.timeZone = ArriveWithinFixtures.utc
    let base = try #require(
      calendar.date(from: DateComponents(year: 2020, month: 1, day: 1, hour: 12))
    )
    let dayCount = 3_653
    var events: [PracticeEvent] = []
    events.reserveCapacity(dayCount * 2)

    for dayOffset in 0..<dayCount {
      let dayStart = try #require(calendar.date(byAdding: .day, value: dayOffset, to: base))
      let day = try PracticeDayKey.containing(dayStart, timeZone: ArriveWithinFixtures.utc)
      events.append(
        try ArriveWithinFixtures.event(
          ordinal: dayOffset * 2 + 1,
          localDate: day.localDate,
          start: dayStart,
          activeMilliseconds: 180_000,
          mode: dayOffset.isMultiple(of: 2) ? .guided : .timer
        )
      )
      events.append(
        try ArriveWithinFixtures.event(
          ordinal: dayOffset * 2 + 2,
          localDate: day.localDate,
          start: dayStart.addingTimeInterval(600),
          activeMilliseconds: 120_000,
          mode: .stopwatch
        )
      )
    }

    let currentDay = try #require(events.last?.practiceDay)
    let reversed = Array(events.reversed())
    let first = JourneyReducer.reduce(
      events: reversed,
      profileGenerationID: ArriveWithinFixtures.generationID,
      currentPracticeDay: currentDay
    )
    let second = JourneyReducer.reduce(
      events: reversed,
      profileGenerationID: ArriveWithinFixtures.generationID,
      currentPracticeDay: currentDay
    )

    #expect(first == second)
    #expect(first.journeyDay == 30)
    #expect(first.history.count == dayCount * 2)
    #expect(first.statistics.totalSessions == dayCount * 2)
    #expect(first.statistics.qualifyingSessions == dayCount)
    #expect(first.statistics.qualifyingPracticeDays == dayCount)
    #expect(first.statistics.bestStreak == dayCount)
    #expect(first.statistics.currentStreak == dayCount)

    let leapMonth = try #require(PracticeMonthKey(year: 2024, month: 2))
    let leapCalendar = MonthlyPracticeCalendarReducer.reduce(
      history: first.history,
      currentPracticeDay: currentDay,
      displayedMonth: leapMonth,
      selectedLocalDate: "2024-02-29",
      firstWeekday: 2
    )
    #expect(leapCalendar.days.count == 29)
    #expect(leapCalendar.days.allSatisfy { $0.sessions.count == 2 })
    #expect(leapCalendar.days.last?.isSelected == true)
  }

  private func context() -> GardenProjectionContext {
    GardenProjectionContext(
      gardenID: ArriveWithinFixtures.gardenID,
      gardenSeed: 424_242,
      profileGenerationID: ArriveWithinFixtures.generationID
    )
  }

  private func event(ordinal: Int, start: Date, timeZone: TimeZone) throws -> PracticeEvent {
    let day = try PracticeDayKey.containing(start, timeZone: timeZone)
    return try PracticeEvent(
      id: ArriveWithinFixtures.deterministicUUID(namespace: 0x30, ordinal: ordinal),
      sessionID: ArriveWithinFixtures.deterministicUUID(namespace: 0x20, ordinal: ordinal),
      profileGenerationID: ArriveWithinFixtures.generationID,
      mode: .timer,
      startedAt: start,
      endedAt: start.addingTimeInterval(180),
      activeMilliseconds: 180_000,
      practiceDay: day,
      sourceInstallationID: ArriveWithinFixtures.installationID,
      createdAt: start.addingTimeInterval(180)
    )
  }

  private func localDate(
    year: Int,
    month: Int,
    day: Int,
    hour: Int,
    minute: Int,
    timeZone: TimeZone
  ) throws -> Date {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale(identifier: "en_US_POSIX")
    calendar.timeZone = timeZone
    return try #require(
      calendar.date(
        from: DateComponents(
          calendar: calendar,
          timeZone: timeZone,
          year: year,
          month: month,
          day: day,
          hour: hour,
          minute: minute
        )
      )
    )
  }

  private func eventsForPracticeDays(_ count: Int) throws -> [PracticeEvent] {
    let base = Date(timeIntervalSince1970: 1_786_320_000)
    return try (1...count).map { ordinal in
      let start = base.addingTimeInterval(Double(ordinal - 1) * 86_400)
      let day = try PracticeDayKey.containing(start, timeZone: ArriveWithinFixtures.utc)
      return try ArriveWithinFixtures.event(
        ordinal: ordinal,
        localDate: day.localDate,
        start: start
      )
    }
  }
}
