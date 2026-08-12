import Foundation
import SwiftUI

struct SettingsView: View {
  @Bindable var model: AppModel

  var body: some View {
    Form {
      Section {
        Picker(
          "settings.language.label",
          selection: Binding(
            get: { model.appLanguage },
            set: { language in Task { await model.setAppLanguage(language) } }
          )
        ) {
          Text("settings.language.system").tag(AppLanguage.system)
          Text("settings.language.english").tag(AppLanguage.english)
          Text("settings.language.german").tag(AppLanguage.german)
        }
        .accessibilityIdentifier("settings.language")

        Text("settings.language.detail")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)

        if model.settingsNotice == .couldNotSaveLanguage {
          Label("settings.language.save.error", systemImage: "exclamationmark.circle")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      } header: {
        Text("settings.language.title")
      }

      Section {
        Link(destination: ProductWebLinks.privacy) {
          Label("settings.privacy.link", systemImage: "hand.raised")
        }
        .accessibilityIdentifier("settings.privacy")

        Link(destination: ProductWebLinks.support) {
          Label("settings.support.link", systemImage: "questionmark.circle")
        }
        .accessibilityIdentifier("settings.support")
      }

      Section {
        NavigationLink {
          ReminderSettingsView(model: model)
        } label: {
          Label("reminders.title", systemImage: "bell")
        }
        .accessibilityIdentifier("settings.reminders")
      }

      Section {
        NavigationLink {
          DataAndSyncView(model: model)
        } label: {
          Label("data.title", systemImage: "internaldrive")
        }
        .accessibilityIdentifier("settings.dataAndSync")
      }

      Section {
        LabeledContent("settings.about.version") {
          Text(appVersion)
            .accessibilityIdentifier("settings.about.version.value")
        }
      } header: {
        Text("settings.about.title")
      }
    }
    .navigationTitle("settings.title")
  }

  private var appVersion: String {
    let shortVersion = Bundle.main.object(
      forInfoDictionaryKey: "CFBundleShortVersionString"
    ) as? String ?? "—"
    let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
    return "\(shortVersion) (\(build))"
  }
}

private enum ProductWebLinks {
  static let privacy = URL(string: "https://psapps.xyz/arrive-within/#privacy")!
  static let support = URL(string: "https://psapps.xyz/arrive-within/#support")!
}

private struct DataAndSyncView: View {
  @Bindable var model: AppModel
  @Environment(\.locale) private var locale
  @State private var showResetConfirmation = false
  @State private var showDeleteConfirmation = false
  @State private var exportToShare: AppOwnedShareItem?
  @State private var exportPendingCleanup: URL?

  var body: some View {
    Form {
      Section {
        Label(syncTitle, systemImage: syncSymbol)
          .font(.headline)
          .accessibilityIdentifier("data.sync.status")
        Text(syncDetail)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      } header: {
        Text("data.sync.title")
      }

      Section {
        LabeledContent("data.count.sessions") {
          Text(model.productDataCounts.practiceEvents.formatted(.number.locale(locale)))
            .accessibilityIdentifier("data.count.sessions.value")
        }
        LabeledContent("data.count.journal") {
          Text(model.productDataCounts.journalEntries.formatted(.number.locale(locale)))
            .accessibilityIdentifier("data.count.journal.value")
        }
        LabeledContent("data.count.favorites") {
          Text(model.productDataCounts.favoritePractices.formatted(.number.locale(locale)))
            .accessibilityIdentifier("data.count.favorites.value")
        }
        if model.productDataCounts.journalConflicts > 0 {
          LabeledContent("data.count.conflicts") {
            Text(model.productDataCounts.journalConflicts.formatted(.number.locale(locale)))
              .accessibilityIdentifier("data.count.conflicts.value")
          }
        }
      } header: {
        Text("data.stored.title")
      }

      Section {
        Button {
          Task { await model.exportAllProductData() }
        } label: {
          Label("data.export.action", systemImage: "square.and.arrow.up")
        }
        .disabled(model.isPerformingDataAction || model.profile == nil)
        .accessibilityIdentifier("data.export.action")

        if let export = model.completeDataExportURL {
          Button {
            exportPendingCleanup = export
            exportToShare = AppOwnedShareItem(url: export)
          } label: {
            Label("data.export.share", systemImage: "archivebox")
          }
          .accessibilityIdentifier("data.export.share")
        }

        Text("data.export.detail")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      } header: {
        Text("data.export.title")
      }

      Section {
        Button("data.reset.action", role: .destructive) {
          showResetConfirmation = true
        }
        .disabled(model.isPerformingDataAction || model.activeSession != nil)
        .accessibilityIdentifier("data.reset.action")

        Text("data.reset.detail")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)

        Button("data.delete.action", role: .destructive) {
          showDeleteConfirmation = true
        }
        .disabled(model.isPerformingDataAction || model.activeSession != nil)
        .accessibilityIdentifier("data.delete.action")

        Text("data.delete.detail")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)

        if model.activeSession != nil {
          Label("data.action.sessionActive", systemImage: "pause.circle")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      } header: {
        Text("data.controls.title")
      }
    }
    .navigationTitle("data.title")
    .sheet(item: $exportToShare, onDismiss: {
      if let url = exportPendingCleanup { model.discardOwnedExport(url) }
      exportPendingCleanup = nil
      exportToShare = nil
    }) { item in
      AppOwnedShareSheet(url: item.url) {
        model.discardOwnedExport(item.url)
        exportPendingCleanup = nil
        exportToShare = nil
      }
        .presentationDetents([.medium, .large])
    }
    .confirmationDialog(
      "data.reset.confirm.title",
      isPresented: $showResetConfirmation,
      titleVisibility: .visible
    ) {
      Button("data.reset.confirm.action", role: .destructive) {
        Task { await model.resetGardenAndPrivateHistory() }
      }
    } message: {
      Text("data.reset.confirm.body")
    }
    .confirmationDialog(
      "data.delete.confirm.title",
      isPresented: $showDeleteConfirmation,
      titleVisibility: .visible
    ) {
      Button("data.delete.confirm.action", role: .destructive) {
        Task { await model.deleteAllProductData() }
      }
    } message: {
      Text("data.delete.confirm.body")
    }
    .alert(
      noticeTitle,
      isPresented: Binding(
        get: { model.dataNotice != nil && model.dataNotice != .deletionComplete },
        set: { if !$0 { model.dismissDataNotice() } }
      )
    ) {
      Button("common.ok") { model.dismissDataNotice() }
    }
  }

  private var syncTitle: LocalizedStringKey {
    "data.sync.localOnly"
  }

  private var syncDetail: LocalizedStringKey {
    "data.sync.localOnly.detail"
  }

  private var syncSymbol: String {
    "iphone"
  }

  private var noticeTitle: LocalizedStringKey {
    switch model.dataNotice {
    case .exportFailed: "data.export.failed"
    case .resetComplete: "data.reset.complete"
    case .resetCleanupPending: "data.reset.cleanupPending"
    case .resetFailed: "data.reset.failed"
    case .deletionComplete: "data.delete.complete"
    case .deletionFailed: "data.delete.failed"
    case nil: "common.error"
    }
  }
}
