import Foundation

public enum ProgressionReducer {
  public static func reduce(
    events: [PracticeEvent],
    context: GardenProjectionContext
  ) -> GardenState {
    let accepted = acceptedEvents(events, profileGenerationID: context.profileGenerationID)
    let qualifying = accepted.filter(\.qualifiesForGrowth)
    let orderedDayKeys = Array(Set(qualifying.map(\.practiceDay))).sorted()
    let journeyDay = min(30, orderedDayKeys.count)
    let highestMilestone = GardenMilestones.unlocked(through: journeyDay).count
    let totalMilliseconds = qualifying.reduce(into: Int64(0)) { result, event in
      let (sum, overflow) = result.addingReportingOverflow(event.growthCreditMilliseconds)
      result = overflow ? Int64.max : sum
    }
    let totalSeconds = min(Int64(Int.max), totalMilliseconds / 1_000)
    let validCustomization = context.customization.selectedVariantByMilestone.filter { milestone, variant in
      guard (1...highestMilestone).contains(milestone),
        let definition = GardenMilestones.definition(id: milestone)
      else { return false }
      return definition.variants.contains { $0.id == variant }
    }

    let latest = qualifying.last
    let latestIndex = latest == nil ? nil : qualifying.count
    let latestJourneyDay = latest.map { event in
      min(30, orderedDayKeys.firstIndex(of: event.practiceDay).map { $0 + 1 } ?? journeyDay)
    }

    return GardenState(
      gardenID: context.gardenID,
      gardenSeed: context.gardenSeed,
      profileGenerationID: context.profileGenerationID,
      qualifyingSessionCount: qualifying.count,
      totalQualifyingSeconds: Int(totalSeconds),
      journeyDay: journeyDay,
      highestMilestone: highestMilestone,
      unlockedVariants: unlockedVariants(through: highestMilestone),
      activeCustomization: validCustomization,
      microGrowthOrdinal: qualifying.count,
      localTimePresentation: latest?.practiceDay.localDate,
      localDayPhase: context.localDayPhase,
      latestGrowthEvent: latest.flatMap { event in
        guard let latestIndex, let latestJourneyDay else { return nil }
        let previousJourneyDay = qualifying.dropLast().contains(where: {
          $0.practiceDay == event.practiceDay
        }) ? latestJourneyDay : max(0, latestJourneyDay - 1)
        return GardenGrowthEvent(
          practiceEventID: event.id,
          sessionID: event.sessionID,
          beforeMicroGrowthOrdinal: max(0, latestIndex - 1),
          afterMicroGrowthOrdinal: latestIndex,
          beforeJourneyDay: previousJourneyDay,
          afterJourneyDay: latestJourneyDay
        )
      },
      reduceMotion: context.reduceMotion,
      qualityHint: context.qualityHint
    )
  }

  public static func acceptedEvents(
    _ events: [PracticeEvent],
    profileGenerationID: UUID
  ) -> [PracticeEvent] {
    let ordered = events
      .filter { $0.profileGenerationID == profileGenerationID }
      .sorted(by: eventOrder)

    var eventIDs = Set<UUID>()
    var sessionIDs = Set<UUID>()
    return ordered.filter { event in
      guard eventIDs.insert(event.id).inserted else { return false }
      guard sessionIDs.insert(event.sessionID).inserted else { return false }
      return true
    }
  }

  public static func unlockedVariants(through milestone: Int) -> [String] {
    GardenMilestones.variantIDs(through: milestone)
  }

  private static func eventOrder(_ lhs: PracticeEvent, _ rhs: PracticeEvent) -> Bool {
    if lhs.endedAt != rhs.endedAt { return lhs.endedAt < rhs.endedAt }
    if lhs.createdAt != rhs.createdAt { return lhs.createdAt < rhs.createdAt }
    return lhs.id.uuidString < rhs.id.uuidString
  }
}
