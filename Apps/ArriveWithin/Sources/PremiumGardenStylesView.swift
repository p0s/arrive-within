import SwiftUI
import UIKit

struct PremiumGardenStylesView: View {
  @Bindable var model: AppModel
  @Environment(\.locale) private var locale
  @State private var requestedStyle: GardenRenderStyle?

  var body: some View {
    Form {
      Section {
        ForEach(GardenRenderStyle.allCases) { style in
          Button {
            choose(style)
          } label: {
            GardenStyleRow(
              style: style,
              isSelected: model.gardenRenderStyle == style,
              isLocked: style.isPremium && !model.premiumGardenAccess.isOwned
            )
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("garden.style.\(style.rawValue)")
          .accessibilityValue(
            style == model.gardenRenderStyle
              ? "selected"
              : style.isPremium && !model.premiumGardenAccess.isOwned
                ? "locked"
                : "available"
          )
          .accessibilityHint(
            style == model.gardenRenderStyle
              ? Text("garden.styles.selected")
              : style.isPremium && !model.premiumGardenAccess.isOwned
                ? Text("garden.styles.locked")
                : Text("")
          )
        }
        if model.settingsNotice == .couldNotSaveGardenStyle {
          Label("settings.garden.style.save.error", systemImage: "exclamationmark.circle")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      } header: {
        Text("garden.styles.title")
      } footer: {
        Text("garden.styles.detail")
      }

      Section {
        if model.premiumGardenAccess.isOwned {
          Label("garden.styles.owned", systemImage: "checkmark.seal.fill")
            .foregroundStyle(.tint)
            .accessibilityIdentifier("garden.styles.owned")
        } else {
          Button {
            requestedStyle = .handDrawn
          } label: {
            Text(premiumActionTitle)
          }
          .disabled(
            model.premiumGardenPurchaseIsInProgress
              || !model.premiumGardenAccess.productIsAvailable
          )
          .accessibilityIdentifier("garden.styles.unlock")

          if !model.premiumGardenAccess.productIsAvailable {
            Text("garden.styles.unavailable")
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
        }

        Button("garden.styles.restore") {
          Task { await model.restorePremiumGardenStyles() }
        }
        .disabled(model.premiumGardenPurchaseIsInProgress)
        .accessibilityIdentifier("garden.styles.restore")
      } footer: {
        Text("garden.styles.purchase.detail")
      }
    }
    .navigationTitle("garden.styles.title")
    .sheet(item: $requestedStyle) { style in
      PremiumGardenPaywallView(model: model, requestedStyle: style)
    }
    .alert(
      premiumNoticeText,
      isPresented: Binding(
        get: { model.premiumGardenNotice != nil },
        set: { if !$0 { model.dismissPremiumGardenNotice() } }
      )
    ) {
      Button("common.ok") { model.dismissPremiumGardenNotice() }
    }
  }

  private var premiumActionTitle: String {
    let title = AppLocalization.string("garden.styles.unlock", locale: locale)
    guard let price = model.premiumGardenAccess.displayPrice else { return title }
    return "\(title) · \(price)"
  }

  private var premiumNoticeText: LocalizedStringKey {
    switch model.premiumGardenNotice {
    case .purchasePending: "garden.styles.purchase.pending"
    case .purchaseFailed: "garden.styles.purchase.failed"
    case .restoreFoundNoPurchase: "garden.styles.restore.none"
    case .restoreFailed: "garden.styles.restore.failed"
    case nil: "common.error"
    }
  }

  private func choose(_ style: GardenRenderStyle) {
    if style.isPremium, !model.premiumGardenAccess.isOwned {
      requestedStyle = style
    } else {
      Task { await model.setGardenRenderStyle(style) }
    }
  }
}

private struct GardenStyleRow: View {
  let style: GardenRenderStyle
  let isSelected: Bool
  let isLocked: Bool
  @Environment(\.locale) private var locale

  var body: some View {
    HStack(spacing: 14) {
      GardenStylePreview(style: style)
        .frame(width: 64, height: 48)
        .accessibilityHidden(true)

      VStack(alignment: .leading, spacing: 3) {
        Text(AppLocalization.string(style.titleLocalizationKey, locale: locale))
          .font(.body.weight(.semibold))
          .foregroundStyle(.primary)
        Text(AppLocalization.string(style.detailLocalizationKey, locale: locale))
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(2)
      }

      Spacer(minLength: 8)
      if isSelected {
        Image(systemName: "checkmark.circle.fill")
          .foregroundStyle(.tint)
          .accessibilityLabel(Text("garden.styles.selected"))
          .accessibilityIdentifier("garden.style.\(style.rawValue).selected")
      } else if isLocked {
        Image(systemName: "lock.fill")
          .foregroundStyle(.secondary)
          .accessibilityLabel(Text("garden.styles.locked"))
          .accessibilityIdentifier("garden.style.\(style.rawValue).locked")
      }
    }
    .contentShape(Rectangle())
    .frame(minHeight: 58)
    .accessibilityAddTraits(isSelected ? .isSelected : [])
  }
}

private struct GardenStylePreview: View {
  let style: GardenRenderStyle

  var body: some View {
    Group {
      if let imageURL = Bundle.main.url(
        forResource: style.previewResourceName,
        withExtension: "png"
      ), let image = UIImage(contentsOfFile: imageURL.path) {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
      } else {
        Color.black.opacity(0.08)
          .overlay {
            Text("garden.styles.preview.missing")
              .font(.caption2)
              .multilineTextAlignment(.center)
              .foregroundStyle(.secondary)
          }
      }
    }
    .clipped()
    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 11, style: .continuous)
        .stroke(.primary.opacity(0.16), lineWidth: 0.7)
    }
  }
}

private struct PremiumGardenPaywallView: View {
  @Bindable var model: AppModel
  let requestedStyle: GardenRenderStyle?
  @Environment(\.dismiss) private var dismiss
  @Environment(\.locale) private var locale

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          GardenStylePreview(style: requestedStyle ?? .handDrawn)
            .frame(height: 190)
            .frame(maxWidth: .infinity)

          VStack(alignment: .leading, spacing: 8) {
            Text("garden.styles.paywall.title")
              .font(.largeTitle.bold())
            Text("garden.styles.paywall.body")
              .font(.title3)
              .foregroundStyle(.secondary)
          }

          VStack(alignment: .leading, spacing: 13) {
            ForEach(GardenRenderStyle.allCases.filter(\.isPremium)) { style in
              HStack(spacing: 12) {
                GardenStylePreview(style: style)
                  .frame(width: 72, height: 48)
                  .accessibilityHidden(true)
                Text(AppLocalization.string(style.titleLocalizationKey, locale: locale))
                  .font(.body.weight(.semibold))
              }
            }
          }

          Button {
            Task {
              await model.purchasePremiumGardenStyles(selecting: requestedStyle)
              if model.premiumGardenAccess.isOwned { dismiss() }
            }
          } label: {
            Text(purchaseTitle)
              .frame(maxWidth: .infinity)
          }
          .prominentActionButton()
          .disabled(
            model.premiumGardenPurchaseIsInProgress
              || !model.premiumGardenAccess.productIsAvailable
          )
          .accessibilityIdentifier("garden.styles.paywall.purchase")

          Button("garden.styles.restore") {
            Task {
              await model.restorePremiumGardenStyles()
              if model.premiumGardenAccess.isOwned { dismiss() }
            }
          }
          .frame(maxWidth: .infinity)
          .disabled(model.premiumGardenPurchaseIsInProgress)

          Text("garden.styles.purchase.detail")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
      }
      .navigationTitle("garden.styles.paywall.navigation")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("common.cancel") { dismiss() }
        }
      }
    }
    .accessibilityIdentifier("garden.styles.paywall")
  }

  private var purchaseTitle: String {
    let title = AppLocalization.string("garden.styles.unlock", locale: locale)
    guard let price = model.premiumGardenAccess.displayPrice else { return title }
    return "\(title) · \(price)"
  }
}

extension GardenRenderStyle {
  fileprivate var titleLocalizationKey: String {
    "garden.styles.\(rawValue).title"
  }
  fileprivate var detailLocalizationKey: String {
    "garden.styles.\(rawValue).detail"
  }

  fileprivate var previewResourceName: String {
    "garden-preview-\(rawValue)"
  }
}
