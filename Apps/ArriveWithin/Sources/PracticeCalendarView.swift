import ArriveWithinDomain
import SwiftUI

struct PracticeCalendarView: View {
  let history: [PracticeHistoryItem]
  let currentPracticeDay: PracticeDayKey

  @Environment(\.locale) private var locale
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.colorSchemeContrast) private var colorSchemeContrast
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var displayedMonth: PracticeMonthKey
  @State private var selectedLocalDate: String?

  init(history: [PracticeHistoryItem], currentPracticeDay: PracticeDayKey) {
    self.history = history
    self.currentPracticeDay = currentPracticeDay
    _displayedMonth = State(
      initialValue: MonthlyPracticeCalendarReducer.initialMonth(
        history: history,
        currentPracticeDay: currentPracticeDay
      )
    )
  }

  var body: some View {
    VStack(alignment: .leading, spacing: AppTheme.Spacing.standard) {
      VStack(alignment: .leading, spacing: 4) {
        Text("journey.calendar.title")
          .font(.title2.bold())
          .accessibilityIdentifier("journey.calendar")
        Text("journey.calendar.detail")
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      monthNavigation
      calendarGrid
      legend
      selectedDayDetail
    }
  }

  private var localeCalendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = locale
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    return calendar
  }

  private var projection: MonthlyPracticeCalendar {
    MonthlyPracticeCalendarReducer.reduce(
      history: history,
      currentPracticeDay: currentPracticeDay,
      displayedMonth: displayedMonth,
      selectedLocalDate: selectedLocalDate,
      firstWeekday: localeCalendar.firstWeekday
    )
  }

  private var cellSide: CGFloat { dynamicTypeSize.isAccessibilitySize ? 52 : 44 }

  private var monthNavigation: some View {
    VStack(spacing: 6) {
      HStack(spacing: AppTheme.Spacing.standard) {
        monthButton(
          key: "journey.calendar.previous",
          symbol: "chevron.left",
          identifier: "journey.calendar.previous",
          enabled: projection.canNavigateToPreviousMonth
        ) {
          guard let previous = projection.month.adding(months: -1) else { return }
          move(to: previous)
        }

        Spacer(minLength: 8)
        Text(monthTitle(projection.month))
          .font(.headline)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("journey.calendar.month")
        Spacer(minLength: 8)

        monthButton(
          key: "journey.calendar.next",
          symbol: "chevron.right",
          identifier: "journey.calendar.next",
          enabled: projection.canNavigateToNextMonth
        ) {
          guard let next = projection.month.adding(months: 1) else { return }
          move(to: next)
        }
      }

      Button {
        move(to: projection.currentMonth)
      } label: {
        Label("journey.calendar.current", systemImage: "calendar")
          .font(.subheadline.weight(.semibold))
          .frame(minHeight: 44)
      }
      .buttonStyle(.plain)
      .disabled(projection.month == projection.currentMonth)
      .accessibilityIdentifier("journey.calendar.current")
      .keyboardShortcut("0", modifiers: [.command])
    }
  }

  private func monthButton(
    key: LocalizedStringKey,
    symbol: String,
    identifier: String,
    enabled: Bool,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      Label(key, systemImage: symbol)
        .labelStyle(.iconOnly)
        .frame(width: 44, height: 44)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(!enabled)
    .accessibilityLabel(Text(key))
    .accessibilityIdentifier(identifier)
  }

  private var calendarGrid: some View {
    ScrollView(.horizontal) {
      LazyVGrid(
        columns: Array(
          repeating: GridItem(.fixed(cellSide), spacing: 4, alignment: .center),
          count: 7
        ),
        alignment: .center,
        spacing: 4
      ) {
        ForEach(weekdayLabels, id: \.full) { weekday in
          Text(weekday.short)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .frame(width: cellSide, height: 28)
            .accessibilityLabel(weekday.full)
        }

        ForEach(0..<projection.leadingEmptyDayCount, id: \.self) { _ in
          Color.clear
            .frame(width: cellSide, height: cellSide)
            .accessibilityHidden(true)
        }

        ForEach(projection.days) { day in
          dayButton(day)
        }
      }
      .frame(minWidth: cellSide * 7 + 24)
      .padding(.horizontal, 2)
    }
    .scrollIndicators(.hidden)
  }

  private func dayButton(_ day: PracticeCalendarDay) -> some View {
    Button {
      selectedLocalDate = day.localDate
    } label: {
      ZStack(alignment: .topTrailing) {
        VStack(spacing: 2) {
          ZStack {
            if day.isToday {
              Circle()
                .stroke(Color.primary, lineWidth: colorSchemeContrast == .increased ? 2 : 1)
                .frame(width: 30, height: 30)
            }
            Text(String(day.day))
              .font(.subheadline.monospacedDigit().weight(day.isToday ? .bold : .regular))
          }
          .frame(height: 30)

          Image(systemName: statusSymbol(day.status))
            .font(.caption2.weight(.semibold))
            .foregroundStyle(statusStyle(day.status))
            .accessibilityHidden(true)
        }
        .frame(width: cellSide, height: cellSide)

        if day.isSelected {
          Image(systemName: "checkmark")
            .font(.system(size: 8, weight: .black))
            .padding(4)
            .accessibilityHidden(true)
        }
      }
      .background(
        RoundedRectangle(cornerRadius: 10, style: .continuous)
          .fill(day.isSelected ? Color.accentColor.opacity(0.14) : Color.clear)
      )
      .overlay {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
          .stroke(
            day.isSelected ? Color.primary : Color.clear,
            lineWidth: colorSchemeContrast == .increased ? 2.5 : 1.5
          )
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(dayAccessibilityLabel(day))
    .accessibilityHint(
      Text(day.sessions.isEmpty ? "journey.calendar.select.empty.hint" : "journey.calendar.select.hint")
    )
    .accessibilityIdentifier("journey.calendar.day.\(day.localDate)")
  }

  private var legend: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: AppTheme.Spacing.standard) {
        legendItem("journey.calendar.qualifying", symbol: "leaf.fill", emphasized: true)
        legendItem("journey.calendar.nonqualifying", symbol: "clock", emphasized: false)
        legendItem("journey.calendar.empty", symbol: "minus", emphasized: false)
      }
      VStack(alignment: .leading, spacing: 6) {
        legendItem("journey.calendar.qualifying", symbol: "leaf.fill", emphasized: true)
        legendItem("journey.calendar.nonqualifying", symbol: "clock", emphasized: false)
        legendItem("journey.calendar.empty", symbol: "minus", emphasized: false)
      }
    }
    .font(.caption)
  }

  private func legendItem(
    _ key: LocalizedStringKey,
    symbol: String,
    emphasized: Bool
  ) -> some View {
    Label(key, systemImage: symbol)
      .foregroundStyle(emphasized ? AnyShapeStyle(.tint) : AnyShapeStyle(Color.secondary))
      .fixedSize(horizontal: false, vertical: true)
  }

  @ViewBuilder
  private var selectedDayDetail: some View {
    if let selectedDay = projection.days.first(where: \.isSelected) {
      Divider()
      VStack(alignment: .leading, spacing: 8) {
        Text(displayDate(selectedDay.localDate))
          .font(.headline)
          .accessibilityIdentifier("journey.calendar.selected")
        if selectedDay.sessions.isEmpty {
          Text("journey.calendar.selected.empty")
            .font(.subheadline)
            .foregroundStyle(.secondary)
        } else {
          ForEach(Array(selectedDay.sessions.enumerated()), id: \.element.id) { index, item in
            PracticeHistoryRow(item: item)
            if index < selectedDay.sessions.count - 1 { Divider() }
          }
        }
      }
    }
  }

  private var weekdayLabels: [(short: String, full: String)] {
    let short = localeCalendar.veryShortStandaloneWeekdaySymbols
    let full = localeCalendar.standaloneWeekdaySymbols
    let start = max(0, min(6, localeCalendar.firstWeekday - 1))
    return (0..<7).map { offset in
      let index = (start + offset) % 7
      return (short[index], full[index])
    }
  }

  private func move(to month: PracticeMonthKey) {
    selectedLocalDate = nil
    if reduceMotion {
      displayedMonth = month
    } else {
      withAnimation(AppMotion.quick(reduceMotion: false)) {
        displayedMonth = month
      }
    }
  }

  private func monthTitle(_ month: PracticeMonthKey) -> String {
    guard let date = localeCalendar.date(
      from: DateComponents(year: month.year, month: month.month, day: 1, hour: 12)
    ) else { return String(format: "%04d-%02d", month.year, month.month) }
    return Date.FormatStyle(
      locale: locale,
      calendar: localeCalendar,
      timeZone: localeCalendar.timeZone
    )
      .month(.wide)
      .year()
      .format(date)
  }

  private func displayDate(_ localDate: String) -> String {
    let fields = localDate.split(separator: "-").compactMap { Int($0) }
    guard fields.count == 3,
      let date = localeCalendar.date(
        from: DateComponents(year: fields[0], month: fields[1], day: fields[2], hour: 12)
      )
    else { return localDate }
    return Date.FormatStyle(date: .complete, time: .omitted, locale: locale).format(date)
  }

  private func dayAccessibilityLabel(_ day: PracticeCalendarDay) -> Text {
    var parts = [displayDate(day.localDate), statusText(day.status)]
    if day.isToday { parts.append(AppLocalization.string("journey.calendar.today", locale: locale)) }
    if day.isSelected {
      parts.append(AppLocalization.string("journey.calendar.selected", locale: locale))
    }
    return Text(ListFormatter.localizedString(byJoining: parts))
  }

  private func statusText(_ status: PracticeCalendarDayStatus) -> String {
    switch status {
    case .qualifying:
      AppLocalization.string("journey.calendar.qualifying", locale: locale)
    case .nonqualifying:
      AppLocalization.string("journey.calendar.nonqualifying", locale: locale)
    case .empty:
      AppLocalization.string("journey.calendar.empty", locale: locale)
    }
  }

  private func statusSymbol(_ status: PracticeCalendarDayStatus) -> String {
    switch status {
    case .qualifying: "leaf.fill"
    case .nonqualifying: "clock"
    case .empty: "minus"
    }
  }

  private func statusStyle(_ status: PracticeCalendarDayStatus) -> AnyShapeStyle {
    switch status {
    case .qualifying: AnyShapeStyle(.tint)
    case .nonqualifying, .empty: AnyShapeStyle(Color.secondary)
    }
  }
}
