import ArriveWithinDomain
import SwiftUI

struct JourneyView: View {
  let model: AppModel
  @Environment(\.locale) private var locale

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: AppTheme.Spacing.generous) {
        if let projection = model.journeyProjection {
          progress(projection)
          statistics(projection.statistics)
          if let currentPracticeDay = projection.currentPracticeDay {
            PracticeCalendarView(
              history: projection.history,
              currentPracticeDay: currentPracticeDay
            )
          }
          history(projection.history)
          milestones(projection)
        }
      }
      .padding(AppTheme.Spacing.generous)
      .frame(maxWidth: AppTheme.maximumReadableWidth)
      .frame(maxWidth: .infinity)
    }
    .background(Color("LaunchBackground").ignoresSafeArea())
    .navigationTitle("journey.title")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func progress(_ projection: JourneyProjection) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(
        String(
          format: AppLocalization.string("journey.progress.format", locale: locale),
          locale: locale,
          projection.journeyDay
        )
      )
        .font(.system(.title, design: .rounded, weight: .bold))
      ProgressView(value: Double(projection.journeyDay), total: 30)
        .accessibilityIdentifier("journey.progress")
      Text(nextMilestoneText(projection))
        .font(.subheadline)
        .foregroundStyle(.secondary)
      Text("journey.progress.permanent")
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
  }

  private func statistics(_ statistics: PracticeStatistics) -> some View {
    VStack(alignment: .leading, spacing: AppTheme.Spacing.standard) {
      Text("journey.statistics.title")
        .font(.title2.bold())
        .accessibilityIdentifier("journey.statistics")

      VStack(spacing: 14) {
        statisticPair(
          "journey.statistics.streak.current",
          value: String(statistics.currentStreak),
          valueIdentifier: "journey.statistics.streak.current.value",
          trailingLabel: "journey.statistics.streak.best",
          trailingValue: String(statistics.bestStreak),
          trailingValueIdentifier: "journey.statistics.streak.best.value"
        )
        Divider()
        statisticPair(
          "journey.statistics.days",
          value: String(statistics.qualifyingPracticeDays),
          valueIdentifier: "journey.statistics.days.value",
          trailingLabel: "journey.statistics.sessions",
          trailingValue: String(statistics.totalSessions),
          trailingValueIdentifier: "journey.statistics.sessions.value"
        )
        Divider()
        statisticPair(
          "journey.statistics.active",
          value: minuteLabel(Double(statistics.totalActiveSeconds)),
          valueIdentifier: "journey.statistics.active.value",
          trailingLabel: "journey.statistics.average",
          trailingValue: minuteLabel(statistics.averageActiveSeconds),
          trailingValueIdentifier: "journey.statistics.average.value"
        )
        Divider()
        statisticPair(
          "journey.statistics.median",
          value: minuteLabel(statistics.medianActiveSeconds),
          valueIdentifier: "journey.statistics.median.value",
          trailingLabel: "journey.statistics.modes",
          trailingValue: modeLabel(statistics.modeBreakdown),
          trailingValueIdentifier: "journey.statistics.modes.value"
        )
      }
    }
  }

  private func statisticPair(
    _ leadingLabel: LocalizedStringKey,
    value: String,
    valueIdentifier: String,
    trailingLabel: LocalizedStringKey,
    trailingValue: String,
    trailingValueIdentifier: String
  ) -> some View {
    HStack(alignment: .top, spacing: AppTheme.Spacing.standard) {
      statistic(leadingLabel, value: value, valueIdentifier: valueIdentifier)
      statistic(
        trailingLabel,
        value: trailingValue,
        valueIdentifier: trailingValueIdentifier
      )
    }
  }

  private func statistic(
    _ label: LocalizedStringKey,
    value: String,
    valueIdentifier: String
  ) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(label)
        .font(.footnote)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
      Text(value)
        .font(.headline.monospacedDigit())
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier(valueIdentifier)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func history(_ items: [PracticeHistoryItem]) -> some View {
    VStack(alignment: .leading, spacing: AppTheme.Spacing.standard) {
      HStack(alignment: .firstTextBaseline) {
        Text("journey.history.title")
          .font(.title2.bold())
          .accessibilityIdentifier("journey.history")
        Spacer()
        if !items.isEmpty {
          NavigationLink {
            PracticeHistoryView(items: items)
          } label: {
            Text(
              String(
                format: AppLocalization.string("journey.history.all.format", locale: locale),
                locale: locale,
                items.count
              )
            )
          }
          .accessibilityIdentifier("journey.history.all")
        }
      }

      if items.isEmpty {
        Text("journey.history.empty")
          .foregroundStyle(.secondary)
      } else {
        VStack(spacing: 0) {
          ForEach(Array(items.prefix(3).enumerated()), id: \.element.id) { index, item in
            PracticeHistoryRow(item: item)
            if index < min(3, items.count) - 1 { Divider() }
          }
        }
      }
      Text("journey.history.private")
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
  }

  private func milestones(_ projection: JourneyProjection) -> some View {
    VStack(alignment: .leading, spacing: AppTheme.Spacing.generous) {
      VStack(alignment: .leading, spacing: 4) {
        Text("journey.milestones.title")
          .font(.title2.bold())
        Text("journey.milestones.detail")
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }

      ForEach(GardenElement.allCases, id: \.self) { element in
        VStack(alignment: .leading, spacing: 0) {
          Label(elementTitle(element), systemImage: elementSymbol(element))
            .font(.headline)
            .foregroundStyle(.tint)
            .padding(.bottom, 8)

          let definitions = GardenMilestones.all.filter { $0.element == element }
          ForEach(Array(definitions.enumerated()), id: \.element.id) { index, milestone in
            milestoneRow(milestone, projection: projection)
            if index < definitions.count - 1 { Divider().padding(.leading, 44) }
          }
        }
      }
    }
  }

  private func milestoneRow(
    _ milestone: GardenMilestoneDefinition,
    projection: JourneyProjection
  ) -> some View {
    let completion = projection.completedMilestones.first { $0.milestone.id == milestone.id }
    let unlocked = completion != nil
    return HStack(alignment: .top, spacing: AppTheme.Spacing.standard) {
      Image(systemName: unlocked ? "checkmark.circle.fill" : "circle")
        .font(.title3)
        .foregroundStyle(
          unlocked ? AnyShapeStyle(.tint) : AnyShapeStyle(Color.secondary.opacity(0.45))
        )
        .frame(width: 28)

      VStack(alignment: .leading, spacing: 4) {
        Text(localizedTitle(milestone))
          .font(.headline)
          .accessibilityIdentifier(String(format: "journey.milestone.%02d", milestone.id))
        Text(localizedWorldChange(milestone))
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
        if let completion {
          Text(
            String(
              format: AppLocalization.string("journey.milestone.completed.format", locale: locale),
              locale: locale,
              displayDate(completion.completedLocalDate)
            )
          )
          .font(.caption)
          .foregroundStyle(.secondary)
          .accessibilityIdentifier(
            String(format: "journey.milestone.completed.%02d", milestone.id)
          )
        } else {
          Text(
            String(
              format: AppLocalization.string("journey.milestone.day.format", locale: locale),
              locale: locale,
              milestone.practiceDay
            )
          )
          .font(.caption)
          .foregroundStyle(.secondary)
        }
      }

      Spacer(minLength: 8)

      if unlocked {
        variantMenu(milestone)
      }
    }
    .padding(.vertical, 12)
  }

  private func variantMenu(_ milestone: GardenMilestoneDefinition) -> some View {
    let selectedID =
      model.gardenCustomization.selectedVariantByMilestone[milestone.id]
      ?? milestone.variants[0].id
    let selected = milestone.variants.first { $0.id == selectedID } ?? milestone.variants[0]
    return Menu {
      ForEach(milestone.variants) { variant in
        Button {
          Task { await model.selectGardenVariant(milestoneID: milestone.id, variantID: variant.id) }
        } label: {
          if variant.id == selectedID {
            Label(localizedVariantTitle(variant), systemImage: "checkmark")
          } else {
            Text(localizedVariantTitle(variant))
          }
        }
      }
    } label: {
      Label(localizedVariantTitle(selected), systemImage: "paintpalette")
        .labelStyle(.iconOnly)
        .frame(width: 36, height: 36)
    }
    .accessibilityLabel(
      Text(
        String(
          format: AppLocalization.string("journey.variant.accessibility.format", locale: locale),
          locale: locale,
          localizedVariantTitle(selected)
        )
      )
    )
    .accessibilityIdentifier(String(format: "journey.variant.%02d", milestone.id))
  }

  private func nextMilestoneText(_ projection: JourneyProjection) -> String {
    guard let next = projection.nextMilestone else {
      return AppLocalization.string("journey.complete", locale: locale)
    }
    return String(
      format: AppLocalization.string("journey.next.named.format", locale: locale),
      locale: locale,
      localizedTitle(next),
      next.practiceDay
    )
  }

  private func minuteLabel(_ seconds: Double) -> String {
    String(
      format: AppLocalization.string("journey.minutes.format", locale: locale),
      locale: locale,
      seconds / 60
    )
  }

  private func modeLabel(_ modes: PracticeModeBreakdown) -> String {
    String(
      format: AppLocalization.string("journey.modes.format", locale: locale),
      locale: locale,
      modes.guided,
      modes.timer,
      modes.stopwatch
    )
  }

  private func displayDate(_ localDate: String) -> String {
    let fields = localDate.split(separator: "-").compactMap { Int($0) }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    guard fields.count == 3,
      let date = calendar.date(
        from: DateComponents(year: fields[0], month: fields[1], day: fields[2], hour: 12)
      )
    else { return localDate }
    return Date.FormatStyle(date: .abbreviated, time: .omitted, locale: locale).format(date)
  }

  private var usesGerman: Bool {
    locale.language.languageCode?.identifier == "de"
  }

  private func localizedTitle(_ milestone: GardenMilestoneDefinition) -> String {
    usesGerman ? milestone.germanTitle : milestone.englishTitle
  }

  private func localizedWorldChange(_ milestone: GardenMilestoneDefinition) -> String {
    usesGerman ? milestone.germanWorldChange : milestone.englishWorldChange
  }

  private func localizedVariantTitle(_ variant: GardenVariantDefinition) -> String {
    usesGerman ? variant.germanTitle : variant.englishTitle
  }

  private func elementTitle(_ element: GardenElement) -> LocalizedStringKey {
    switch element {
    case .earth: "journey.element.earth"
    case .water: "journey.element.water"
    case .fire: "journey.element.fire"
    case .air: "journey.element.air"
    case .space: "journey.element.space"
    }
  }

  private func elementSymbol(_ element: GardenElement) -> String {
    switch element {
    case .earth: "mountain.2"
    case .water: "drop"
    case .fire: "sun.max"
    case .air: "wind"
    case .space: "sparkles"
    }
  }
}

private struct PracticeHistoryView: View {
  let items: [PracticeHistoryItem]

  var body: some View {
    List(items) { item in
      PracticeHistoryRow(item: item)
    }
    .listStyle(.plain)
    .navigationTitle("journey.history.title")
    .navigationBarTitleDisplayMode(.inline)
    .overlay {
      if items.isEmpty {
        ContentUnavailableView(
          "journey.history.empty",
          systemImage: "clock.arrow.circlepath"
        )
      }
    }
  }
}

struct PracticeHistoryRow: View {
  let item: PracticeHistoryItem
  @Environment(\.locale) private var locale

  var body: some View {
    HStack(alignment: .top, spacing: AppTheme.Spacing.standard) {
      Image(systemName: symbol)
        .foregroundStyle(
          item.qualifiesForGrowth ? AnyShapeStyle(.tint) : AnyShapeStyle(Color.secondary)
        )
        .frame(width: 24)
      VStack(alignment: .leading, spacing: 4) {
        Text(modeTitle)
          .font(.headline)
        Text(
          Date.FormatStyle(date: .abbreviated, time: .shortened, locale: locale)
            .format(item.startedAt)
        )
          .font(.subheadline)
          .foregroundStyle(.secondary)
        if let guidedContentID = item.guidedContentID {
          Text(guidedContentID)
            .font(.caption.monospaced())
            .foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 8)
      VStack(alignment: .trailing, spacing: 4) {
        Text(durationLabel)
          .font(.headline.monospacedDigit())
        Text(statusTitle)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 8)
    .accessibilityIdentifier("journey.history.\(item.id.uuidString.lowercased())")
  }

  private var modeTitle: LocalizedStringKey {
    switch item.mode {
    case .guided: "mode.guided"
    case .timer: "mode.timer"
    case .stopwatch: "mode.stopwatch"
    }
  }

  private var symbol: String {
    switch item.mode {
    case .guided: "waveform"
    case .timer: "timer"
    case .stopwatch: "stopwatch"
    }
  }

  private var statusTitle: LocalizedStringKey {
    item.qualifiesForGrowth ? "journey.history.grew" : "journey.history.saved"
  }

  private var durationLabel: String {
    let seconds = max(0, item.activeMilliseconds / 1_000)
    return String(format: "%d:%02d", seconds / 60, seconds % 60)
  }
}
