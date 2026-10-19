import ActivityKit
import SwiftUI
import WidgetKit

@main
struct ArriveWithinLiveActivityBundle: WidgetBundle {
  var body: some Widget {
    ArriveWithinLiveActivity()
  }
}

struct ArriveWithinLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: MeditationActivityAttributes.self) { context in
      HStack(spacing: 14) {
        Image(systemName: "leaf.fill")
          .font(.title2)
          .foregroundStyle(Color(red: 0.30, green: 0.48, blue: 0.29))
          .accessibilityHidden(true)

        VStack(alignment: .leading, spacing: 3) {
          Text(context.state.modeName)
            .font(.headline)
            .lineLimit(1)
          Text(context.state.statusName)
            .font(.caption)
            .foregroundStyle(.secondary)
        }

        Spacer(minLength: 8)

        VStack(alignment: .trailing, spacing: 3) {
          ActivityTimerText(state: context.state)
            .font(.title3.weight(.semibold))
          Text(context.state.timerLabel)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .activityBackgroundTint(Color(red: 0.94, green: 0.96, blue: 0.85))
      .activitySystemActionForegroundColor(Color(red: 0.08, green: 0.20, blue: 0.14))
      .accessibilityElement(children: .combine)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label(context.state.modeName, systemImage: "leaf.fill")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color(red: 0.62, green: 0.79, blue: 0.46))
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.trailing) {
          ActivityTimerText(state: context.state)
            .font(.subheadline.weight(.semibold))
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 7) {
            HStack {
              Text(context.state.statusName)
              Spacer()
              Text(context.state.timerLabel)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            ActivityProgress(state: context.state)
          }
          .padding(.top, 2)
        }
      } compactLeading: {
        Image(systemName: "leaf.fill")
          .foregroundStyle(Color(red: 0.62, green: 0.79, blue: 0.46))
      } compactTrailing: {
        ActivityTimerText(state: context.state)
          .font(.caption2.monospacedDigit())
          .frame(maxWidth: 52)
      } minimal: {
        Image(systemName: "leaf.fill")
          .foregroundStyle(Color(red: 0.62, green: 0.79, blue: 0.46))
      }
      .keylineTint(Color(red: 0.62, green: 0.79, blue: 0.46))
    }
  }
}

private struct ActivityTimerText: View {
  let state: MeditationActivityAttributes.ContentState

  var body: some View {
    Group {
      if state.phase == .running, let runningSince = state.runningSince {
        if let target = state.targetDurationMilliseconds {
          let remaining = max(0, target - state.elapsedMilliseconds)
          let end = runningSince.addingTimeInterval(Double(remaining) / 1_000)
          Text(timerInterval: Date.now...max(Date.now, end), countsDown: true)
        } else {
          let start = runningSince.addingTimeInterval(
            -Double(state.elapsedMilliseconds) / 1_000
          )
          Text(timerInterval: start...Date.distantFuture, countsDown: false)
        }
      } else {
        Text(Self.staticTime(state: state))
      }
    }
    .monospacedDigit()
  }

  private static func staticTime(
    state: MeditationActivityAttributes.ContentState
  ) -> String {
    let milliseconds: Int64
    if let target = state.targetDurationMilliseconds {
      milliseconds = max(0, target - state.elapsedMilliseconds)
    } else {
      milliseconds = max(0, state.elapsedMilliseconds)
    }
    let totalSeconds = milliseconds / 1_000
    let hours = totalSeconds / 3_600
    let minutes = (totalSeconds % 3_600) / 60
    let seconds = totalSeconds % 60
    if hours > 0 {
      return String(format: "%lld:%02lld:%02lld", hours, minutes, seconds)
    }
    return String(format: "%02lld:%02lld", minutes, seconds)
  }
}

private struct ActivityProgress: View {
  let state: MeditationActivityAttributes.ContentState

  var body: some View {
    let target = state.targetDurationMilliseconds ?? 180_000
    ProgressView(
      value: min(1, Double(max(0, state.elapsedMilliseconds)) / Double(max(1, target)))
    )
    .tint(Color(red: 0.62, green: 0.79, blue: 0.46))
  }
}
