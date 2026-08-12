import ArriveWithinDomain
import SwiftUI
import UIKit

struct ReminderSettingsView: View {
  @Bindable var model: AppModel
  @Environment(\.openURL) private var openURL
  @State private var isShowingEditor = false
  @State private var editingSchedule: WeeklyReminderSchedule?

  var body: some View {
    Form {
      Section {
        Label(statusTitle, systemImage: statusSymbol)
          .font(.headline)
          .accessibilityIdentifier("reminders.status")
        Text(statusDetail)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)

        if model.reminderDeliveryStatus == .permissionDenied {
          Button("reminders.permission.openSettings") {
            openURL(URL(string: UIApplication.openSettingsURLString)!)
          }
          .accessibilityIdentifier("reminders.permission.openSettings")
        }
      } header: {
        Text("reminders.delivery.title")
      }

      Section {
        if model.weeklyReminderSchedules.isEmpty {
          ContentUnavailableView(
            "reminders.empty.title",
            systemImage: "bell.badge",
            description: Text("reminders.empty.body")
          )
          .accessibilityIdentifier("reminders.empty")
        } else {
          ForEach(model.weeklyReminderSchedules) { schedule in
            HStack(spacing: AppTheme.Spacing.standard) {
              Button {
                editingSchedule = schedule
                isShowingEditor = true
              } label: {
                VStack(alignment: .leading, spacing: 3) {
                  Text(Self.weekdayName(schedule.weekday))
                    .font(.body.weight(.semibold))
                  Text(Self.timeText(hour: schedule.hour, minute: schedule.minute))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
              }
              .buttonStyle(.plain)
              .accessibilityIdentifier("reminders.edit.\(schedule.id.uuidString.lowercased())")

              Toggle(
                "reminders.enabled",
                isOn: Binding(
                  get: { schedule.isEnabled },
                  set: { enabled in
                    Task { await model.setWeeklyReminderEnabled(schedule, isEnabled: enabled) }
                  }
                )
              )
              .labelsHidden()
              .accessibilityIdentifier("reminders.enabled.\(schedule.id.uuidString.lowercased())")
            }
          }
          .onDelete { offsets in
            for offset in offsets {
              let schedule = model.weeklyReminderSchedules[offset]
              Task { await model.deleteWeeklyReminder(schedule) }
            }
          }
        }

        Button {
          editingSchedule = nil
          isShowingEditor = true
        } label: {
          Label("reminders.add.action", systemImage: "plus")
        }
        .accessibilityIdentifier("reminders.add.action")
      } header: {
        Text("reminders.schedules.title")
      } footer: {
        Text("reminders.schedules.footer")
      }
    }
    .navigationTitle("reminders.title")
    .sheet(isPresented: $isShowingEditor) {
      ReminderEditorView(model: model, existing: editingSchedule)
    }
    .alert(
      noticeTitle,
      isPresented: Binding(
        get: { model.reminderNotice != nil },
        set: { if !$0 { model.dismissReminderNotice() } }
      )
    ) {
      Button("common.ok") { model.dismissReminderNotice() }
    } message: {
      Text(noticeMessage)
    }
  }

  private var statusTitle: LocalizedStringKey {
    switch model.reminderDeliveryStatus {
    case .inactive: "reminders.status.inactive"
    case .permissionNotDetermined: "reminders.status.notDetermined"
    case .permissionDenied: "reminders.status.denied"
    case .scheduled: "reminders.status.scheduled"
    case .needsAttention: "reminders.status.attention"
    }
  }

  private var statusDetail: LocalizedStringKey {
    switch model.reminderDeliveryStatus {
    case .inactive: "reminders.status.inactive.detail"
    case .permissionNotDetermined: "reminders.status.notDetermined.detail"
    case .permissionDenied: "reminders.status.denied.detail"
    case .scheduled: "reminders.status.scheduled.detail"
    case .needsAttention: "reminders.status.attention.detail"
    }
  }

  private var statusSymbol: String {
    switch model.reminderDeliveryStatus {
    case .inactive: "bell"
    case .permissionNotDetermined: "bell.badge"
    case .permissionDenied: "bell.slash"
    case .scheduled: "bell.badge.fill"
    case .needsAttention: "exclamationmark.bell"
    }
  }

  private var noticeTitle: LocalizedStringKey {
    switch model.reminderNotice {
    case .permissionDenied: "reminders.notice.denied.title"
    case .duplicateTime: "reminders.notice.duplicate.title"
    case .couldNotLoad, .couldNotSave, .couldNotSchedule, .none:
      "reminders.notice.error.title"
    }
  }

  private var noticeMessage: LocalizedStringKey {
    switch model.reminderNotice {
    case .permissionDenied: "reminders.notice.denied.body"
    case .duplicateTime: "reminders.notice.duplicate.body"
    case .couldNotLoad: "reminders.notice.load.body"
    case .couldNotSave: "reminders.notice.save.body"
    case .couldNotSchedule: "reminders.notice.schedule.body"
    case .none: "reminders.notice.save.body"
    }
  }

  static func weekdayName(_ weekday: Weekday, locale: Locale = .current) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = locale
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    guard let date = calendar.date(
      from: DateComponents(year: 2023, month: 1, day: weekday.rawValue, hour: 12)
    ) else { return String(weekday.rawValue) }
    return Date.FormatStyle(
      locale: locale,
      calendar: calendar,
      timeZone: calendar.timeZone
    )
      .weekday(.wide)
      .format(date)
  }

  static func timeText(hour: Int, minute: Int, locale: Locale = .current) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = locale
    let date = calendar.date(from: DateComponents(hour: hour, minute: minute)) ?? Date()
    return Date.FormatStyle(date: .omitted, time: .shortened, locale: locale).format(date)
  }
}

private struct ReminderEditorView: View {
  let model: AppModel
  let existing: WeeklyReminderSchedule?
  @Environment(\.dismiss) private var dismiss
  @State private var weekday: Weekday
  @State private var time: Date
  @State private var isSaving = false

  init(model: AppModel, existing: WeeklyReminderSchedule?) {
    self.model = model
    self.existing = existing
    let currentWeekday = Calendar.current.component(.weekday, from: Date())
    _weekday = State(initialValue: existing?.weekday ?? Weekday(rawValue: currentWeekday) ?? .monday)
    let components = DateComponents(
      hour: existing?.hour ?? 20,
      minute: existing?.minute ?? 0
    )
    _time = State(
      initialValue: Calendar(identifier: .gregorian).date(from: components) ?? Date()
    )
  }

  var body: some View {
    NavigationStack {
      Form {
        Picker("reminders.editor.day", selection: $weekday) {
          ForEach(Weekday.allCases, id: \.self) { day in
            Text(ReminderSettingsView.weekdayName(day)).tag(day)
          }
        }
        .accessibilityIdentifier("reminders.editor.day")

        DatePicker(
          "reminders.editor.time",
          selection: $time,
          displayedComponents: .hourAndMinute
        )
        .accessibilityIdentifier("reminders.editor.time")

        if let existing {
          Button("reminders.delete.action", role: .destructive) {
            isSaving = true
            Task {
              await model.deleteWeeklyReminder(existing)
              dismiss()
            }
          }
          .disabled(isSaving)
          .accessibilityIdentifier("reminders.delete.action")
        }
      }
      .navigationTitle(existing == nil ? "reminders.add.title" : "reminders.edit.title")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("common.close") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("reminders.save.action") {
            isSaving = true
            let components = Calendar.current.dateComponents([.hour, .minute], from: time)
            Task {
              let saved = await model.saveWeeklyReminder(
                existing: existing,
                weekday: weekday,
                hour: components.hour ?? 20,
                minute: components.minute ?? 0
              )
              isSaving = false
              if saved { dismiss() }
            }
          }
          .disabled(isSaving)
          .accessibilityIdentifier("reminders.save.action")
        }
      }
    }
  }
}
