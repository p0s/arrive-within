import Foundation

public struct PracticeModeBreakdown: Codable, Equatable, Sendable {
  public let guided: Int
  public let timer: Int
  public let stopwatch: Int

  public init(guided: Int, timer: Int, stopwatch: Int) {
    self.guided = guided
    self.timer = timer
    self.stopwatch = stopwatch
  }
}

public struct PracticeStatistics: Codable, Equatable, Sendable {
  public let totalSessions: Int
  public let qualifyingSessions: Int
  public let qualifyingPracticeDays: Int
  public let totalActiveSeconds: Int
  public let averageActiveSeconds: Double
  public let medianActiveSeconds: Double
  public let currentStreak: Int
  public let bestStreak: Int
  public let modeBreakdown: PracticeModeBreakdown

  public init(
    totalSessions: Int,
    qualifyingSessions: Int,
    qualifyingPracticeDays: Int,
    totalActiveSeconds: Int,
    averageActiveSeconds: Double,
    medianActiveSeconds: Double,
    currentStreak: Int,
    bestStreak: Int,
    modeBreakdown: PracticeModeBreakdown
  ) {
    self.totalSessions = totalSessions
    self.qualifyingSessions = qualifyingSessions
    self.qualifyingPracticeDays = qualifyingPracticeDays
    self.totalActiveSeconds = totalActiveSeconds
    self.averageActiveSeconds = averageActiveSeconds
    self.medianActiveSeconds = medianActiveSeconds
    self.currentStreak = currentStreak
    self.bestStreak = bestStreak
    self.modeBreakdown = modeBreakdown
  }
}

public struct CompletedMilestone: Codable, Equatable, Sendable {
  public let milestone: GardenMilestoneDefinition
  public let completedLocalDate: String

  public init(milestone: GardenMilestoneDefinition, completedLocalDate: String) {
    self.milestone = milestone
    self.completedLocalDate = completedLocalDate
  }
}

public struct PracticeHistoryItem: Codable, Equatable, Identifiable, Sendable {
  public let id: UUID
  public let startedAt: Date
  public let endedAt: Date
  public let activeMilliseconds: Int64
  public let practiceDay: PracticeDayKey
  public let mode: PracticeMode
  public let guidedContentID: String?
  public let qualifiesForGrowth: Bool

  public init(event: PracticeEvent) {
    id = event.id
    startedAt = event.startedAt
    endedAt = event.endedAt
    activeMilliseconds = event.activeMilliseconds
    practiceDay = event.practiceDay
    mode = event.mode
    guidedContentID = event.guidedContentID
    qualifiesForGrowth = event.qualifiesForGrowth
  }
}

public struct JourneyProjection: Codable, Equatable, Sendable {
  public let journeyDay: Int
  public let completedMilestones: [CompletedMilestone]
  public let nextMilestone: GardenMilestoneDefinition?
  public let statistics: PracticeStatistics
  public let history: [PracticeHistoryItem]
  public let currentPracticeDay: PracticeDayKey?

  public init(
    journeyDay: Int,
    completedMilestones: [CompletedMilestone],
    nextMilestone: GardenMilestoneDefinition?,
    statistics: PracticeStatistics,
    history: [PracticeHistoryItem],
    currentPracticeDay: PracticeDayKey?
  ) {
    self.journeyDay = journeyDay
    self.completedMilestones = completedMilestones
    self.nextMilestone = nextMilestone
    self.statistics = statistics
    self.history = history
    self.currentPracticeDay = currentPracticeDay
  }
}

public enum JourneyReducer {
  public static func reduce(
    events: [PracticeEvent],
    profileGenerationID: UUID,
    currentPracticeDay: PracticeDayKey? = nil
  ) -> JourneyProjection {
    let accepted = ProgressionReducer.acceptedEvents(
      events,
      profileGenerationID: profileGenerationID
    )
    let qualifying = accepted.filter(\.qualifiesForGrowth)
    let dayEvents = Dictionary(grouping: qualifying, by: \.practiceDay)
    let orderedDays = dayEvents.keys.sorted()
    let journeyDay = min(30, orderedDays.count)
    let completed = GardenMilestones.unlocked(through: journeyDay).map { milestone in
      CompletedMilestone(
        milestone: milestone,
        completedLocalDate: orderedDays[milestone.practiceDay - 1].localDate
      )
    }
    let next = GardenMilestones.all.first { $0.practiceDay > journeyDay }

    return JourneyProjection(
      journeyDay: journeyDay,
      completedMilestones: completed,
      nextMilestone: next,
      statistics: statistics(
        accepted: accepted,
        qualifying: qualifying,
        orderedDays: orderedDays,
        currentPracticeDay: currentPracticeDay
      ),
      history: accepted.reversed().map(PracticeHistoryItem.init(event:)),
      currentPracticeDay: currentPracticeDay
    )
  }

  private static func statistics(
    accepted: [PracticeEvent],
    qualifying: [PracticeEvent],
    orderedDays: [PracticeDayKey],
    currentPracticeDay: PracticeDayKey?
  ) -> PracticeStatistics {
    let durations = accepted.map(\.activeMilliseconds).sorted()
    let totalMilliseconds = saturatingSum(durations)
    let totalSeconds = Int(min(Int64(Int.max), totalMilliseconds / 1_000))
    let average = durations.isEmpty ? 0 : Double(totalMilliseconds) / Double(durations.count) / 1_000
    let median: Double
    if durations.isEmpty {
      median = 0
    } else if durations.count.isMultiple(of: 2) {
      median = (Double(durations[durations.count / 2 - 1]) + Double(durations[durations.count / 2])) / 2_000
    } else {
      median = Double(durations[durations.count / 2]) / 1_000
    }

    let streaks = streakLengths(orderedDays)
    let lastRun = streaks.last ?? 0
    let currentStreak: Int
    if let currentPracticeDay, let latest = orderedDays.last {
      currentStreak = latest.isSameLocalDay(as: currentPracticeDay)
        || currentPracticeDay.isImmediateSuccessor(of: latest) ? lastRun : 0
    } else {
      currentStreak = lastRun
    }

    let modeCounts = Dictionary(grouping: accepted, by: \.mode).mapValues(\.count)
    return PracticeStatistics(
      totalSessions: accepted.count,
      qualifyingSessions: qualifying.count,
      qualifyingPracticeDays: orderedDays.count,
      totalActiveSeconds: totalSeconds,
      averageActiveSeconds: average,
      medianActiveSeconds: median,
      currentStreak: currentStreak,
      bestStreak: streaks.max() ?? 0,
      modeBreakdown: PracticeModeBreakdown(
        guided: modeCounts[.guided, default: 0],
        timer: modeCounts[.timer, default: 0],
        stopwatch: modeCounts[.stopwatch, default: 0]
      )
    )
  }

  private static func saturatingSum(_ values: [Int64]) -> Int64 {
    values.reduce(into: Int64(0)) { total, value in
      let (sum, overflow) = total.addingReportingOverflow(value)
      total = overflow ? Int64.max : sum
    }
  }

  private static func streakLengths(_ days: [PracticeDayKey]) -> [Int] {
    guard let first = days.first else { return [] }
    var lengths: [Int] = []
    var previous = first
    var length = 1
    for day in days.dropFirst() {
      if day.isImmediateSuccessor(of: previous) {
        length += 1
      } else if !day.isSameLocalDay(as: previous) {
        lengths.append(length)
        length = 1
      }
      previous = day
    }
    lengths.append(length)
    return lengths
  }
}

extension PracticeDayKey {
  fileprivate func isSameLocalDay(as other: PracticeDayKey) -> Bool {
    calendarIdentifier == other.calendarIdentifier && localDate == other.localDate
  }

  fileprivate func isImmediateSuccessor(of previous: PracticeDayKey) -> Bool {
    guard calendarIdentifier == previous.calendarIdentifier,
      let identifier = Calendar.Identifier(stableName: calendarIdentifier),
      let previousComponents = Self.localComponents(previous.localDate),
      let currentComponents = Self.localComponents(localDate)
    else { return false }

    var calendar = Calendar(identifier: identifier)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    var anchored = DateComponents()
    anchored.year = previousComponents.year
    anchored.month = previousComponents.month
    anchored.day = previousComponents.day
    anchored.hour = 12
    guard let previousDate = calendar.date(from: anchored),
      let nextDate = calendar.date(byAdding: .day, value: 1, to: previousDate)
    else { return false }
    let expected = calendar.dateComponents([.year, .month, .day], from: nextDate)
    return expected.year == currentComponents.year
      && expected.month == currentComponents.month
      && expected.day == currentComponents.day
  }

  private static func localComponents(_ value: String) -> (year: Int, month: Int, day: Int)? {
    let fields = value.split(separator: "-")
    guard fields.count == 3,
      let year = Int(fields[0]),
      let month = Int(fields[1]),
      let day = Int(fields[2])
    else { return nil }
    return (year, month, day)
  }
}

extension Calendar.Identifier {
  fileprivate init?(stableName: String) {
    switch stableName {
    case "gregorian": self = .gregorian
    case "buddhist": self = .buddhist
    case "chinese": self = .chinese
    case "coptic": self = .coptic
    case "ethiopic-amete-mihret": self = .ethiopicAmeteMihret
    case "ethiopic-amete-alem": self = .ethiopicAmeteAlem
    case "hebrew": self = .hebrew
    case "iso8601": self = .iso8601
    case "indian": self = .indian
    case "islamic": self = .islamic
    case "islamic-civil": self = .islamicCivil
    case "japanese": self = .japanese
    case "persian": self = .persian
    case "republic-of-china": self = .republicOfChina
    case "islamic-tabular": self = .islamicTabular
    case "islamic-umm-al-qura": self = .islamicUmmAlQura
    case "bangla", "gujarati", "kannada", "malayalam", "marathi", "odia", "tamil",
      "telugu", "vikram", "dangi", "vietnamese":
      guard #available(macOS 26, iOS 26, *) else { return nil }
      switch stableName {
      case "bangla": self = .bangla
      case "gujarati": self = .gujarati
      case "kannada": self = .kannada
      case "malayalam": self = .malayalam
      case "marathi": self = .marathi
      case "odia": self = .odia
      case "tamil": self = .tamil
      case "telugu": self = .telugu
      case "vikram": self = .vikram
      case "dangi": self = .dangi
      case "vietnamese": self = .vietnamese
      default: return nil
      }
    default: return nil
    }
  }
}
