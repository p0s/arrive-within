import SwiftUI

struct AppRootView: View {
  @Bindable var model: AppModel
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    Group {
      switch model.launchPhase {
      case .loading:
        LoadingView()
      case .firstUse:
        FirstUseView(model: model)
      case .ready:
        ProductShell(model: model)
      case .failed:
        LocalErrorView(model: model)
      }
    }
    .environment(\.locale, model.appLocale)
    .modifier(UITestDynamicTypeOverrideModifier())
    .tint(AppTheme.accent(for: colorScheme))
    .sheet(
      isPresented: Binding(
        get: { model.recoveryAssessment != nil },
        set: { _ in }
      )
    ) {
      RecoveryView(model: model)
        .interactiveDismissDisabled()
    }
  }
}

private struct UITestDynamicTypeOverrideModifier: ViewModifier {
  @ViewBuilder
  func body(content: Content) -> some View {
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("-ui-test-dynamic-type-ax5") {
        content.environment(\.dynamicTypeSize, .accessibility5)
      } else {
        content
      }
    #else
      content
    #endif
  }
}

private struct LoadingView: View {
  var body: some View {
    ZStack {
      GardenBackdrop()
      ProgressView()
        .controlSize(.large)
        .accessibilityIdentifier("app.loading")
    }
  }
}

private struct LocalErrorView: View {
  let model: AppModel

  var body: some View {
    ZStack {
      GardenBackdrop()
      VStack(spacing: AppTheme.Spacing.generous) {
        Image(systemName: "leaf.circle")
          .font(.system(size: 46, weight: .light))
        Text("common.error")
          .multilineTextAlignment(.center)
          .frame(maxWidth: 360)
        Button("common.retry") {
          Task { await model.retryLoad() }
        }
        .prominentActionButton()
      }
      .padding()
    }
  }
}

private struct FirstUseView: View {
  let model: AppModel
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    ZStack {
      GardenBackdrop()
      GeometryReader { proxy in
        ScrollView {
          VStack(alignment: .leading, spacing: AppTheme.Spacing.generous) {
            Spacer(minLength: max(28, proxy.size.height * 0.1))

            SeedMark()
              .frame(width: AppTheme.Size.primaryMark, height: AppTheme.Size.primaryMark)
              .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: AppTheme.Spacing.compact) {
              Text("onboarding.eyebrow")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.tint)
                .textCase(.uppercase)
                .padding(.vertical, 2)
              Text("onboarding.title")
                .font(AppTheme.Typography.display)
                .accessibilityIdentifier("onboarding.title")
              Text("onboarding.subtitle")
                .font(.title3)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            }
            .padding(AppTheme.Spacing.standard)
            .background(
              Color("LaunchBackground"),
              in: RoundedRectangle(cornerRadius: AppTheme.Radius.generous)
            )

            VStack(spacing: AppTheme.Spacing.standard) {
              Button {
                Task { await model.beginFirstPractice() }
              } label: {
                Label("onboarding.begin", systemImage: "circle.hexagongrid.fill")
                  .frame(maxWidth: .infinity)
              }
              .prominentActionButton()
              .controlSize(.large)
              .accessibilityIdentifier("onboarding.begin")

              Button {
                Task { await model.exploreGarden() }
              } label: {
                Text("onboarding.explore")
                  .font(.body.weight(.semibold))
                  .foregroundStyle(.primary)
                  .frame(maxWidth: .infinity)
                  .padding(.vertical, 10)
                  .background(Color("LaunchBackground"), in: Capsule())
                  .overlay {
                    Capsule().stroke(.primary.opacity(0.2), lineWidth: 1)
                  }
              }
              .buttonStyle(.plain)
              .accessibilityIdentifier("onboarding.explore")
            }

            Label("onboarding.privacy", systemImage: "lock")
              .font(.footnote)
              .foregroundStyle(.primary)
              .padding(.horizontal, 12)
              .padding(.vertical, 8)
              .background(Color("LaunchBackground"), in: Capsule())

            if model.dataNotice == .deletionComplete {
              Label("data.delete.complete", systemImage: "checkmark.shield")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tint)
                .accessibilityIdentifier("data.delete.complete")
            }
          }
          .padding(AppTheme.Spacing.generous)
          .frame(maxWidth: AppTheme.maximumReadableWidth, alignment: .leading)
          .frame(minHeight: proxy.size.height)
          .frame(maxWidth: .infinity)
        }
      }
    }
    .animation(
      AppMotion.gentle(
        reduceMotion: reduceMotion || UITestAccessibilityOverrides.reduceMotion
      ),
      value: model.launchPhase
    )
  }
}

private struct SeedMark: View {
  var body: some View {
    ZStack {
      Circle()
        .fill(AppTheme.forest.opacity(0.1))
      Circle()
        .stroke(AppTheme.forest.opacity(0.22), lineWidth: 1)
        .padding(10)
      Capsule()
        .fill(AppTheme.forest)
        .frame(width: 16, height: 42)
        .offset(y: 18)
      Circle()
        .fill(AppTheme.amber)
        .frame(width: 34, height: 34)
        .offset(y: -18)
      Image(systemName: "leaf.fill")
        .font(.title3)
        .foregroundStyle(AppTheme.sage)
        .offset(x: 21, y: -3)
    }
  }
}

private struct RecoveryView: View {
  let model: AppModel

  var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: AppTheme.Spacing.generous) {
        Image(systemName: "pause.circle")
          .font(.system(size: 48, weight: .light))
          .foregroundStyle(.tint)
        Text("recovery.title")
          .font(.title.bold())
        Text("recovery.body")
          .foregroundStyle(.secondary)

        Button("recovery.confirm.minimum") {
          Task { await model.confirmRecovery(useMaximumPlausibleTime: false) }
        }
        .accessibilityIdentifier("recovery.confirm.minimum")
        .prominentActionButton()
        .frame(maxWidth: .infinity, alignment: .leading)

        Button("recovery.confirm.maximum") {
          Task { await model.confirmRecovery(useMaximumPlausibleTime: true) }
        }
        .accessibilityIdentifier("recovery.confirm.maximum")
        .buttonStyle(.bordered)

        Button("recovery.discard", role: .destructive) {
          Task { await model.discardRecoveredSession() }
        }
        .accessibilityIdentifier("recovery.discard")
        Spacer()
      }
      .padding(AppTheme.Spacing.generous)
    }
    .presentationDetents([.medium, .large])
  }
}
